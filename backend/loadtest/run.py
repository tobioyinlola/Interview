"""Load test: N concurrent synthetic practice sessions against a running API in fake-provider mode.

Each session signs in, starts a session, streams real-time PCM over the audio WebSocket, and asks
for an answer outline for every question caption. With fake providers this measures OUR service
(relay, database, streaming, event loop), not OpenAI latency or limits.

Usage (see scripts/loadtest.sh, which starts the API with limits raised and prints the summary):
  python loadtest/run.py --users 40 --seconds 24 --api http://localhost:8765 --log /path/api.log
"""

import argparse
import asyncio
import json
import random
import re
import statistics
import time
import uuid
from pathlib import Path

import httpx
import websockets

CSRF = {"x-requested-with": "meet-practice"}
LINK = re.compile(r"/login/verify\?token=([\w-]+)")


def pct(values: list[float], p: float) -> float:
    if not values:
        return float("nan")
    s = sorted(values)
    return s[min(len(s) - 1, int(round(p / 100 * (len(s) - 1))))]


class Stats:
    def __init__(self) -> None:
        self.caption_lag: list[float] = []  # audio that completes a line -> final caption arrives
        self.first_delta: list[float] = []
        self.suggest_total: list[float] = []
        self.api_ms: list[float] = []
        self.errors: list[str] = []
        self.suggests = 0
        self.captions = 0
        self.setup_done = 0


SIGN_IN_LOCK = asyncio.Lock()  # the link is read from the log, so sign-ins must not interleave


async def sign_in(client: httpx.AsyncClient, log: Path, email: str) -> None:
    async with SIGN_IN_LOCK:
        await _sign_in(client, log, email)


async def _sign_in(client: httpx.AsyncClient, log: Path, email: str) -> None:
    before = log.read_text().count("login link")
    r = await client.post("/api/auth/request-link", json={"email": email}, headers=CSRF)
    r.raise_for_status()
    for _ in range(50):
        text = log.read_text()
        if text.count("login link") > before:
            break
        await asyncio.sleep(0.1)
    token = LINK.findall(text)[-1]
    r = await client.post("/api/auth/verify", json={"token": token}, headers=CSRF)
    r.raise_for_status()


async def timed(stats: Stats, coro):  # type: ignore[no-untyped-def]
    t = time.perf_counter()
    out = await coro
    stats.api_ms.append((time.perf_counter() - t) * 1000)
    return out


async def one_user(
    i: int, args: argparse.Namespace, stats: Stats, start_gate: asyncio.Event
) -> None:
    ws_url = args.api.replace("http", "ws", 1)
    async with httpx.AsyncClient(base_url=args.api, timeout=30) as client:
        try:
            await sign_in(client, Path(args.log), f"load-{i}-{uuid.uuid4().hex[:6]}@example.com")
            r = await timed(
                stats, client.post("/api/sessions", json={"consent": True}, headers=CSRF)
            )
            r.raise_for_status()
            body = r.json()
        except Exception as e:  # noqa: BLE001
            stats.errors.append(f"setup {i}: {e!r}")
            stats.setup_done += 1
            return
        stats.setup_done += 1
        await start_gate.wait()  # everyone connects at once...
        await asyncio.sleep(random.uniform(0, args.stagger))  # ...unless spread out
        rate = body["sample_rate"]
        frame = b"\x00\x01" * (rate // 50)  # 20 ms of audio
        sent_at: list[float] = []  # times at which cumulative audio crossed each 2 s line
        pending_suggests: list[asyncio.Task[None]] = []

        async def suggest(text: str) -> None:
            t0 = time.perf_counter()
            first = True
            try:
                async with client.stream(
                    "POST",
                    f"/api/sessions/{body['session_id']}/suggest",
                    json={"question_text": text},
                    headers=CSRF,
                ) as resp:
                    async for line in resp.aiter_lines():
                        if line.startswith("event: delta") and first:
                            first = False
                            stats.first_delta.append(time.perf_counter() - t0)
                        if line.startswith("event: done"):
                            break
                stats.suggest_total.append(time.perf_counter() - t0)
                stats.suggests += 1
            except Exception as e:  # noqa: BLE001
                stats.errors.append(f"suggest {i}: {e!r}")

        try:
            async with websockets.connect(
                f"{ws_url}/api/sessions/{body['session_id']}/audio?speaker=partner",
                origin=args.origin,
                max_size=2**20,
            ) as ws:
                await ws.send(json.dumps({"type": "auth", "token": body["audio_token"]}))
                ready = json.loads(await ws.recv())
                assert ready["type"] == "ready", ready

                async def reader() -> None:
                    n = 0
                    async for raw in ws:
                        msg = json.loads(raw)
                        if msg.get("type") == "ping":  # the browser answers; so must we
                            await ws.send(json.dumps({"type": "pong"}))
                        if msg.get("type") == "final":
                            stats.captions += 1
                            if n < len(sent_at):
                                stats.caption_lag.append(time.perf_counter() - sent_at[n])
                            n += 1
                            if "?" in msg.get("text", ""):
                                pending_suggests.append(asyncio.create_task(suggest(msg["text"])))

                rd = asyncio.create_task(reader())
                per_line = int(2.0 * rate * 2)
                total = 0
                t_end = time.perf_counter() + args.seconds
                nxt = time.perf_counter()
                while time.perf_counter() < t_end:
                    await ws.send(frame)
                    total += len(frame)
                    if total >= per_line * (len(sent_at) + 1):
                        sent_at.append(time.perf_counter())
                    nxt += 0.02
                    await asyncio.sleep(max(0, nxt - time.perf_counter()))
                await asyncio.sleep(1.0)
                await ws.close()
                await rd
        except Exception as e:  # noqa: BLE001
            stats.errors.append(f"socket {i}: {e!r}")
        await asyncio.gather(*pending_suggests, return_exceptions=True)
        try:
            await timed(stats, client.post(f"/api/sessions/{body['session_id']}/end", headers=CSRF))
        except Exception as e:  # noqa: BLE001
            stats.errors.append(f"end {i}: {e!r}")


def server_pid(pid_file: str) -> str | None:
    p = Path(pid_file) if pid_file else None
    return p.read_text().strip() if p and p.exists() else None


async def sampler(
    args: argparse.Namespace, samples: list[dict[str, float]], stop: asyncio.Event
) -> None:
    pid = server_pid(args.pid_file)
    while not stop.is_set():
        row: dict[str, float] = {}
        try:
            if pid:
                row["rss_mb"] = (
                    int(Path(f"/proc/{pid}/status").read_text().split("VmRSS:")[1].split()[0])
                    / 1024
                )
            async with httpx.AsyncClient(base_url=args.api, timeout=5) as c:
                text = (await c.get("/metrics")).text
            for name in ("audio_websockets_open", "db_pool_connections_in_use"):
                m = re.search(rf"^{name} ([\d.e+-]+)", text, re.M)
                if m:
                    row[name] = float(m.group(1))
        except Exception:  # noqa: BLE001
            pass
        samples.append(row)
        await asyncio.sleep(0.25)


def hist_quantile(text: str, name: str, q: float) -> float | None:
    buckets = [
        (float(le) if le != "+Inf" else float("inf"), float(v))
        for le, v in re.findall(rf'^{name}_bucket{{le="([^"]+)"}} ([\d.e+-]+)', text, re.M)
    ]
    if not buckets or buckets[-1][1] == 0:
        return None
    target = q * buckets[-1][1]
    for le, count in buckets:
        if count >= target:
            return le
    return None


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--users", type=int, default=40)
    ap.add_argument("--seconds", type=float, default=24)
    ap.add_argument("--api", default="http://localhost:8765")
    ap.add_argument("--origin", default="http://localhost:5173")
    ap.add_argument("--log", required=True)
    ap.add_argument("--out", default="")
    ap.add_argument("--pid-file", default="")
    ap.add_argument("--stagger", type=float, default=0, help="spread session starts over N seconds")
    args = ap.parse_args()

    stats = Stats()
    samples: list[dict[str, float]] = []
    gate, stop = asyncio.Event(), asyncio.Event()
    watcher = asyncio.create_task(sampler(args, samples, stop))
    users = [asyncio.create_task(one_user(i, args, stats, gate)) for i in range(args.users)]
    while stats.setup_done < args.users:  # everyone signed in (or failed) before the load starts
        await asyncio.sleep(0.2)
    gate.set()
    t0 = time.perf_counter()
    await asyncio.gather(*users)
    wall = time.perf_counter() - t0
    stop.set()
    await watcher
    async with httpx.AsyncClient(base_url=args.api, timeout=10) as c:
        text = (await c.get("/metrics")).text

    def peak(key: str) -> float:
        return max((s[key] for s in samples if key in s), default=float("nan"))

    result = {
        "users": args.users,
        "seconds": args.seconds,
        "stagger": args.stagger,
        "wall_seconds": round(wall, 1),
        "captions": stats.captions,
        "suggests": stats.suggests,
        "errors": stats.errors[:10],
        "error_count": len(stats.errors),
        "caption_lag_s": {
            "p50": pct(stats.caption_lag, 50),
            "p95": pct(stats.caption_lag, 95),
            "max": max(stats.caption_lag, default=float("nan")),
        },
        "suggest_first_delta_s": {
            "p50": pct(stats.first_delta, 50),
            "p95": pct(stats.first_delta, 95),
        },
        "suggest_total_s": {
            "p50": pct(stats.suggest_total, 50),
            "p95": pct(stats.suggest_total, 95),
        },
        "rest_call_ms": {"p50": pct(stats.api_ms, 50), "p95": pct(stats.api_ms, 95)},
        "peak_websockets": peak("audio_websockets_open"),
        "peak_db_pool_in_use": peak("db_pool_connections_in_use"),
        "mean_db_pool_in_use": round(
            statistics.fmean(
                [
                    s["db_pool_connections_in_use"]
                    for s in samples
                    if "db_pool_connections_in_use" in s
                ]
                or [0]
            ),
            2,
        ),
        "db_pool_capacity": 20,
        "peak_rss_mb": round(peak("rss_mb"), 1),
        "server_event_loop_lag_p99_bucket_s": hist_quantile(text, "event_loop_lag_seconds", 0.99),
        "server_answer_first_token_p95_bucket_s": hist_quantile(
            text, "answer_first_token_seconds", 0.95
        ),
    }
    out = json.dumps(result, indent=2, default=lambda o: None)
    print(out)
    if args.out:
        Path(args.out).write_text(out + "\n")
    # pass/fail so CI or a person can gate on it
    ok = not stats.errors and stats.caption_lag and pct(stats.caption_lag, 95) < 1.5
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    asyncio.run(main())
