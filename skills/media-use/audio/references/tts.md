# Text To Speech

`npx hyperframes tts` synthesizes locally with Kokoro. It does not accept a
`--provider` or `--words` flag. For ElevenLabs or Gemini, and for word timings
in the same step, use the shared audio engine (`scripts/audio.mjs`, see
[Engine voiceover](#engine-voiceover) below).

> **Say which voice engine will run — a missing key is not a green light to silently use the local voice.** With `$ELEVENLABS_API_KEY` set (and `pip install elevenlabs`) the engine uses ElevenLabs; otherwise it falls back to local Kokoro. Tell the user which one will run before generating, and if they want a cloud voice, ask them to set the key rather than substituting Kokoro. This applies to a one-off "generate a voiceover" request just as much as inside a full workflow.

## Narrating a HyperFrames docs video

Anything that will sit on the HyperFrames docs site uses one narrator, so the
site does not sound like two products.

|                |                                                |
| -------------- | ---------------------------------------------- |
| Voice          | **River** — "Relaxed, Neutral, Informative"    |
| Provider       | ElevenLabs                                     |
| `voice_id`     | `SAz9YHcvj6GT2YYXdXww`                         |
| Model          | `eleven_multilingual_v2`                       |
| Pace           | 145–155 words per minute, with room to breathe |
| Music under it | about −31 LUFS, never masking the voice        |

```bash
curl -s -X POST "https://api.elevenlabs.io/v1/text-to-speech/SAz9YHcvj6GT2YYXdXww" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
  -d '{"text":"...","model_id":"eleven_multilingual_v2"}' -o take.mp3
```

This is the voice every user-journey film on the docs site already uses. Falling
back to local Kokoro because a key was not to hand produces a film that sounds
wrong beside the others — three docs videos were built that way and had to be
re-voiced. If you cannot reach ElevenLabs, say so and stop rather than
substituting a different voice.

Use another voice only for a documented reason, and write the reason down.

## Available routes

Gemini is an explicit alternative to the automatic provider order below. A
request to use Gemini already chooses the provider. Read the Gemini section for
its credential requirement.

| Order | Provider   | Env trigger                                      | Voice IDs                                                                                | Word timestamps    | Audio format |
| ----- | ---------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------ | ------------ |
| 1     | ElevenLabs | `$ELEVENLABS_API_KEY` + `pip install elevenlabs` | ids from the elevenlabs.io voice library (engine default Rachel, `21m00Tcm4TlvDq8ikWAM`) | No (transcription) | mp3          |
| 2     | Kokoro-82M | always (local fallback)                          | `am_michael` (engine default), `af_heart`, … (54 voices)                                 | No (transcription) | wav direct   |

```bash
# Local Kokoro CLI
npx hyperframes tts "Welcome to HyperFrames" -o narration.wav
```

## Engine voiceover

The engine reads `audio_request.json`, synthesizes every line with the chosen
provider, transcribes each take for word timings, and writes `audio_meta.json`.
Provider keys may live in the shell or a project `.env` (auto-loaded, walks up
≤5 dirs; the shell wins). Save this as `audio_request.json`:

```json
{
  "provider": "elevenlabs",
  "voice": "SAz9YHcvj6GT2YYXdXww",
  "lines": [{ "id": "narration", "text": "Welcome to HyperFrames." }],
  "bgm": { "mode": "none" }
}
```

```bash
node <SKILL_DIR>/audio/scripts/audio.mjs \
  --request ./audio_request.json --hyperframes . --out ./audio_meta.json --only tts
```

- **Provider:** `auto` (or omitted) takes the order above; `elevenlabs`, `kokoro` and `gemini` pin one. `--provider` on the command line overrides the request.
- **Voice:** `voice` (or `--voice`) must be an id of the chosen provider. Omitted, each provider uses its fixed default; Kokoro has no default off English, so pass a voice for `lang` other than `en`.
- **Output:** `assets/voice/<id>.wav` per line (the next free name when a file of yours already has it); `voices[].path` says which.
- **Words:** `voices[].words` holds the flat `[{id,text,start,end}]` shape below, drop-in for the captions pipeline.

## When to use which provider

| Goal                                                      | Use                                                       |
| --------------------------------------------------------- | --------------------------------------------------------- |
| Drop-in cloud TTS, big voice catalog                      | **ElevenLabs**                                            |
| Offline, no API key, fast iteration                       | **Kokoro**                                                |
| Directed delivery with Gemini prebuilt or custom voices   | **Gemini** (explicit selection; transcription for timing) |
| Non-English multilingual with deterministic phonemization | **Kokoro** (`ef_dora`, `jf_alpha`, `zf_xiaobei`, …)       |

## Gemini narration

Use the shared audio engine, not `hyperframes tts`. Authenticate with either:

- `GEMINI_API_KEY` or `GOOGLE_API_KEY` (first set key wins).
- A service-account JSON file at `GOOGLE_APPLICATION_CREDENTIALS`, or injected
  JSON in `GCS_CREDS`. Install `google-auth requests` in the Python 3 environment
  used by the helper. A configured file takes precedence over injected JSON.

API keys take precedence over service accounts: unset both key variables to use
OAuth. Never put credentials in a request file or composition. The helper
obtains a fresh OAuth token for each generation with the
`generative-language.retriever` scope. The quota project resolves from
`GOOGLE_CLOUD_PROJECT`, then `GCLOUD_PROJECT_ID`, then the service-account JSON.
User ADC files and metadata-server authentication are not supported.

Both routes call the Gemini Developer Interactions API, not Cloud TTS or Vertex
AI. Those APIs have separate model catalogs and access requirements.

Save this as `audio_request.json` in the project:

```json
{
  "provider": "gemini",
  "tts_model": "gemini-3.8-flash-tts",
  "voice": "Kore",
  "lang": "en",
  "style": "Warm, clear, conversational. Leave a short pause between sentences.",
  "lines": [
    { "id": "intro", "text": "Every word has a moment. Let the picture follow the voice." }
  ],
  "bgm": { "mode": "none" }
}
```

```bash
node <SKILL_DIR>/audio/scripts/audio.mjs \
  --request ./audio_request.json --hyperframes . --out ./audio_meta.json --only tts
```

The engine saves `assets/voice/intro.wav` (or `intro-2.wav` when a file of yours already has that name; `voices[].path` says which), measures its duration, and transcribes
it into `voices[].words` in `audio_meta.json`. Check that every requested line
has audio and nonempty word timings before building a captioned video. Review
the timings against the actual audio; transcription is estimated alignment,
not native TTS timestamps. Do not distribute words evenly across a clip.

- **Models:** `gemini-3.8-flash-tts` (default), `gemini-3.8-flash-lite-tts`,
  `gemini-3.1-flash-tts-preview`, `gemini-2.5-pro-preview-tts`, and
  `gemini-2.5-flash-preview-tts`. Use these exact Developer API IDs; Cloud TTS
  aliases such as `gemini-2.5-flash-tts` are not accepted.
- **Voice:** `Kore` by default; pass another prebuilt voice or an existing custom
  voice ID for 3.8. Older models require prebuilt voices. Creating or replicating
  voices is outside this helper.
- **Delivery:** Put directions in `style`, not in spoken `text`. Each line can
  override `style`. 3.8 uses structured annotations; older models receive a
  delivery prompt before the transcript. Check that directions were not spoken.
  Use style for pacing; numeric `speed` must be omitted or 1.
- **Audio:** 3.8 returns a complete WAV. Older models return mono 16-bit PCM,
  which the helper wraps as WAV at the returned sample rate without resampling.
  No generation calls run during playback or rendering.
- **Timing:** This adapter requests no native word timestamps. It uses the
  existing transcription pass. `lang` selects transcription language; Gemini
  infers speech language from the text.
- **Workflow adapters:** Product-launch, faceless-explainer, and PR-video audio
  scripts accept `--provider gemini --voice Kore --tts-model gemini-3.8-flash-tts
--style "Warm and clear"`.

An API error is reported as a failed line; an explicitly chosen Gemini voice
never silently falls back to another provider. Check the engine's anomalies
and output metadata, not only its exit code.

API contract: [Google's speech generation guide](https://ai.google.dev/gemini-api/docs/speech-generation).

## ffmpeg requirement

The engine measures every take with `ffprobe` (falling back to `ffmpeg`) and
transcribes it before it lands in `audio_meta.json`; without either on PATH a
take is dropped as having a bad duration. The local Kokoro CLI writes wav
directly.

## Voice selection (Kokoro)

Default `af_heart`. Curated picks:

| Content type      | Voice                  |
| ----------------- | ---------------------- |
| Product demo      | `af_heart`, `af_nova`  |
| Tutorial / how-to | `am_adam`, `bf_emma`   |
| Marketing / promo | `af_sky`, `am_michael` |
| Documentation     | `bf_emma`, `bm_george` |
| Casual / social   | `af_heart`, `af_sky`   |

Run `npx hyperframes tts --list` for the bundled set.

## Multilingual (Kokoro voice prefix → language)

The first letter of a Kokoro voice ID picks the phonemizer language; `--lang` overrides auto-detection.

| Prefix | Language             |
| ------ | -------------------- |
| `a`    | American English     |
| `b`    | British English      |
| `e`    | Spanish              |
| `f`    | French               |
| `h`    | Hindi                |
| `i`    | Italian              |
| `j`    | Japanese             |
| `p`    | Brazilian Portuguese |
| `z`    | Mandarin             |

```bash
npx hyperframes tts "La reunión empieza a las nueve" --voice ef_dora
npx hyperframes tts "Today is a nice day" --voice af_heart
```

Valid `--lang` codes (only needed to override the voice's auto-detected language): `en-us`, `en-gb`, `es`, `fr-fr`, `hi`, `it`, `pt-br`, `ja`, `zh`.

Non-English phonemization requires `espeak-ng` system-wide (`brew install espeak-ng` / `apt-get install espeak-ng`).

## Speed

- `0.7-0.8` — tutorial, complex content, accessibility
- `1.0` — natural pace (default)
- `1.1-1.2` — intros, transitions, upbeat content
- `1.5+` — rarely appropriate, test carefully

The `hyperframes tts` command honors `--speed` for Kokoro. Provider-specific
helpers document their own pacing controls.

## Long scripts

Past a few paragraphs, write the text to a `.txt` file and pass the path. Inputs over ~5 minutes of speech may benefit from splitting into segments.

## Word-timestamp shape

The engine writes `voices[].words` in the same flat shape `transcribe` produces — drop-in compatible with the captions pipeline:

```json
[
  { "id": "w0", "text": "Hi", "start": 0.0, "end": 0.21 },
  { "id": "w1", "text": "there", "start": 0.22, "end": 0.55 }
]
```

For ElevenLabs / Kokoro, run `npx hyperframes transcribe narration.wav --model small.en` to get the same shape.
