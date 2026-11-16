"""Sign in with Google: OpenID Connect authorization-code flow with PKCE.

Protections: a random `state` bound to the browser by a signed, short-lived, HttpOnly cookie (stops
login CSRF), a `nonce` checked in the ID token (stops replay), and PKCE. The ID token arrives
straight from Google's token endpoint over TLS together with our client secret, which OpenID Connect
allows us to trust without checking its signature; we still check issuer, audience, expiry, nonce
and that Google verified the email address."""

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

from app.config import Settings

ISSUERS = {"https://accounts.google.com", "accounts.google.com"}
STATE_COOKIE = "oauth_state"
STATE_COOKIE_PATH = "/api/auth/google"
HANDSHAKE_TTL = 600  # seconds the user has to finish at Google


class GoogleAuthError(Exception):
    """Any reason the Google sign-in cannot continue. The message is for logs, never for users."""


@dataclass(frozen=True)
class Handshake:
    state: str
    nonce: str
    verifier: str


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class GoogleOAuth:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.s = settings
        self._transport = transport

    @property
    def enabled(self) -> bool:
        return bool(self.s.google_client_id and self.s.google_client_secret.get_secret_value())

    @property
    def redirect_uri(self) -> str:
        return f"{self.s.api_public_url.rstrip('/')}/api/auth/google/callback"

    # ------------------------------------------------------------ the browser's cookie

    def _sign(self, payload: str) -> str:
        key = self.s.cookie_secret.get_secret_value().encode()
        return _b64(hmac.new(key, payload.encode(), hashlib.sha256).digest())

    def begin(self) -> tuple[str, str]:
        """Returns (URL to send the browser to, value for the state cookie)."""
        hs = Handshake(
            state=secrets.token_urlsafe(32),
            nonce=secrets.token_urlsafe(32),
            verifier=secrets.token_urlsafe(64),
        )
        challenge = _b64(hashlib.sha256(hs.verifier.encode()).digest())
        query = urlencode(
            {
                "client_id": self.s.google_client_id,
                "redirect_uri": self.redirect_uri,
                "response_type": "code",
                "scope": "openid email",
                "state": hs.state,
                "nonce": hs.nonce,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "prompt": "select_account",
            }
        )
        body = _b64(
            json.dumps(
                {
                    "s": hs.state,
                    "n": hs.nonce,
                    "v": hs.verifier,
                    "e": int(time.time()) + HANDSHAKE_TTL,
                }
            ).encode()
        )
        return f"{self.s.google_auth_url}?{query}", f"{body}.{self._sign(body)}"

    def read_cookie(self, value: str | None) -> Handshake | None:
        if not value or "." not in value:
            return None
        body, sig = value.rsplit(".", 1)
        if not hmac.compare_digest(sig, self._sign(body)):
            return None
        try:
            data = json.loads(_unb64(body))
            if int(data["e"]) < time.time():
                return None
            return Handshake(state=data["s"], nonce=data["n"], verifier=data["v"])
        except (ValueError, KeyError, TypeError):
            return None

    # ------------------------------------------------------------ the callback

    async def finish(self, *, code: str, state: str, handshake: Handshake | None) -> str:
        """Check the callback and return Google's verified, lower-cased email address."""
        if handshake is None or not hmac.compare_digest(state, handshake.state):
            raise GoogleAuthError("state does not match this browser")
        try:
            async with httpx.AsyncClient(timeout=10, transport=self._transport) as client:
                resp = await client.post(
                    self.s.google_token_url,
                    data={
                        "code": code,
                        "client_id": self.s.google_client_id,
                        "client_secret": self.s.google_client_secret.get_secret_value(),
                        "redirect_uri": self.redirect_uri,
                        "grant_type": "authorization_code",
                        "code_verifier": handshake.verifier,
                    },
                )
        except httpx.HTTPError as exc:
            raise GoogleAuthError(f"token request failed: {type(exc).__name__}") from exc
        if resp.status_code != 200:
            raise GoogleAuthError(f"token endpoint answered {resp.status_code}")
        try:
            id_token = resp.json()["id_token"]
            claims = json.loads(_unb64(id_token.split(".")[1]))
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise GoogleAuthError("no readable id_token") from exc
        return self._email_from(claims, handshake)

    def _email_from(self, claims: dict[str, object], hs: Handshake) -> str:
        aud = claims.get("aud")
        audiences = aud if isinstance(aud, list) else [aud]
        exp = claims.get("exp")
        if claims.get("iss") not in ISSUERS:
            raise GoogleAuthError("wrong issuer")
        if self.s.google_client_id not in audiences:
            raise GoogleAuthError("wrong audience")
        if not isinstance(exp, int | float) or exp < time.time():
            raise GoogleAuthError("expired id_token")
        nonce = claims.get("nonce")
        if not isinstance(nonce, str) or not hmac.compare_digest(nonce, hs.nonce):
            raise GoogleAuthError("nonce mismatch")
        email = claims.get("email")
        if claims.get("email_verified") not in (True, "true") or not isinstance(email, str):
            raise GoogleAuthError("email missing or not verified by Google")
        return email.lower().strip()
