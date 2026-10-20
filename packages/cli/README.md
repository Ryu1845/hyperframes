# hyperframes

CLI for creating, previewing, and rendering HTML video compositions.

## Install

```bash
npm install -g @ryu1845/hyperframes
```

Or use directly with npx:

```bash
npx @ryu1845/hyperframes <command>
```

**Requirements:** Node.js >= 22, FFmpeg

## Commands

### `init`

Scaffold a new Hyperframes project from a template:

```bash
npx @ryu1845/hyperframes init my-video
cd my-video
```

### `preview`

Start the live preview studio in your browser:

```bash
npx @ryu1845/hyperframes preview
# Studio: http://localhost:3002/#project/my-video
# Server: http://localhost:3002

npx @ryu1845/hyperframes preview --port 4567
```

In an interactive terminal, the preview stays attached until you press
Ctrl+C. In a non-interactive shell such as a coding-agent session, the same
command starts a managed preview that survives after the command returns. Use
`--background` or `--foreground` to choose explicitly, and manage persistent
previews with `--status`, `--stop`, `--list`, and `--kill-all`. Add `--json` to
managed lifecycle commands for machine-readable output. `--foreground --json`
prints the ready-session envelope once, then remains attached until stopped.

### `audio`

Measure where sounds land: onsets, the moment each sound peaks, loudness and
silence. Give files, or query the film's own clips in film time:

```bash
npx @ryu1845/hyperframes audio sfx/whoosh.mp3
npx @ryu1845/hyperframes audio --at 12 --json
```

### `normalize-audio`

Measure two local authored audio clips with integrated LUFS and match the target
to the unchanged reference. The command is a dry run unless `--write` is passed:

```bash
npx @ryu1845/hyperframes normalize-audio --reference target-audio --target user-audio
npx @ryu1845/hyperframes normalize-audio --reference target-audio --target user-audio --write
```

It updates only the target element's `data-volume` and refuses unsafe boosts
that exceed Studio's +12 dB ceiling or would clip.

### `render`

Render a composition to MP4. Run from the project directory; the positional
argument is the project directory (not a file), so render the project's
`index.html` directly, or point at a specific composition file with `-c`:

```bash
npx @ryu1845/hyperframes render -o output.mp4
npx @ryu1845/hyperframes render -c ./my-composition.html -o output.mp4
```

A render stops when the process that started it exits. To keep one running after
its launcher exits, set `HYPERFRAMES_RENDER_DETACHED=1` and start it in its own
process group, e.g. `bash -c 'set -m; HYPERFRAMES_RENDER_DETACHED=1 npx @ryu1845/hyperframes render -o out.mp4 < /dev/null > render.log 2>&1 &'`.

Piped, non-quiet renders emit a single `@hf-diagnostic ` JSON line when an audio
failure reaches the CLI error handler. Version 1 has `operation: "render"` and
at most 16 `audioFailures`: allowlisted stage, reason, owner, retryable, and
optional subprocess exit code, signal, termination reason and OS code. It omits
messages, stderr, source paths/URLs, element IDs and command arguments. Consumers
must ignore unknown versions and fields. This is local CLI output; uploading it
requires the caller's existing consent and privacy checks. Quiet mode (including
batch JSON mode) emits no diagnostic line.

This covers audio preparation and mix failures, including the typed external
interruption path. Probe failures retain their existing stage/reason but do not
gain subprocess evidence here; browser/FX failures remain classified as internal.

### `lint`

Validate your Hyperframes HTML:

```bash
npx @ryu1845/hyperframes lint ./my-composition
npx @ryu1845/hyperframes lint ./my-composition --json      # JSON output for CI/tooling
npx @ryu1845/hyperframes lint ./my-composition --verbose   # Include info-level findings
```

By default only errors and warnings are shown. Use `--verbose` to also display informational findings (e.g., external script dependency notices). Use `--json` for machine-readable output with `errorCount`, `warningCount`, `infoCount`, and a `findings` array.

### `compositions`

List compositions found in the current project:

```bash
npx @ryu1845/hyperframes compositions
```

### `benchmark`

Run rendering benchmarks:

```bash
npx @ryu1845/hyperframes benchmark ./my-composition.html
```

### `doctor`

Check your environment for required dependencies (Chrome, FFmpeg, Node.js):

```bash
npx @ryu1845/hyperframes doctor
```

### `browser`

Manage the bundled Chrome/Chromium installation:

```bash
npx @ryu1845/hyperframes browser
```

### `info`

Print version and environment info:

```bash
npx @ryu1845/hyperframes info
```

### `docs`

Open the documentation in your browser:

```bash
npx @ryu1845/hyperframes docs
```

## Documentation

Full documentation: [docs/packages/cli.mdx](https://github.com/ryu1845/hyperframes/blob/main/docs/packages/cli.mdx)

## Related packages

- [`@hyperframes/core`](../core) — types, parsers, frame adapters
- [`@hyperframes/engine`](../engine) — rendering engine
- [`@hyperframes/producer`](../producer) — render pipeline
- [`@hyperframes/studio`](../studio) — composition editor UI
