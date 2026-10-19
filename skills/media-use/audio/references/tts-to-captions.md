# TTS → Captions

When no recorded voiceover exists, generate one and obtain word-level caption timing. No TTS provider here returns word timestamps, so timing always comes from transcribing the generated take.

## Path A — the shared audio engine (TTS → transcription in one run)

The engine (`scripts/audio.mjs`) synthesizes each line with ElevenLabs, Kokoro or Gemini and runs transcription on every take automatically. Use the request in [Text to speech](tts.md#engine-voiceover) (or [the Gemini one](tts.md#gemini-narration)), then consume `audio_meta.json` → `voices[].words`, already in the `[{ id, text, start, end }]` shape the captions pipeline consumes.

Verify that transcription preserved the script, especially names, numbers, and
delivery pauses (Gemini's directed reads most of all). If `words` is empty,
resolve the transcription failure before captioning. Generate and align again
after changing the read.

## Path B — standalone Kokoro (TTS, then transcribe)

For a standalone local Kokoro generation, generate the audio, then transcribe:

```bash
npx hyperframes tts script.txt --voice af_heart --output narration.wav
npx hyperframes transcribe narration.wav --model small.en   # voice af_heart is American English
```

Whisper extracts precise word boundaries from the generated audio, so caption timing matches delivery without hand-tuning. Match `--model` to the voice's language (use `small.en` for `a`/`b` prefixes, `small --language <code>` otherwise). Then consume `transcript.json` via the caption references in `captions/`.
