"""Real TLS, no mocks: connecting to a pre-checked IP must still verify the certificate against
the real host name. This guards the `sni_hostname` behaviour the SSRF defence depends on."""

import asyncio
import ipaddress
import ssl
from urllib.parse import urlsplit

import httpx
import pytest
import trustme

from app.services.fetcher import Fetcher

BODY = b"hello from the pinned server"


@pytest.fixture
async def tls_server():
    ca = trustme.CA()
    servers: list[asyncio.AbstractServer] = []

    async def start(cert_for: str):
        cert = ca.issue_cert(cert_for)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        cert.configure_cert(ctx)

        async def handle(reader, writer):
            await reader.readuntil(b"\r\n\r\n")
            writer.write(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n"
                + f"Content-Length: {len(BODY)}\r\nConnection: close\r\n\r\n".encode()
                + BODY
            )
            await writer.drain()
            writer.close()

        server = await asyncio.start_server(handle, "127.0.0.1", 0, ssl=ctx)
        servers.append(server)
        return server.sockets[0].getsockname()[1]

    client_ctx = ssl.create_default_context()
    ca.configure_trust(client_ctx)
    yield start, client_ctx
    for s in servers:
        s.close()
        await s.wait_closed()


async def fetch_via_ip(client_ctx, port, host="pinned.test"):
    f = Fetcher(verify=client_ctx, host_interval=0)
    parts = urlsplit(f"https://{host}:{port}/")
    # Call the pinned-IP request directly: it is what connects after the address checks passed.
    return await f._get_via_ip(parts, host, ipaddress.ip_address("127.0.0.1"), 1024 * 1024)


async def test_certificate_is_verified_against_the_real_host_not_the_ip(tls_server):
    start, ctx = tls_server
    port = await start("pinned.test")  # certificate is for the host name only, not 127.0.0.1
    raw = await fetch_via_ip(ctx, port)
    assert raw.status_code == 200 and raw.body == BODY


async def test_a_certificate_for_a_different_host_is_rejected(tls_server):
    start, ctx = tls_server
    port = await start("someone-else.test")
    with pytest.raises(httpx.ConnectError):
        await fetch_via_ip(ctx, port)


async def test_an_untrusted_certificate_is_rejected(tls_server):
    start, _ = tls_server
    port = await start("pinned.test")
    with pytest.raises(httpx.ConnectError):
        await fetch_via_ip(ssl.create_default_context(), port)  # does not trust the test CA
