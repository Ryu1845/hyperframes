/**
 * `docs/schema/hyperframes.json` is authored by hand (sync-schemas.ts mirrors
 * only the registry schemas and skips this one), sets `additionalProperties:
 * false` at both levels, and is the schema every generated `hyperframes.json`
 * points at. So a new config key that lands in code but not in the schema turns
 * a valid, committed config into one that fails validation in any schema-aware
 * editor, with nothing in CI to notice.
 *
 * This pins the two together by validating a config that exercises every key
 * the CLI can write, nested objects included. A key-name check alone is not
 * enough: `paths` and `media` are objects with their own
 * `additionalProperties: false`, so a new field on either would recreate the
 * same break one level down.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  DEFAULT_PROJECT_CONFIG,
  type ProjectConfig,
  type ProjectConfigMedia,
} from "./projectConfig.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCHEMA_PATH = resolve(REPO_ROOT, "docs/schema/hyperframes.json");

/**
 * A config exercising every key the CLI can write, at every level. Typed, so a
 * new top-level or `media` field is a compile error here until it is listed,
 * and then a validation failure until it is declared in the schema.
 */
const EVERY_WRITTEN_KEY: Required<ProjectConfig> = {
  $schema:
    "https://raw.githubusercontent.com/ryu1845/hyperframes/main/docs/schema/hyperframes.json",
  registry: "https://example.test/registry",
  paths: DEFAULT_PROJECT_CONFIG.paths,
  media: { autoProxy: true } satisfies Required<ProjectConfigMedia>,
};

describe("hyperframes.json schema", () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8")) as Record<string, unknown>;
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);

  it("accepts a config using every key the CLI can write", () => {
    // Guard the guard: without a closed schema at both levels the assertion
    // below would pass for an undeclared key rather than failing.
    expect(schema.additionalProperties).toBe(false);
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.paths?.additionalProperties).toBe(false);
    expect(properties.media?.additionalProperties).toBe(false);

    expect(validate(EVERY_WRITTEN_KEY), JSON.stringify(validate.errors)).toBe(true);
  });

  // Proves the check above can fail, rather than passing because ajv was
  // handed something it never rejects.
  it("rejects a key the schema does not declare, at either level", () => {
    expect(validate({ ...EVERY_WRITTEN_KEY, unknownTopLevelKey: 1 })).toBe(false);
    expect(
      validate({
        ...EVERY_WRITTEN_KEY,
        paths: { ...EVERY_WRITTEN_KEY.paths, unknownPathKey: "x" },
      }),
    ).toBe(false);
    expect(
      validate({
        ...EVERY_WRITTEN_KEY,
        media: { ...EVERY_WRITTEN_KEY.media, unknownMediaKey: 1 },
      }),
    ).toBe(false);
  });
});
