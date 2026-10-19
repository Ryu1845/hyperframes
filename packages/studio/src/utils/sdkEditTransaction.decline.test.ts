import { describe, expect, it } from "vitest";
import { declinedCutover, failedCutover } from "./sdkEditTransaction";

describe("cutover results", () => {
  it("returns a decline that names its reason", () => {
    expect(declinedCutover("target_not_found")).toEqual({
      status: "declined",
      reason: "target_not_found",
    });
  });

  it("wraps a non-Error failure so callers can always throw it", () => {
    const result = failedCutover("refused");
    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.error).toBeInstanceOf(Error);
    expect(result.status === "failed" && result.error.message).toBe("refused");
  });
});
