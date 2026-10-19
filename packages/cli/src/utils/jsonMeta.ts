import { VERSION } from "../version.js";

export interface JsonMeta {
  version: string;
  /** Present (and true) only for commands superseded by `check`; absent otherwise. */
  deprecated?: boolean;
}

/**
 * Wrap a JSON payload with the _meta version envelope.
 * Use this in all --json command outputs for consistent agent-friendly metadata.
 *
 * Pass `{ deprecated: true }` from a command superseded by `check` (validate,
 * inspect, layout) to add `_meta.deprecated: true`; every other call site is
 * unaffected — the key is only ever added, never set to `false`.
 */
export function withMeta<T extends object>(
  data: T,
  options?: { deprecated?: boolean },
): T & { _meta: JsonMeta } {
  const meta: JsonMeta = { version: VERSION };
  if (options?.deprecated) meta.deprecated = true;
  return { ...data, _meta: meta };
}

/**
 * One-line deprecation notice for a command superseded by `check`. Always
 * writes to stderr (never stdout), so a --json invocation's stdout stays
 * pure, parseable JSON. Call once per invocation, before the command's own
 * output.
 */
export function printDeprecationNotice(command: string): void {
  process.stderr.write(
    `'hyperframes ${command}' is deprecated and will be removed in a future release. Use 'hyperframes check' instead.\n`,
  );
}
