import pytest

from app.services.url_guard import (
    UrlRejected,
    ip_is_allowed,
    normalize_url,
    validate_public_url,
    validate_url_syntax,
)

REJECTED = [
    # loopback, in every spelling a browser or resolver might accept
    "http://localhost/",
    "http://LOCALHOST./",
    "http://foo.localhost/",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://2130706433/",  # decimal
    "http://0x7f000001/",  # hex
    "http://0x7f.0.0.1/",
    "http://017700000001/",  # octal
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",  # IPv4-mapped IPv6
    "http://[::ffff:7f00:1]/",
    "http://0.0.0.0/",
    # private ranges
    "http://10.0.0.5/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://[fd00::1]/",
    "http://100.64.0.1/",  # carrier-grade NAT
    # link-local and cloud metadata
    "http://169.254.169.254/latest/meta-data/",
    "http://[fd00:ec2::254]/",
    "http://[fe80::1]/",
    "http://metadata.google.internal/",
    # IPv6 wrappers that can carry a private IPv4
    "http://[64:ff9b::7f00:1]/",
    "http://[2002:7f00:1::]/",
    # not web addresses
    "http://intranet/",
    "http://printer.local/",
    "http://wiki.lan/",
    # schemes
    "ftp://example.com/",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "gopher://example.com/",
    "data:text/html,hi",
    # credentials, ports
    "http://user:pass@example.com/",
    "http://example.com:8080/",
    "http://example.com:22/",
    "https://example.com:6379/",
    # personal profiles
    "https://www.linkedin.com/in/someone",
    "https://linkedin.com/pub/someone/1/2/3",
    "https://twitter.com/someone",
    "https://x.com/someone",
    "https://www.instagram.com/someone/",
    "https://m.facebook.com/someone",
    # empty or oversized
    "",
    "   ",
    "http://" + "a" * 3000 + ".com/",
    "not a url",
    "http://",
]

ACCEPTED = [
    "https://example.com/about",
    "http://example.com",
    "https://example.com:443/careers?id=1",
    "http://example.com:80/",
    "https://sub.example.co.uk/path/",
    "https://www.linkedin.com/company/acme",  # company page: allowed (likely needs sign-in)
    "http://93.184.216.34/",  # public literal IP
]


@pytest.mark.parametrize("url", REJECTED)
def test_rejects(url):
    with pytest.raises(UrlRejected):
        validate_url_syntax(url)


@pytest.mark.parametrize("url", ACCEPTED)
def test_accepts(url):
    validate_url_syntax(url)


def test_rejection_messages_are_plain_and_leak_nothing():
    with pytest.raises(UrlRejected) as e:
        validate_url_syntax("http://169.254.169.254/latest/meta-data/iam")
    assert "private or local" in e.value.message
    assert "169" not in e.value.message and "iam" not in e.value.message


@pytest.mark.parametrize(
    "ip,allowed",
    [
        ("93.184.216.34", True),
        ("8.8.8.8", True),
        ("2606:4700:4700::1111", True),
        ("127.0.0.1", False),
        ("10.1.2.3", False),
        ("169.254.169.254", False),
        ("224.0.0.1", False),  # multicast
        ("::ffff:10.0.0.1", False),
        ("::ffff:8.8.8.8", True),
        ("240.0.0.1", False),  # reserved
    ],
)
def test_ip_is_allowed(ip, allowed):
    import ipaddress

    assert ip_is_allowed(ipaddress.ip_address(ip)) is allowed


def resolver_for(mapping):
    async def resolve(host, port):
        if host not in mapping:
            raise OSError("no such host")
        return mapping[host]

    return resolve


async def test_public_host_resolving_to_private_is_rejected():
    r = resolver_for({"evil.example.com": ["10.0.0.7"]})
    with pytest.raises(UrlRejected, match="private or local"):
        await validate_public_url("https://evil.example.com/", r)


async def test_a_single_private_answer_among_public_ones_is_rejected():
    r = resolver_for({"split.example.com": ["93.184.216.34", "127.0.0.1"]})
    with pytest.raises(UrlRejected):
        await validate_public_url("https://split.example.com/", r)


async def test_unresolvable_host_is_rejected_with_a_clear_message():
    with pytest.raises(UrlRejected, match="could not be found"):
        await validate_public_url("https://nope.example.com/", resolver_for({}))


async def test_public_host_passes_and_is_normalised():
    r = resolver_for({"example.com": ["93.184.216.34"]})
    out = await validate_public_url("HTTPS://Example.COM./About#team", r)
    assert out == "https://example.com/About"


def test_normalize_keeps_query_and_drops_fragment():
    assert normalize_url(validate_url_syntax("http://a.com?x=1#f")) == "http://a.com/?x=1"
