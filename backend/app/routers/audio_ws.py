import uuid

from fastapi import APIRouter, Depends, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.adapters.interfaces import SttProvider
from app.config import Settings, allowed_origins, get_settings
from app.db import get_sessionmaker
from app.deps import get_hub, get_stt
from app.services.live import CLOSE_BAD_TOKEN, AudioRelay, LiveHub

router = APIRouter(tags=["audio"])


@router.websocket("/api/sessions/{session_id}/audio")
async def audio_socket(
    ws: WebSocket,
    session_id: uuid.UUID,
    speaker: str = "partner",
    settings: Settings = Depends(get_settings),  # noqa: B008
    stt: SttProvider = Depends(get_stt),  # noqa: B008
    hub: LiveHub = Depends(get_hub),  # noqa: B008
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_sessionmaker),  # noqa: B008
) -> None:
    """Audio up as binary PCM frames; captions down as JSON. One socket per audio source.

    Protocol: client sends {"type":"auth","token"} first (5 s). Server replies {"type":"ready"},
    then partial/final/error/cap/ping events. Close codes: 1000 normal, 4401 bad or expired token,
    4429 daily cap, 4500 upstream failure, 1012 server restarting."""
    origin = ws.headers.get("origin")
    if origin is not None and origin not in allowed_origins(settings):
        await ws.close(code=CLOSE_BAD_TOKEN)  # only the website and the apps' own interface
        return
    await ws.accept()
    if speaker not in ("partner", "you"):
        await ws.close(code=CLOSE_BAD_TOKEN)
        return
    relay = AudioRelay(
        ws,
        session_id=session_id,
        speaker=speaker,
        settings=settings,
        stt=stt,
        session_factory=session_factory,
        hub=hub,
    )
    await relay.run()
