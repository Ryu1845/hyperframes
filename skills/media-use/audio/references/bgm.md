# Background music (BGM)

One music bed per composition, produced by the shared audio engine (`scripts/audio.mjs` → `scripts/lib/bgm.mjs`). There is no music catalog: the engine **generates** a WAV from a mood prompt — Google Lyria when a Gemini key is set, else local MusicGen. There is **no `hyperframes bgm` command**; the engine spawns `scripts/lyria-recipe.py` or an inline MusicGen script directly. `resolve --type bgm` has no provider either: generate the bed here, then record a file you made elsewhere with `resolve --from <file> --type bgm --source generated`. When the host app gives you its own music tool, use that instead.

> **Say which engine will run.** With `$GEMINI_API_KEY` / `$GOOGLE_API_KEY` set the bed comes from Lyria; without one it is generated locally with MusicGen (slow on CPU, ~300 MB model on first run). Tell the user before generating, so a missing key is their choice rather than a surprise. This applies to a one-off "generate a BGM" request just as much as inside a full workflow.

## Driving it from the request

`audio_request.json` → `bgm: { mode?, query?, prompt? }`:

- **`mode`** — `generate | none`. Omit for `generate`. Any other value (such as the old catalog `retrieve`) is skipped with an anomaly, never turned into a detached generate the caller may have no step to await.
- **`query`** — the mood, used as a fallback seed for prompt inference (e.g. a storyboard's `music:` field, falling back to `message` → `arc` → `"calm cinematic underscore"`).
- **`prompt`** — an explicit full prompt for generation; omit and the engine infers one (see Mood inference). Optional `blob` / `archetype` / `arc` feed that inference. The workflow adapters pass a storyboard's `music:` mood as `prompt`.

The engine keeps a file of yours already at the output name: it writes the next free name (`track-2.wav`), reports it as an anomaly, and `bgm.path` carries the real path.

`volume` comes from the engine's `bgmDefaultVolume()`: `BGM_BED_VOLUME` (currently `0.12` ≈ -18 dB — a bed under the voice) under narration, `BGM_SILENT_VOLUME` (currently `0.9`) for a silent film (no voice). Tune those constants in `scripts/lib/bgm-volume.mjs`, not call sites. An explicit `volume` in `audio_meta.json` always overrides this default.

For short launch videos, do not assume the beginning of the generated file is the best edit point. Check the opening against later five-second sections. If the track starts with a quiet build but a later section has a stronger, clean musical entrance, trim from that section and apply a short fade-in and longer fade-out. Repeat this check whenever the composition duration changes; the final music file must cover the full cut without a silent tail.

## Generation — Lyria → MusicGen

Spawned **detached** so voice work isn't blocked; `audio_meta.bgm_pending: true` and `bgm_pid` / `bgm_log` are set until it finishes. **Run `scripts/wait-bgm.mjs` before assembling** — it polls the output file / process / log, detects crashes, and writes `bgm_status.json` (`status: ready | failed | timeout | disabled`). A failed/absent track is simply omitted; it never blocks voice/SFX. The product-launch, faceless-explainer and PR-video audio adapters run `wait-bgm.mjs` themselves after the engine returns (`--bgm-timeout-ms`, default 10 minutes) and fold its status back into `audio_meta.json`.

| Order | Provider                             | Env / deps                                                                            | Speed                                   | Quality                     |
| ----- | ------------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------- |
| 1     | Google Lyria RealTime                | `$GEMINI_API_KEY` or `$GOOGLE_API_KEY` + `google-genai` (auto-installed on demand)    | Real-time stream (≈ requested duration) | Production-grade            |
| 2     | MusicGen (`facebook/musicgen-small`) | Python `transformers + torch + soundfile + numpy` (~300 MB first run; auto-installed) | Slow on CPU; fast on Apple MPS / CUDA   | Decent; prompt-only control |

Output → `assets/bgm/track.wav`, target = total voice duration. MusicGen generates **one** seed clip (≤28–30s, under the decoder's positional limit) then crossfade-loops it up to the target (or trims down if shorter), avoiding per-segment seams. Backend selection is by what can actually **run**: Lyria only when `import google.genai` succeeds, else MusicGen; if neither can be made to run, BGM is skipped (voice + SFX still render).

## Mood inference (the generate prompt)

`inferBgmPrompt()` in `scripts/lib/bgm.mjs`: an explicit `prompt` wins; otherwise industry-keyword **base** → narrative-**archetype** shape → emotional-**arc** tiebreaker.

| Match in `blob` / `query`                              | Base prompt                                                                 | BPM |
| ------------------------------------------------------ | --------------------------------------------------------------------------- | --- |
| `crypto / nft / web3 / defi / token / blockchain`      | atmospheric electronic, deep bass, futuristic synths, restrained percussion | 100 |
| `finance / fintech / bank / payment / invest / wealth` | calm cinematic, soft strings, subtle piano, restrained percussion           | 92  |
| `creative / agency / design / studio / art / brand`    | playful electronic, warm pads, light percussion                             | 115 |
| _(default: SaaS / tech / platform)_                    | uplifting corporate tech, bright modern piano with synth pads               | 108 |

Archetype then reshapes the arc — PAS → "MINOR to MAJOR" build; BAB / future-pacing → aspirational rising; feature-cascade → +10 BPM driving; demo-loop → −8 BPM minimal. The emotional arc breaks remaining ties (tension→relief, excitement, trust/reassurance).

## Lyria knobs (direct recipe use)

The engine bakes BPM / scale into the **prompt text** (via the inference above) and passes only `--output` / `--duration` / `--prompt` to the recipe. If you invoke `scripts/lyria-recipe.py` directly you can also set: `--bpm` (90–110 calm, 110–130 energetic), `--brightness` (0–1, ≥0.7 promotional), `--density` (0–1, higher = fuller), `--scale` (`MAJOR` / `MINOR` / `PENTATONIC` / …), `--negative-prompt` (styles to exclude). MusicGen ignores all of these — put the mood in the prompt.

## Failure modes

| Failure                                       | Behavior                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Unsupported `mode` (e.g. `retrieve`)          | Skipped with an anomaly. Use `mode: generate` or omit `mode`.                            |
| Neither Lyria nor MusicGen can run (generate) | `bgm` disabled with a `pip install …` hint. Voice + SFX still render.                    |
| Generate still rendering at assemble time     | `bgm_pending: true`; `wait-bgm.mjs` waits/checks and writes `bgm_status.json` first.     |
| Generate crashed                              | `wait-bgm.mjs` → `bgm_status.json { status: "failed" }`; the `<audio>` track is omitted. |

BGM failure never blocks a render.
