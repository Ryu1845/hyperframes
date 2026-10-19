# Requirements & Caches

## Keys & engine order

Each section of the audio engine takes the first engine that can run — **first match wins**. Keys may be set in the shell or in a project `.env` (the engine loads the nearest one, walking up ≤5 dirs; the shell wins):

| Provider                   | Used when                                             | Local deps when used                             |
| -------------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| **ElevenLabs** (TTS)       | `$ELEVENLABS_API_KEY` is set and `elevenlabs` imports | `pip install elevenlabs`                         |
| **Kokoro** (TTS, no key)   | always — final voice fallback                         | `pip install kokoro-onnx soundfile`              |
| **Gemini** (TTS)           | only when asked for (`provider: "gemini"`)            | see `tts.md` § Gemini narration                  |
| **Lyria** (BGM)            | `$GEMINI_API_KEY` → `$GOOGLE_API_KEY` is set          | `pip install google-genai`                       |
| **MusicGen** (BGM, no key) | always — final music fallback                         | `pip install transformers torch soundfile numpy` |

With no keys at all, voice and music run fully locally (Kokoro / MusicGen); `hyperframes doctor` reports whether those local deps are installed.

## Model caches & system dependencies

Each command downloads its own model on first run and caches it under `~/.cache/hyperframes/`:

- **TTS (ElevenLabs)** — API key + `pip install elevenlabs`; `ffmpeg`/`ffprobe` on PATH to measure each take.
- **TTS (Kokoro)** — Kokoro-82M (~311 MB) + voices (~27 MB) in `tts/`. Requires Python 3.8+ with `kokoro-onnx` and `soundfile` (`pip install kokoro-onnx soundfile`). Non-English text also needs `espeak-ng` system-wide.
- **BGM (Lyria)** — needs `$GEMINI_API_KEY` or `$GOOGLE_API_KEY` + `pip install google-genai`. No local model cache.
- **BGM (MusicGen)** — `pip install transformers torch soundfile`. `facebook/musicgen-small` (~300 MB) cached under `~/.cache/huggingface/` on first run.
- **Transcribe** — Whisper model size depending on choice (75 MB – 3.1 GB) in `whisper/`, downloaded from HuggingFace on first use. `whisper.cpp` itself is NOT bundled: the CLI resolves it from PATH, installs via Homebrew (macOS), or builds it from source with git+cmake on first use (`$HYPERFRAMES_WHISPER_PATH` overrides).
- **Remove-background** — `u2net_human_seg` (~168 MB ONNX) in `background-removal/models/`. Peak inference RAM ~1.5 GB.

Run `npx hyperframes doctor` if a command fails because of a missing dependency.
