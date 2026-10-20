# Ownership matrix, usage stats, privacy

Maintainer-facing reference. Nothing here changes how you resolve or operate on media.

## What it owns (the gaps HyperFrames leaves)

HyperFrames owns media _playback_; media-use owns everything else. Each row is enforced by `packages/cli/src/media-use/lib/coverage.test.mjs` so the claim can't rot.

| HyperFrames gap                            | media-use owns it via                                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Audio-only, no image/icon                  | `resolve --type image` (local mflux, codex upsell); icons are authored as SVG and recorded with `resolve --type icon --from`                                                         |
| No third-party brand logos                 | `resolve --type logo` (theSVG → GitHub org avatar → domain favicon)                                                                                                                  |
| No voice / audio generation                | `resolve --type voice` (local Kokoro) + the audio engine (`audio/scripts/audio.mjs`: ElevenLabs / Kokoro / Gemini voice, Lyria / MusicGen music)                                     |
| Scattered/duplicated audio engine          | one consolidated engine under `audio/` (hyperframes-media retired)                                                                                                                   |
| No agent media-ops (cut/reframe/transform) | `references/operations.md` + `resolve --from` to register outputs                                                                                                                    |
| No transcript-driven cutting               | `scripts/transcript-cut.mjs` compiles word-timestamp edits into cut lists                                                                                                            |
| No auto-duck / publish loudness            | `scripts/audio-duck.mjs` + `references/operations.md` loudnorm/sidechain recipes                                                                                                     |
| No cross-project memory                    | global content-addressed cache + auto-promote (`~/.media`)                                                                                                                           |
| Grade recipes and LUT freezing             | `resolve --type grade` emits a paste-ready recipe and `resolve --type lut` freezes validated `.cube` files; direct element analysis/authoring lives in `hyperframes media-treatment` |
| No image generation                        | `resolve --type image` — RAM-graded local mflux (FLUX), codex `image_gen` upsell                                                                                                     |
| No video generation                        | `resolve --type video` — local LTX (`videogen` ladder)                                                                                                                               |
| Weak local-model defaults                  | RAM-graded local ladders (Kokoro, Parakeet, mflux, LTX) as the default free, private path                                                                                            |

## Usage stats

Use `resolve --stats` for a local, shareable report over the current project's `.media/` manifest, the global `~/.media/` cache, and local resolve misses. Human output is compact; add `--json` for a single machine-readable object, and `--days N` to window timestamped records.

```bash
hyperframes media-use resolve --stats --project . --days 7
# media-use stats
# total resolves: 12
# misses: 2
# hit rate: 86%
```

## Privacy

media-use sends no usage telemetry. Resolve records, misses and stats stay on
disk (`.media/` in the project, `~/.media/` globally); the only network calls are
the providers a resolve or the audio engine actually uses (Openverse, the
registry's SFX index, the logo tiers, codex, ElevenLabs, Gemini / Lyria), and `--local-only` skips every one of
them on the resolve side.
