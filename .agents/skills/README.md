# Project-local Codex CLI skills

Skills in this directory are auto-discovered by Codex CLI (verified against
Codex 0.144.3) when the `hyperframes` repo is opened as the working
directory. They are NOT part of the marketplace-distributed plugin (that
set lives under `skills/` and is manifested by `.codex-plugin/`). Two
separate namespaces, on purpose:

- `.agents/skills/` — **repo-native**, run only against this repo
  (doctrine-heavy authoring flows). Codex CLI's
  project-local skill dir.
- `skills/` — **marketplace-distributable**, installed into other
  projects via `npx hyperframes skills` or `npx skills add
heygen-com/hyperframes`.

The parallel set at `.claude/skills/` is a byte-identical copy so
Claude Code users get the same auto-discover behaviour — keep the two
in sync when editing. A `scripts/check-skill-mirror.mjs` check enforces
this at CI time.

Each repo-native skill declares `metadata.internal: true`. That excludes it from
normal `npx skills add` discovery and from `npx skills add ... --all`. A named
`npx skills add ... --skill <name>` still installs a matching skill regardless of
`metadata.internal`; no environment variable is needed. `INSTALL_INTERNAL_SKILLS=1`
opts internal skills into normal discovery and bulk installation. This does not
change local agent discovery.
