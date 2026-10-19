# LUT library (authoring)

`index.json` is the agent-consumed catalog of color-grade looks. Each entry resolves
on demand — no `.cube` bodies are committed to the repo.

Each look has:

- `id`, `description`, `tags`, `intensity` — matching + application metadata.
- `params` — a deterministic `buildCube` spec. Resolve builds the `.cube` from it,
  validates it, and freezes it into the project; nothing is downloaded, so it works
  the same offline (`--local-only`).
- `url` (optional) — a hosted `.cube` to download, validate, and freeze instead.
  With `params` also set, `params` is the fallback when the download or validation
  fails and the only path under `--local-only`. The bundled looks carry no `url`.

An entry needs at least one of `params` or `url`; prefer `params`, so resolution
never depends on the network.

## Adding a look

1. Tune the look with `resolve -t lut --params '{...}'` and inspect it with
   `hyperframes grade-compare`.
2. Add an entry to `index.json` with those `params`, a `description`, and the
   `tags` an agent's intent would use.
