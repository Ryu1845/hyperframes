# Audio engine — voiceover, music, SFX, captions, transcription

For a full audio pass (TTS voiceover + background music + sound effects in one
shot), use the shared engine at `audio/scripts/audio.mjs`. It takes a neutral
`audio_request.json` and writes `audio_meta.json` plus assets under
`.media/audio/{voice,bgm,sfx}`:

```bash
node <SKILL_DIR>/audio/scripts/audio.mjs --request ./audio_request.json --out ./audio_meta.json
```

- **Request** `{ provider?, voice?, lang?, speed?, tts_model?, style?, lines: [{ id, text, style?, sfx?: [names] }], bgm: { mode?, query?, prompt? } }`: `id` joins each line back to your model; `bgm.mode` = `generate | none` (omit for generate). `--only tts,bgm,sfx` runs a subset and merges into an existing `--out`.
- **Gemini narration** is opt-in with `provider: "gemini"` and an API key or service-account credentials. `tts_model` defaults to `gemini-3.8-flash-tts`; 3.8 Flash-Lite, 3.1 Flash Preview, and 2.5 Pro/Flash Preview TTS are also supported. `style` directs delivery; a line's style overrides the request's style. CLI overrides: `--tts-model`, `--style`. See `audio/references/tts.md` for a complete request. The existing automatic provider order is unchanged.
- **Output** `audio_meta.json` (id-keyed): `voices[].{path,duration_s,words[]}` (word timestamps for captions), `sfx[]`, `bgm`, `total_duration_s`.
- **Providers**: voice is ElevenLabs when `ELEVENLABS_API_KEY` is set, else local Kokoro (Gemini when asked for); music is generated — Lyria with `GEMINI_API_KEY` / `GOOGLE_API_KEY`, else local MusicGen; SFX come from Openverse with no account (`audio/references/sfx.md`). Keys and Python deps: `audio/references/requirements.md`.
- BGM renders in a detached process (`bgm_pending: true`): run `audio/scripts/wait-bgm.mjs` before final render.

Transcription / background removal / captions use the `hyperframes` CLI (`transcribe`, `remove-background`), see the per-topic guides in `audio/references/` (`tts.md`, `bgm.md`, `sfx.md`, `transcribe.md`, `remove-background.md`, `captions/`).

Transcription defaults to Parakeet (better than whisper.cpp: 6.05% vs 7.44% WER, 5-10x faster) via `scripts/transcribe.mjs`, with whisper.cpp auto-fallback (see `references/operations.md`).
