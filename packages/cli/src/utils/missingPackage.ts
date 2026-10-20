import { c } from "../ui/colors.js";

/**
 * True only when `pkg` itself is absent. Node's message for a missing dependency of an
 * installed `pkg` also names `pkg` (in the importer path), so match the quoted specifier.
 */
export function isMissingPackageError(error: unknown, pkg: string): boolean {
  return (
    (error as NodeJS.ErrnoException)?.code === "ERR_MODULE_NOT_FOUND" &&
    error instanceof Error &&
    error.message.includes(`Cannot find package '${pkg}'`)
  );
}

// The cloud adapters are workspace packages the CLI keeps external and neither the
// binary nor any registry ships, so they resolve only inside a source checkout.
export function missingPackageMessage(pkg: string, command: string): string {
  return (
    `${c.error(`${pkg} is not available.`)} The ${c.accent(command)} command needs it at runtime,\n` +
    `and it is not bundled with the hyperframes binary. Run the command from a source checkout:\n` +
    `  ${c.accent("git clone https://github.com/ryu1845/hyperframes && cd hyperframes && bun install && bun run build")}\n` +
    `  ${c.accent(`bun packages/cli/src/cli.ts ${command.replace(/^hyperframes /, "")}`)}`
  );
}
