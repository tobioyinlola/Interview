import pytest

from app.services.clientip import forwarded_client_ip


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("8.8.4.4", "8.8.4.4"),
        ("", None),
        ("   ", None),
        ("not-an-address", None),
        # a caller who sends their own header cannot choose the address: ours is added last
        ("1.2.3.4, 8.8.4.4", "8.8.4.4"),
        ("1.2.3.4, 5.6.7.8, 9.9.9.9", "9.9.9.9"),
        # an internal hop after it is skipped
        ("8.8.4.4, 10.1.2.3", "8.8.4.4"),
        ("8.8.4.4, 100.64.0.7, 172.16.5.5, 192.168.1.1, 127.0.0.1", "8.8.4.4"),
        # only internal addresses: nothing to trust
        ("10.0.0.1, 192.168.0.4", None),
        ("127.0.0.1", None),
        ("100.64.0.1", None),
        # junk between real addresses is ignored
        ("8.8.4.4, junk, ", "8.8.4.4"),
        # IPv6
        ("2606:4700:4700::1111", "2606:4700:4700::1111"),
        ("2606:4700:4700::1111, fd00::1", "2606:4700:4700::1111"),
        ("::1", None),
    ],
)
def test_the_address_is_the_last_public_one(header: str, expected: str | None) -> None:
    assert forwarded_client_ip(header) == expected
