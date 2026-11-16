"""Circuit breaker for a model: after repeated failures, stop sending it traffic for a while so a
sick provider does not cost every request a timeout."""

import time
from collections import deque
from collections.abc import Callable


class CircuitBreaker:
    """Opens after `threshold` failures within `window` seconds, stays open for `open_for` seconds,
    then lets traffic through again (half-open): a success closes it, a failure reopens it."""

    def __init__(
        self,
        *,
        threshold: int = 5,
        window: float = 30.0,
        open_for: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.threshold = threshold
        self.window = window
        self.open_for = open_for
        self._clock = clock
        self._failures: deque[float] = deque()
        self._opened_at: float | None = None

    @property
    def is_open(self) -> bool:
        return self._opened_at is not None and self._clock() - self._opened_at < self.open_for

    def allow(self) -> bool:
        """True when the protected model may get traffic (closed, or open long enough to probe)."""
        return not self.is_open

    def record_failure(self) -> None:
        now = self._clock()
        if self._opened_at is not None and now - self._opened_at >= self.open_for:
            self._opened_at = now  # the probe failed: stay protected for another period
            self._failures.clear()
            return
        self._failures.append(now)
        while self._failures and now - self._failures[0] > self.window:
            self._failures.popleft()
        if len(self._failures) >= self.threshold:
            self._opened_at = now
            self._failures.clear()

    def record_success(self) -> None:
        self._failures.clear()
        self._opened_at = None
