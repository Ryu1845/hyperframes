# Project-local Claude Code skills

Skills in this directory are auto-discovered by Claude Code when the
`hyperframes` repo is opened as the working directory. They are NOT part of
the marketplace-distributed plugin (that set lives under `skills/` and is
manifested by `.claude-plugin/`). Two separate namespaces, on purpose:

- `.claude/skills/` — **repo-native**, run only against this repo (doctrine-heavy authoring flows). Claude Code's
  project-local skill dir.
- `skills/` — **marketplace-distributable**, installed into other projects
  via `hyperframes skills` or `npx skills add ryu1845/hyperframes`.

> **Warning:** Never run `npx skills add ... --all` from inside a HyperFrames checkout: it selects the OpenClaw target, whose `skills/` directory is the repo's own `skills/`, and removes each existing `skills/<name>` destination before linking. A fresh clone restores tracked source, but uncommitted work under `skills/` does not recover. Run it from an empty directory or from your own project root. This happens regardless of `metadata.internal`.

The parallel set at `.agents/skills/` is a byte-identical copy so Codex
CLI users get the same auto-discover behaviour — keep the two in sync
when editing. A `scripts/check-skill-mirror.mjs` check enforces this at
CI time.

Each repo-native skill declares `metadata.internal: true`. That excludes it from
normal `npx skills add` discovery and from `npx skills add ... --all`. A named
`npx skills add ... --skill <name>` still installs a matching skill regardless of
`metadata.internal`; no environment variable is needed. `INSTALL_INTERNAL_SKILLS=1`
opts internal skills into normal discovery and bulk installation. This does not
change local agent discovery.
