import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { describe, expect, it } from "vitest";
import { assertGsapEditPersisted, directEditOutcomeForProperties } from "./gsapEditOutcome";

/** Minimal animation that writes `x`, so the editability check actually runs. */
function animation(overrides: Partial<GsapAnimation> = {}): GsapAnimation {
  return {
    id: "a1",
    targetSelector: "#box",
    method: "to",
    position: 0,
    properties: { x: 100 },
    ...overrides,
  } as GsapAnimation;
}

const POSITION = new Set(["x"]);

describe("a blocked GSAP edit names which of the nine causes it hit", () => {
  // The three causes inside assertGsapAnimationDirectlyEditable share one
  // message, so only the detail distinguishes them. Asserted through the
  // exported wrapper because that is the path a real edit takes — and the
  // wrapper used to rebuild the outcome from `reason` alone, dropping it.
  it("reports a runtime-dynamic provenance", () => {
    const outcome = directEditOutcomeForProperties(
      [animation({ provenance: { kind: "runtime-dynamic" } })],
      POSITION,
    );
    expect(outcome).toEqual({
      status: "blocked",
      reason: "source-uneditable",
      detail: "provenance-runtime-dynamic",
    });
  });

  it("reports unresolved keyframes separately from provenance", () => {
    const outcome = directEditOutcomeForProperties(
      [animation({ hasUnresolvedKeyframes: true })],
      POSITION,
    );
    expect(outcome).toEqual({
      status: "blocked",
      reason: "source-uneditable",
      detail: "unresolved-keyframes",
    });
  });

  it("reports an unresolved selector separately from provenance", () => {
    const outcome = directEditOutcomeForProperties(
      [animation({ hasUnresolvedSelector: true })],
      POSITION,
    );
    expect(outcome).toEqual({
      status: "blocked",
      reason: "source-uneditable",
      detail: "unresolved-selector",
    });
  });

  it("still routes a helper or loop to unroll, which has its own message", () => {
    const outcome = directEditOutcomeForProperties(
      [animation({ provenance: { kind: "loop" } })],
      POSITION,
    );
    expect(outcome).toEqual({ status: "blocked", reason: "unroll-required", detail: undefined });
  });

  it("leaves a literal tween editable", () => {
    expect(directEditOutcomeForProperties([animation()], POSITION)).toEqual({
      status: "persisted",
    });
  });

  it("carries the detail through a returned outcome, not just a thrown one", () => {
    // gsapRuntimeBridge returns blocked outcomes rather than throwing.
    expect(() =>
      assertGsapEditPersisted({
        status: "blocked",
        reason: "source-uneditable",
        detail: "no-position-tween",
      }),
    ).toThrow(
      expect.objectContaining({ name: "GsapEditBlockedError", detail: "no-position-tween" }),
    );
  });
});
