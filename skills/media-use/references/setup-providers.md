# Setup and providers — install, keys, RAM ladders, forcing a provider

## Setup

Only `ffmpeg`/`ffprobe` are strictly required. Before resolving anything, verify
setup with:

```bash
npx hyperframes media-use resolve --doctor
```

It checks the bundled SFX library, `ffmpeg`, `ffprobe` and the Node version.
Every other tool below is opt-in: install one to unlock its type.

## Providers

media-use holds no keys; every external tool owns its auth. Generation is
local-first: mflux for image, Kokoro for voice, Parakeet for transcription, and
LTX for video run on-device (free, private, offline once cached); the `codex`
CLI is the image upsell on a ChatGPT subscription. Music and sound effects from
a host app's own tools come first when the host has them. `resolve` spec-checks
AVAILABLE RAM for the local ladders inside the CLI (the image tiers are listed in
`references/operations.md`).

| Type      | Provider / path                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| bgm       | no catalog provider: generate with the audio engine (Lyria with a Gemini key, else local MusicGen), then `--from`; a host music tool first |
| sfx       | Openverse (CC0 / CC BY, no account), bundled library offline; a host app's own sound tools come first                                      |
| image     | local mflux (RAM-graded FLUX ladder), then the codex `image_gen` upsell                                                                    |
| voice     | local **Kokoro** (free, on-device; `--voice-id` picks the voice); the audio engine adds ElevenLabs and Gemini (`audio/references/tts.md`)  |
| icon      | no catalog provider: author an SVG (or generate with `--type image`), then `--from`                                                        |
| logo      | theSVG (thesvg.org), then GitHub org avatar, then domain favicon (all free)                                                                |
| grade/lut | local core-preset map, the bundled params look index, deterministic `buildCube` fallback                                                   |
| video     | local LTX (`videogen` ladder)                                                                                                              |

For bgm and icon, `resolve` misses with a typed `code` (`no_bgm_provider`,
`no_icon_provider`) and a `fix`; record the file you made with
`resolve --from <file> --type <bgm|icon> --source generated` so it joins the
manifest and the global cache. Cost rule (X4): the agent confirms before an
agent-initiated paid call; a user-requested one just runs.

To force a specific generator (e.g. a user says "make this image with codex"),
pass `--provider codex`: it pins resolution to that provider and skips the
local-first default. See `references/operations.md` for the RAM ladders and
provider recipes.

`--local-only` skips every network provider (Openverse, codex, the logo tiers),
leaving the project + global cache and any installed local provider.

## CLI tools used (what to run, and how to enable each)

`resolve` auto-cascades; each provider shells one CLI. Without a tool on PATH,
its provider prints a one-line diagnostic to stderr and resolve falls through
where another provider exists (e.g. no `mflux` -> codex image upsell; no
`parakeet-mlx` -> whisper.cpp).

| Tool               | Serves                                                                      | Install                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ffmpeg`/`ffprobe` | adopt probing, smart-grade signalstats, cut, duck bake, loudnorm            | system package (`brew install ffmpeg`)                                                                                                                                                      |
| `mflux-generate`   | local image gen (FLUX), best-for-RAM                                        | `uv venv ~/.venvs/mflux && VIRTUAL_ENV=~/.venvs/mflux uv pip install mflux==0.9.6`                                                                                                          |
| `codex`            | image gen upsell (ChatGPT sub)                                              | Codex CLI, logged in via ChatGPT (owns its own auth)                                                                                                                                        |
| `parakeet-mlx`     | local transcription (default ASR, best) on Apple Silicon                    | `uv venv ~/.venvs/parakeet && VIRTUAL_ENV=~/.venvs/parakeet uv pip install parakeet-mlx`                                                                                                    |
| `ltx-2-mlx`        | local video gen                                                             | `git clone https://github.com/dgrauet/ltx-2-mlx && cd ltx-2-mlx && uv sync --all-extras`                                                                                                    |
| `npx hyperframes`  | Kokoro TTS (voice), Parakeet or whisper.cpp (transcribe), remove-background | via the hyperframes CLI; Parakeet on macOS, Windows and glibc 2.32+ Linux: `npx hyperframes models install parakeet`; whisper.cpp is built on first use (Homebrew on macOS, else git+cmake) |

The RAM-graded local-model shortlist + exact per-tier install/invoke lives in
the CLI's bundled media-use engine, not in the standalone skill. The audio
engine's own keys and Python deps (ElevenLabs, Lyria, MusicGen, Kokoro) are in
`audio/references/requirements.md`.
