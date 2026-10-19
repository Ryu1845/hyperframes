import { strict as assert } from "node:assert";
import { test } from "node:test";
import { versionLessThan } from "./semver.mjs";

test("versionLessThan compares numerically and fails open on unparsable input", () => {
  assert.equal(versionLessThan("v17.9.1", "18.0.0"), true);
  assert.equal(versionLessThan("18.10.0", "18.9.0"), false);
  assert.equal(versionLessThan("18.0.0", "18.0.0"), false);
  assert.equal(versionLessThan("nightly", "18.0.0"), false);
});
