"""The caller's address when the app sits behind a proxy that adds it to X-Forwarded-For."""

import ipaddress


def forwarded_client_ip(header: str) -> str | None:
    """The address the proxy saw, from an X-Forwarded-For value.

    Each proxy adds the address it saw to the END of the list, so the first entries can be made up
    by the caller and are not trusted. This takes the last address that is a public one, which is
    the one our own edge added, and skips internal addresses (private, loopback, shared-carrier
    ranges) that a hop inside the platform may have appended after it."""
    for part in reversed([p.strip() for p in header.split(",")]):
        try:
            ip = ipaddress.ip_address(part)
        except ValueError:
            continue
        if ip.is_global:
            return str(ip)
    return None
