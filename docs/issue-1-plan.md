# v0.2.0 · Issue #1

## Requirements
- R1: Keep zero-configuration HTML/Pages templates, browser speech and the existing Edge MP3 path.
- R2: Independently configure text and speech providers on the server; implement MiMo first.
- R3: Generate exactly three editable scripts, preserving supplied product/price and limiting each to 350 characters.
- R4: Expose supported voices/formats/rate controls; download the real format. MiMo starts with non-streaming WAV, no numeric rate or voice cloning.
- R5: Keep credentials server-side; bound requests, time, concurrency and memory; expose safe errors.

## Technical specification
Native Node HTTP remains the transport. `lib/ai/index.mjs` selects adapters; each adapter returns normalized scripts/audio. Configuration is read once at startup. `/api/health` is liveness only; `/api/capabilities` reports configuration, not a paid upstream health check. No client-controlled upstream URLs/models. `POST /api/scripts` returns three fixed style IDs; `POST /api/tts` retains text/voice/rate and returns audio bytes. JSON errors retain the `error` string and add code/retryable/requestId.

Frontend retains templates in the HTML; optional public config contains only an API base URL. Explicit URL overrides static-host detection. Same-origin Node works without config; file/Pages defaults offline. Failure preserves scripts and offers an explicit template action. Speech failure falls back to browser speech; download failure is visible. Async requests are abortable and stale results cannot overwrite newer work. TTS cache keys include provider, model, format, voice, rate and style version; shared synthesis is bounded and timed independently of any one waiting client.

MiMo uses `/chat/completions`, `api-key` authentication, JSON-object text output, and assistant-role speech text. WAV bytes are decoded from `choices[0].message.audio.data`. Configuration defaults remain template + Edge. `.env` loading is explicit via `npm run start:env` (Node >=20.11). CORS is an origin allowlist, not authentication; public paid API deployment requires an authenticated gateway. No automatic retries of paid calls.

## Ordered tasks
1. [x] Config, adapters, API validation/errors and offline contract tests (R1–R5).
2. [x] Frontend capability discovery, async scripts and real-format speech (R1–R4).
3. [x] Browser regression, documentation and CI (R1–R5).

## Verification status
Local verification: syntax checks passed; 17 Node tests passed; 10 Chromium checks passed, including pending synthesis cancellation and repeated reload/voice persistence. Tests use simulated upstream responses/audio playback, without paid API calls. CI repeats Node tests on Node 20/22 and Chromium on Node 22. Live MiMo credentials, generated speech quality, account quotas, direct MP3 support and regional voice quality require an operator smoke test. Those limitations do not disable existing static/Edge paths. Issue remains open until live acceptance.
