import { describe, expect, it, vi } from "vitest";
import { observeGsapGesture } from "./gsapGestureOutcome";
import type { CommitMutation, MutationResult } from "./gsapScriptCommitTypes";

const selection = {} as Parameters<CommitMutation>[0];
const mutation = {
  type: "add-keyframe",
  animationId: "private-target",
  properties: { text: "private-content" },
};
function writer(result?: MutationResult): CommitMutation {
  const commit: CommitMutation = async (_selection, _mutation, options) => {
    if (result) options.onResult?.(result);
  };
  commit.batch = async (_calls, options) => {
    if (result) options.onResult?.(result);
  };
  return commit;
}

describe("observeGsapGesture", () => {
  it("reports a multi-write gesture as changed and forwards each writer result", async () => {
    const observed = observeGsapGesture(
      writer({ ok: true, changed: true, mutationChanges: [true] }),
    );
    const onResult = vi.fn();
    await observed.commit!(
      selection,
      { type: "convert-to-keyframes" },
      { label: "Convert", onResult },
    );
    await observed.commit!(selection, mutation, { label: "Add" });
    expect(observed.finish()).toEqual({ ok: true, changed: true });
    expect(onResult).toHaveBeenCalledWith({ ok: true, changed: true, mutationChanges: [true] });
  });

  it("reports a batched write as changed", async () => {
    const observed = observeGsapGesture(
      writer({ ok: true, changed: true, mutationChanges: [true, true] }),
    );
    await observed.commit!.batch!(
      [
        { selection, mutation, options: { label: "Add" } },
        { selection, mutation, options: { label: "Add" } },
      ],
      { label: "Add together" },
    );
    expect(observed.finish().changed).toBe(true);
  });

  it.each([undefined, { ok: true }, { ok: true, changed: false }, { ok: false, changed: true }])(
    "reports no change without a changed successful write (%j)",
    async (result) => {
      const observed = observeGsapGesture(writer(result));
      await observed.commit!(selection, mutation, { label: "Add" });
      expect(observed.finish()).toEqual({ ok: true, changed: false });
    },
  );

  it("reports no change for a missing writer or an unfinished group", async () => {
    expect(observeGsapGesture(null).finish()).toEqual({ ok: true, changed: false });
    const observed = observeGsapGesture(writer());
    await observed.commit!(selection, mutation, { label: "Add" });
    expect(observed.finish(true).changed).toBe(false);
  });

  it("reports a successful plain DOM gesture as changed", () => {
    expect(observeGsapGesture(null).finish(true).changed).toBe(true);
  });

  it.each([[[false, true]], [[true, false]], [undefined]] as const)(
    "reports a changed batch as changed whichever members changed (%j)",
    async (mutationChanges) => {
      const observed = observeGsapGesture(
        writer({
          ok: true,
          changed: true,
          mutationChanges: mutationChanges && [...mutationChanges],
        }),
      );
      await observed.commit!.batch!(
        [mutation, { type: "update-property" }].map((member) => ({
          selection,
          mutation: member,
          options: { label: "Edit" },
        })),
        { label: "Edit" },
      );
      expect(observed.finish()).toEqual({ ok: true, changed: true });
    },
  );
});
