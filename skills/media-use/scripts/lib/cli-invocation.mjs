// The hyperframes CLI for execFileSync/spawnSync call sites that must hard-fail
// rather than fall through to another provider. The CLI ships as a standalone
// binary: the one that started this script when there is one, else the one on PATH.
export function resolveCliInvocation(argv, opts, env = process.env) {
  return { cmd: env.HYPERFRAMES_BINARY || "hyperframes", args: [...argv], opts };
}
