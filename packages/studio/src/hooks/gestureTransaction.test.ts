// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import type { CommitMutation } from "./gsapScriptCommitTypes";
import { isGestureTransactionCommit, runGestureTransaction } from "./gestureTransaction";

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, width, height } as DOMRect;
}

function runTwoMutationTransaction(
  underlying: CommitMutation,
  firstSelection: DomEditSelection,
  secondSelection = firstSelection,
): Promise<void> {
  return runGestureTransaction({
    element: firstSelection.element,
    label: "Resize layer",
    settle: vi.fn(),
    persist: async (commit) => {
      const commitMutation = commit(underlying);
      await commitMutation(firstSelection, { type: "first" }, { label: "First" });
      await commitMutation(secondSelection, { type: "last" }, { label: "Last", softReload: true });
    },
    restore: vi.fn(),
    skipPixelAssert: true,
  });
}

describe("runGestureTransaction", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("settles synchronously before persist reaches its first await", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const transaction = runGestureTransaction({
      element: document.createElement("div"),
      label: "Resize layer",
      settle: () => order.push("settle"),
      persist: async () => {
        order.push("persist");
        await gate;
        order.push("persisted");
      },
      restore: vi.fn(),
      skipPixelAssert: true,
    });

    expect(order).toEqual(["settle", "persist"]);
    release();
    await transaction;
    expect(order).toEqual(["settle", "persist", "persisted"]);
  });

  it("injects one coalesce key and reloads only the final mutation", async () => {
    const element = document.createElement("div");
    const selection = { element, id: "clip" } as DomEditSelection;
    const underlying = vi.fn<CommitMutation>().mockResolvedValue(undefined);
    const batch = vi.fn<NonNullable<CommitMutation["batch"]>>().mockResolvedValue(undefined);
    underlying.batch = batch;

    await runTwoMutationTransaction(underlying, selection);

    expect(underlying).not.toHaveBeenCalled();
    expect(batch).toHaveBeenCalledTimes(1);
    const [calls, mergedOptions] = batch.mock.calls[0]!;
    const firstOptions = calls[0]!.options;
    const lastOptions = calls[1]!.options;
    expect(calls.map(({ mutation }) => mutation)).toEqual([{ type: "first" }, { type: "last" }]);
    expect(firstOptions.coalesceKey).toBe(lastOptions.coalesceKey);
    expect(firstOptions.coalesceKey).toMatch(/^tx:Resize layer:\d+$/);
    expect(firstOptions.coalesceMs).toBe(Number.POSITIVE_INFINITY);
    expect(lastOptions.coalesceMs).toBe(Number.POSITIVE_INFINITY);
    expect(firstOptions).toMatchObject({ skipReload: true });
    expect(firstOptions.softReload).toBeUndefined();
    expect(lastOptions).toMatchObject({ softReload: true });
    expect(lastOptions.skipReload).toBeUndefined();
    // The transaction owns the undo label — the per-mutation "First"/"Last"
    // labels are overridden so the coalesced entry reads "Resize layer".
    expect(firstOptions.label).toBe("Resize layer");
    expect(lastOptions.label).toBe("Resize layer");
    expect(mergedOptions).toMatchObject({
      label: "Resize layer",
      coalesceKey: firstOptions.coalesceKey,
      coalesceMs: Number.POSITIVE_INFINITY,
      softReload: true,
    });
    expect(mergedOptions.skipReload).toBeUndefined();
  });

  it("collapses two softReload commits into one batch with one reload", async () => {
    const element = document.createElement("div");
    const selection = { element, id: "clip", sourceFile: "index.html" } as DomEditSelection;
    const underlying = vi.fn<CommitMutation>().mockResolvedValue(undefined);
    underlying.batch = vi.fn<NonNullable<CommitMutation["batch"]>>().mockResolvedValue(undefined);

    // Both a resize's size and offset persists request softReload; the batch is
    // one write and one reload.
    await runGestureTransaction({
      element,
      label: "Resize layer",
      settle: vi.fn(),
      persist: async (commit) => {
        const commitMutation = commit(underlying);
        await commitMutation(selection, { type: "size" }, { label: "Resize", softReload: true });
        await commitMutation(selection, { type: "offset" }, { label: "Move", softReload: true });
      },
      restore: vi.fn(),
      skipPixelAssert: true,
    });

    expect(underlying.batch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(underlying.batch!).mock.calls[0]![1]).toMatchObject({ softReload: true });
  });

  it("falls back to sequential dispatch when the commit has no batch capability", async () => {
    const element = document.createElement("div");
    const selection = { element, id: "clip" } as DomEditSelection;
    const underlying = vi.fn<CommitMutation>().mockResolvedValue(undefined);

    await runTwoMutationTransaction(underlying, selection);

    expect(underlying).toHaveBeenCalledTimes(2);
    expect(underlying.mock.calls[0]![2]).toMatchObject({ skipReload: true });
    expect(underlying.mock.calls[1]![2]).toMatchObject({ softReload: true });
  });

  it("keeps a single mutation on the original commit path", async () => {
    const element = document.createElement("div");
    const selection = { element, id: "clip" } as DomEditSelection;
    const underlying = vi.fn<CommitMutation>().mockResolvedValue(undefined);
    const batch = vi.fn<NonNullable<CommitMutation["batch"]>>().mockResolvedValue(undefined);
    underlying.batch = batch;

    await runGestureTransaction({
      element,
      label: "Move layer",
      settle: vi.fn(),
      persist: async (commit) => {
        await commit(underlying)(
          selection,
          { type: "update-property" },
          { label: "Move", softReload: true },
        );
      },
      restore: vi.fn(),
      skipPixelAssert: true,
    });

    expect(underlying).toHaveBeenCalledTimes(1);
    expect(batch).not.toHaveBeenCalled();
  });

  it("does not batch mutations for different source files", async () => {
    const element = document.createElement("div");
    const firstSelection = { element, id: "a", sourceFile: "a.html" } as DomEditSelection;
    const secondSelection = { element, id: "b", sourceFile: "b.html" } as DomEditSelection;
    const underlying = vi.fn<CommitMutation>().mockResolvedValue(undefined);
    const batch = vi.fn<NonNullable<CommitMutation["batch"]>>().mockResolvedValue(undefined);
    underlying.batch = batch;

    await runTwoMutationTransaction(underlying, firstSelection, secondSelection);

    expect(batch).not.toHaveBeenCalled();
    expect(underlying).toHaveBeenCalledTimes(2);
  });

  it("identifies transaction-owned commit wrappers without marking their underlying commit", async () => {
    const underlying = vi.fn<CommitMutation>().mockResolvedValue(undefined);
    let wrapped: CommitMutation | null = null;

    await runGestureTransaction({
      element: document.createElement("div"),
      label: "Move layer",
      settle: vi.fn(),
      persist: async (commit) => {
        wrapped = commit(underlying);
      },
      restore: vi.fn(),
      skipPixelAssert: true,
    });

    expect(isGestureTransactionCommit(underlying)).toBe(false);
    expect(isGestureTransactionCommit(wrapped!)).toBe(true);
  });

  it("restores exactly once and rethrows a persist failure", async () => {
    const error = new Error("persist failed");
    const restore = vi.fn();
    const element = document.createElement("div");
    const selection = { element, id: "clip" } as DomEditSelection;
    const underlying = vi.fn<CommitMutation>().mockResolvedValue(undefined);

    await expect(
      runGestureTransaction({
        element,
        label: "Resize layer",
        settle: vi.fn(),
        persist: async (commit) => {
          await commit(underlying)(selection, { type: "position" }, { label: "Position" });
          throw error;
        },
        restore,
        skipPixelAssert: true,
      }),
    ).rejects.toBe(error);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("measures the box before and after persisting", async () => {
    const element = document.createElement("div");
    const getRect = vi
      .spyOn(element, "getBoundingClientRect")
      .mockReturnValueOnce(rect(10.04, 20.05, 100.05, 80.05))
      .mockReturnValueOnce(rect(11.19, 17.89, 100.29, 78.99));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runGestureTransaction({
      element,
      label: "Resize layer",
      settle: vi.fn(),
      persist: async () => undefined,
      restore: vi.fn(),
    });

    expect(getRect).toHaveBeenCalledTimes(2);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("measures a box undo painted back mid-save as the edit drew it, so before and after agree", async () => {
    const element = document.createElement("div");
    let undone = false;
    const measured: boolean[] = [];
    vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => {
      measured.push(undone);
      return undone ? rect(0, 0, 50, 40) : rect(10, 20, 100, 80);
    });
    const draw = <T>(run: () => T): T => {
      undone = false;
      try {
        return run();
      } finally {
        undone = true;
      }
    };

    await runGestureTransaction({
      element,
      label: "Resize layer",
      settle: vi.fn(),
      persist: async () => void (undone = true),
      restore: vi.fn(),
      draw,
    });

    // Both measurements (before and after) read the box the edit drew.
    expect(measured).toEqual([false, false]);
  });

  it("measures as the edit drew it when undo painted the box back before the transaction began", async () => {
    const element = document.createElement("div");
    let undone = true;
    const measured: boolean[] = [];
    vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => {
      measured.push(undone);
      return undone ? rect(0, 0, 50, 40) : rect(10, 20, 100, 80);
    });
    const draw = <T>(run: () => T): T => {
      undone = false;
      try {
        return run();
      } finally {
        undone = true;
      }
    };

    await runGestureTransaction({
      element,
      label: "Resize layer",
      settle: vi.fn(),
      persist: async () => undefined,
      restore: vi.fn(),
      draw,
    });

    // Both measurements (before and after) read the box the edit drew.
    expect(measured).toEqual([false, false]);
  });

  it("skips the pixel assertion for live position tweens", async () => {
    const element = document.createElement("div");
    const getRect = vi.spyOn(element, "getBoundingClientRect");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runGestureTransaction({
      element,
      label: "Resize layer",
      settle: vi.fn(),
      persist: async () => undefined,
      restore: vi.fn(),
      skipPixelAssert: true,
    });

    expect(getRect).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
