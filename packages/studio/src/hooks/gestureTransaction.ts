import type {
  CommitMutation,
  CommitMutationCall,
  CommitMutationOptions,
} from "./gsapScriptCommitTypes";
import { makeStudioDebugLogger } from "../utils/studioDebug";

type PixelRect = Pick<DOMRect, "x" | "y" | "width" | "height">;

export type TxCommit = (commitMutation: CommitMutation) => CommitMutation;

export interface GestureTransaction {
  element: HTMLElement;
  label: string;
  settle(): void;
  persist(commit: TxCommit, coalesceKey: string): Promise<void>;
  afterBufferedCommitsSaved?(): Promise<void>;
  restore(): void;
  skipPixelAssert?: boolean;
  draw?<T>(run: () => T): T;
}

let transactionCounter = 0;
const transactionCommits = new WeakSet<CommitMutation>();

/** Whether a commit function already belongs to an active gesture transaction. */
export function isGestureTransactionCommit(commitMutation: CommitMutation): boolean {
  return transactionCommits.has(commitMutation);
}

function readPixelRect(element: HTMLElement): PixelRect {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}

function transactionOptions(
  options: CommitMutationOptions,
  coalesceKey: string,
  label: string,
): CommitMutationOptions {
  // The transaction owns the undo label: every wrapped mutation records under
  // `label`, so the coalesced entry reads as the gesture (e.g. "Resize layer")
  // rather than whichever sub-mutation happened to land last (the offset
  // persist's "Move layer").
  const { coalesceKey: _coalesceKey, skipReload: _skipReload, softReload, ...rest } = options;
  return softReload
    ? { ...rest, label, softReload: true, coalesceKey, coalesceMs: Number.POSITIVE_INFINITY }
    : { ...rest, label, skipReload: true, coalesceKey, coalesceMs: Number.POSITIVE_INFINITY };
}

function pixelDelta(before: PixelRect, after: PixelRect): PixelRect {
  return {
    x: after.x - before.x,
    y: after.y - before.y,
    width: after.width - before.width,
    height: after.height - before.height,
  };
}

function exceedsPixelTolerance(delta: PixelRect): boolean {
  return Object.values(delta).some((value) => Math.abs(value) > 1);
}

type BufferedCommit = CommitMutationCall & { dispatch: CommitMutation };

function mergeTransactionOptions(calls: BufferedCommit[]): CommitMutationOptions {
  const reloadCall = calls.find(({ options }) => options.softReload);
  const source = reloadCall?.options ?? calls.at(-1)?.options;
  if (!source) throw new Error("Cannot merge an empty gesture transaction");
  const { skipReload: _skipReload, instantPatch: _instantPatch, ...options } = source;
  return reloadCall ? { ...options, softReload: true } : { ...options, skipReload: true };
}

/** Dispatch a transaction's buffered commits, as one batch when they share a writer and file. */
async function dispatchBufferedCommits(calls: BufferedCommit[]): Promise<void> {
  const first = calls[0];
  if (!first) return;
  if (calls.length === 1) {
    await first.dispatch(first.selection, first.mutation, first.options);
    return;
  }
  const canBatch = calls.every(
    ({ dispatch, selection }) =>
      dispatch === first.dispatch && selection.sourceFile === first.selection.sourceFile,
  );
  if (canBatch && first.dispatch.batch) {
    await first.dispatch.batch(
      calls.map(({ selection, mutation, options }) => ({ selection, mutation, options })),
      mergeTransactionOptions(calls),
    );
    return;
  }
  for (const { dispatch, selection, mutation, options } of calls) {
    await dispatch(selection, mutation, options);
  }
}

const logCommit = makeStudioDebugLogger("commit");

/**
 * Owns the visual + persistence + history lifecycle for one gesture release.
 * `settle` deliberately runs before the first promise is created or awaited.
 */
export function runGestureTransaction(tx: GestureTransaction): Promise<void> {
  const coalesceKey = `tx:${tx.label}:${++transactionCounter}`;
  const bufferedCommits: BufferedCommit[] = [];
  logCommit("start", { label: tx.label, coalesceKey });
  tx.settle();
  logCommit("settled", { label: tx.label, coalesceKey });

  const measure = () =>
    tx.draw ? tx.draw(() => readPixelRect(tx.element)) : readPixelRect(tx.element);
  const before = !tx.skipPixelAssert ? measure() : null;
  const commit: TxCommit = (commitMutation) => {
    const wrapped: CommitMutation = (selection, mutation, options) => {
      bufferedCommits.push({
        dispatch: commitMutation,
        selection,
        mutation,
        options: transactionOptions(options, coalesceKey, tx.label),
      });
      return Promise.resolve();
    };
    transactionCommits.add(wrapped);
    return wrapped;
  };

  return tx
    .persist(commit, coalesceKey)
    .then(async () => {
      await dispatchBufferedCommits(bufferedCommits);
      await tx.afterBufferedCommitsSaved?.();
      logCommit("persisted", { label: tx.label, coalesceKey });
      if (before) {
        const after = measure();
        const delta = pixelDelta(before, after);
        if (exceedsPixelTolerance(delta)) {
          logCommit("persist-changed-pixels", { label: tx.label, before, after, delta });
        }
      }
    })
    .catch((error: unknown) => {
      tx.restore();
      logCommit("restore", { label: tx.label, coalesceKey });
      throw error;
    });
}
