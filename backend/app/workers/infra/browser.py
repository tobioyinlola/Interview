"""One Chromium for the whole worker, started only when a task first needs it, reused across tasks
with a fresh, isolated context (cookies, storage) for each, and restarted after a number of uses
or when it has sat idle, so memory does not creep. Chromium runs in its own processes, so a page
that crashes it cannot take the worker down; the next task simply gets a new browser."""

import asyncio
import contextlib
import logging
import time
from typing import Any

log = logging.getLogger("app.workers.browser")


class BrowserManager:
    def __init__(
        self,
        *,
        executable_path: str | None = None,
        proxy: dict[str, str] | None = None,
        max_uses: int = 25,
        idle_seconds: float = 300.0,
    ) -> None:
        self.executable_path = executable_path
        self.proxy = proxy
        self.max_uses = max_uses
        self.idle_seconds = idle_seconds
        self._pw: Any = None
        self._browser: Any = None
        self._uses = 0
        self._last_used = 0.0
        self._in_use = 0
        self._lock = asyncio.Lock()

    async def _launch(self) -> Any:
        from playwright.async_api import async_playwright

        self._pw = await async_playwright().start()
        opts: dict[str, Any] = {"args": ["--no-sandbox"]}
        if self.executable_path:
            opts["executable_path"] = self.executable_path
        if self.proxy:
            opts["proxy"] = self.proxy
        self._browser = await self._pw.chromium.launch(**opts)
        self._uses = 0
        return self._browser

    async def _stop(self) -> None:
        browser, pw = self._browser, self._pw
        self._browser = self._pw = None
        with contextlib.suppress(Exception):
            if browser is not None:
                await browser.close()
        with contextlib.suppress(Exception):
            if pw is not None:
                await pw.stop()

    async def context(self, **opts: Any) -> Any:
        """A new isolated browser context. Close it with `done(ctx)`."""
        async with self._lock:
            alive = self._browser is not None and self._browser.is_connected()
            if alive and self._in_use == 0 and self._uses >= self.max_uses:
                await self._stop()  # recycle: a long-lived Chromium slowly grows
                alive = False
            if not alive:
                if self._browser is not None:
                    log.warning("browser had stopped; starting a new one")
                await self._stop()
                await self._launch()
            self._uses += 1
            self._in_use += 1
            browser = self._browser
        try:
            return await browser.new_context(**opts)
        except Exception:
            async with self._lock:
                self._in_use -= 1
            raise

    async def done(self, ctx: Any) -> None:
        with contextlib.suppress(Exception):
            await ctx.close()
        async with self._lock:
            self._in_use = max(0, self._in_use - 1)
            self._last_used = time.monotonic()

    async def close_if_idle(self) -> bool:
        """Free the browser's memory when nothing has used it for a while."""
        async with self._lock:
            idle = time.monotonic() - self._last_used >= self.idle_seconds
            if self._browser is not None and self._in_use == 0 and idle:
                await self._stop()
                return True
        return False

    async def close(self) -> None:
        async with self._lock:
            await self._stop()
