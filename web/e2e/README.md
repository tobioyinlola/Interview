# End-to-end test (real browser)

`live-session.cjs` drives the real app in Chromium through sign-in, notes, the consent gate, sharing a
simulated Meet tab (a real `MediaStream` with a tone), live captions, streamed outlines, blur mode, a
typed question, an API restart mid-session (reconnect plus a gap marker), stopping the share, ending the
session, the transcript download and the review page.

Run it with `scripts/e2e-live.sh` from the repo root. It starts the API with `USE_FAKE_PROVIDERS=true`
(scripted transcription and answers, refused in production), so it needs no OpenAI key.

It proves the browser-to-server wiring, not model quality or real latency: the simulated tab never
pauses, so no end-of-speech is detected, and the scripted model answers instantly.
Not yet run in CI.
