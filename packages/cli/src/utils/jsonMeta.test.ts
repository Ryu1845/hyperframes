import { describe, expect, it, vi } from "vitest";
import { VERSION } from "../version.js";
import { printDeprecationNotice, withMeta } from "./jsonMeta.js";

describe("withMeta", () => {
  it("adds the CLI version and nothing else by default", () => {
    expect(withMeta({ ok: true })).toEqual({ ok: true, _meta: { version: VERSION } });
  });

  it("marks a command superseded by check as deprecated", () => {
    expect(withMeta({}, { deprecated: true })._meta).toEqual({
      version: VERSION,
      deprecated: true,
    });
  });
});

describe("printDeprecationNotice", () => {
  it("writes to stderr only, so --json stdout stays parseable", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      printDeprecationNotice("validate");
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining("'hyperframes validate'"));
      expect(stdout).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
  });
});
