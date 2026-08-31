# Changelog — Transcription Fix Pass

All changes are scoped to the live transcription pipeline. WebRTC signaling,
`simple-peer` setup, media device handling, room management, and all UI
components/pages were left untouched. No architecture changes, no renames, no
Git operations.

## Root cause

Live transcription never produced any output because the server-side Deepgram
manager created each connection's state object but never stored it in its
tracking `Map`. As a result, every incoming audio chunk was dropped before
reaching Deepgram, and no transcript was ever returned.

---

## Modified files

### `server/src/deepgramTranscription.js`
- **Fix (critical):** Register the connection state in the `connections` Map
  inside `start()` (`connections.set(socketId, state)`). Without this,
  `sendAudio()`, `stop()`, and `hasConnection()` all looked up a non-existent
  entry, so microphone audio was silently discarded and Deepgram was never fed.
  This was the single defect breaking the entire feature.
- **Cleanup:** Removed dead debug logging — the `Deepgram connection OPEN`
  line in the `Open` handler and the per-result `JSON.stringify(result)` dump
  in the `Transcript` handler (fired on every interim/final result).

### `server/src/index.js`
- **Security/cleanup:** Removed `console.log("DEEPGRAM_API_KEY = ...")` that
  printed the secret API key to logs on every server start.
- **Cleanup:** Removed the per-chunk `"[TRANSCRIPTION] Audio chunk received"`
  log inside the `transcription:audio` handler (fired every ~250 ms per
  participant) and restored correct indentation. Forwarding logic unchanged.

### `client/src/hooks/useDeepgramTranscription.js`
- **Browser-compat fix:** Replaced the hard-coded
  `mimeType: "audio/webm;codecs=opus"` in the `MediaRecorder` constructor
  (which throws in browsers that don't support that exact string) with the
  already-defined `getSupportedMimeType()` helper, which negotiates among
  `audio/webm;codecs=opus`, `audio/webm`, `audio/ogg;codecs=opus`, and
  `audio/ogg`. Added a clean error path when no supported type exists, instead
  of throwing.
- **Cleanup:** Removed the stray MIME-support `console.log`.

---

## Verification performed
- `node --check` passes on all server source files.
- All local `require`/`import` targets resolve to existing files — no broken
  imports.
- No leftover debug or secret-logging statements remain in `server/src` or
  `client/src`.

## Known limitations
- **Deepgram API key:** Transcription requires a valid, funded key in
  `server/.env` (`DEEPGRAM_API_KEY`). If a `transcription:error` still appears
  after these fixes, verify the key and account credits. Rotating the key is
  recommended since it was previously present in committed files.
- **Safari:** With the MIME fix, Safari no longer throws, but its
  `MediaRecorder` historically does not support WebM/Ogg-Opus, so transcription
  may cleanly report "not supported" there. Chrome, Edge, and Firefox are
  unaffected.
