import { useState, useEffect, useCallback, useRef } from "react";
import { openComposition } from "@hyperframes/sdk";
import type { Composition } from "@hyperframes/sdk";
import { isSelfWriteEcho } from "./sdkSelfWriteRegistry";
import type { PublishSdkSession } from "../utils/sdkCutover";
import { addExternalFileReloadListener } from "./externalFileReloadBus";
import { whenPreviewBooted } from "../player/store/playerStore";
import { studioApiFetch } from "../utils/studioApiFetch";

/**
 * Why an optional project-file read produced no usable content.
 *
 * `network` is a fetch that rejected: the request never produced a response.
 * `invalid_json` is a 200 whose body is not JSON (an SPA fallback or a proxy
 * answering in the route's place). `absent` and `empty_file` split what
 * `absent_or_empty` cannot: the route answers `content: ""` both for a file it
 * cannot find (the `optional=1` shim, marked `missing: true`) and for a real
 * 0-byte one. A server without that field still answers `absent_or_empty`.
 */
type ProjectFileReadFailure =
  | { ok: false; reason: "unsafe_path" }
  | { ok: false; reason: "http_error"; status: number }
  | { ok: false; reason: "missing_content" }
  | { ok: false; reason: "absent_or_empty" }
  | { ok: false; reason: "absent" }
  | { ok: false; reason: "empty_file" }
  | { ok: false; reason: "invalid_json" }
  | { ok: false; reason: "network" };

type ProjectFileReadResult = { ok: true; content: string } | ProjectFileReadFailure;

/**
 * Which project, if any, a failed read identifies as unreachable.
 *
 * Only a 404 identifies the *project*: the server answered, and its answer was
 * that it does not serve this id. A 5xx, a dropped request, an unexpected body
 * and an empty file all say nothing about which project the server serves, so
 * none of them claim it. See `unreachableProject` on the handle.
 */
function unreachableProjectFor(read: ProjectFileReadFailure, projectId: string): string | null {
  if (read.reason !== "http_error") return null;
  return read.status === 404 ? projectId : null;
}

interface ProjectFileBody {
  content?: string;
  /** Present only from a server that separates its shim from a real 0-byte file. */
  missing?: boolean;
}

/**
 * Decide what a 200 with a JSON body actually delivered.
 *
 * `optional=1` answers a missing file with 200 + `content: ""`, so a non-string
 * content is a response shape we did not expect, not absence. An empty string
 * parses into a session with no elements, which declines every edit wholesale —
 * not a session worth opening — and `missing` is the route saying which of the
 * two empties it was. Without that field (older server) the combined label
 * stands rather than guessing one and corrupting the series.
 */
function classifyProjectFileBody(data: ProjectFileBody): ProjectFileReadResult {
  if (typeof data.content !== "string") return { ok: false, reason: "missing_content" };
  if (data.content !== "") return { ok: true, content: data.content };
  if (data.missing === true) return { ok: false, reason: "absent" };
  if (data.missing === false) return { ok: false, reason: "empty_file" };
  return { ok: false, reason: "absent_or_empty" };
}

/**
 * Read a project file's content (optional read — a missing file is not an
 * error). Replaces the removed SDK http adapter's `read()` — the only thing
 * Studio used it for (Studio is the sole writer, so the adapter's write path
 * was dead).
 */
async function readProjectFileOptional(
  projectId: string,
  path: string,
): Promise<ProjectFileReadResult> {
  // Reject traversal / NUL before building the request URL — `path` is a
  // user-influenced composition path (mirrors the guard in timelineEditingHelpers,
  // and closes the CodeQL client-side-request-forgery flag). encodeURIComponent
  // already confines both values to single segments of this same-origin URL.
  if (path.includes("\0") || path.includes("..")) return { ok: false, reason: "unsafe_path" };
  let res: Response;
  try {
    res = await studioApiFetch(
      `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(path)}?optional=1`,
    );
  } catch {
    // Offline, the dev server gone, a CSP/Private-Network-Access block, or an
    // extension rewriting fetch: a read failure, not a composition that failed
    // to parse.
    return { ok: false, reason: "network" };
  }
  if (!res.ok) return { ok: false, reason: "http_error", status: res.status };
  // A 200 that is not JSON is a different failure from a JSON body missing its
  // field: it means something other than this route answered — an SPA fallback
  // or a proxy. Left unguarded, it rejected out of this function entirely and
  // the effect's outer catch blamed the composition. See the type's comment.
  let data: ProjectFileBody;
  try {
    data = (await res.json()) as ProjectFileBody;
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  return classifyProjectFileBody(data);
}

/**
 * Stage 7 Step 3a — SDK session wired to the active composition.
 *
 * Creates an SDK Composition (reading the file via the project files API) on
 * every (projectId, activeCompPath) change, disposes the old one on cleanup, and
 * re-opens it when the active composition file changes on disk (code editor,
 * agent, or server-side patch) so the in-memory linkedom document never goes
 * stale. The session has NO persist queue — Studio is the sole file writer; see
 * the open effect below.
 */
/**
 * Decide whether a file-change for the active composition should reload the SDK
 * session. `content` is the new on-disk bytes (from the payload or a re-read);
 * pass null when unavailable. Content-identity wins: a change whose bytes match a
 * registered self-write is our own echo (suppress). Without content we can't prove
 * identity, so we fall back to the time window ONLY to suppress an echo — an undo
 * write outside the window (or any non-self-write) still reloads. Exported for test.
 */
export function shouldReloadOnFileChange(
  activeCompPath: string,
  content: string | null,
  withinSuppressWindow: boolean,
): boolean {
  if (content != null) return !isSelfWriteEcho(activeCompPath, content);
  // No content to compare — preserve the old time-window echo suppression.
  return !withinSuppressWindow;
}

export interface SdkSessionHandle {
  session: Composition | null;
  /** Atomically publish a fully persisted candidate session. */
  publish: PublishSdkSession;
  /**
   * Force a session reload immediately, bypassing the self-write suppress
   * window. Call after undo/redo writes the active composition file so the
   * SDK in-memory document reflects the reverted content. Without it the
   * window swallows the file-change and the session stays stale; the write
   * side of that path is covered by usePersistentEditHistory.test.ts.
   */
  forceReload: () => void;
  /**
   * Set when this server answered the composition read with a 404 for the
   * project it was asked to open. In the CLI-embedded host that does not
   * mean the project is gone. It means this Studio is serving
   * a *different* one; the project is untouched on disk. Either way every edit
   * in this tab fails, and until now it failed silently.
   *
   * `null` for every other failure: a 500 or a dropped request says nothing
   * about which project the server serves, and `absent_or_empty` /
   * `missing_content` say nothing about the project at all.
   */
  unreachableProject: string | null;
  /**
   * True when the most recent read of `activeCompPath` reported `reason:
   * "absent"` — the file tree lists this path and the server cannot get it.
   * Proven 2026-09-23 to mean a stale tree: `refreshFileTree` only runs after
   * Studio's own file operations, so an external change (an agent removing
   * or replacing the file) updates the preview and this session but never
   * the listing, and the file stays clickable forever. Every edit then fails
   * silently with nothing to tell the user why — this is that signal.
   */
  compositionMissing: boolean;
}

interface SdkSessionOwner {
  projectId: string;
  path: string;
  reloadToken: number;
  generation: number;
}

interface OwnedSdkSession extends SdkSessionOwner {
  session: Composition;
}

function isSessionOwnerActive(
  owner: SdkSessionOwner | undefined,
  projectId: string | null,
  path: string | null,
  targetPath: string,
): owner is SdkSessionOwner {
  if (!owner) return false;
  return owner.projectId === projectId && owner.path === path && owner.path === targetPath;
}

function isSessionOwnerCurrent(
  owner: SdkSessionOwner,
  generation: number,
  projectId: string | null,
  path: string | null,
  reloadToken: number,
): boolean {
  return (
    owner.generation === generation &&
    owner.projectId === projectId &&
    owner.path === path &&
    owner.reloadToken === reloadToken
  );
}

function ownsExpectedSession(
  current: OwnedSdkSession | null,
  expectedOwner: SdkSessionOwner,
  expectedSession: Composition,
  reloadToken: number,
): current is OwnedSdkSession {
  if (!current) return false;
  return (
    current.session === expectedSession &&
    current.generation === expectedOwner.generation &&
    current.reloadToken === reloadToken
  );
}

function disposeSdkSession(session: Composition): void {
  try {
    session.dispose();
  } catch (error) {
    console.warn("[Studio] Disposing an SDK session failed:", error);
  }
}

export function useSdkSession(
  projectId: string | null,
  activeCompPath: string | null,
  // Fallback for the SSE-driven refresh in useExternalFileChangeCoordinator:
  // called at most once per (projectId, path) so the tree self-corrects even
  // when that delivery is missed (server restart, a watcher event the SSE
  // never sent). Optional: a secondary session opened for a promote/bind
  // target (DesignPanelPromoteProvider) has no tree of its own to refresh.
  onAbsentRead?: (path: string) => void,
): SdkSessionHandle {
  const [ownedSession, setOwnedSession] = useState<OwnedSdkSession | null>(null);
  const ownedSessionRef = useRef<OwnedSdkSession | null>(null);
  const sessionOwnersRef = useRef(new WeakMap<Composition, SdkSessionOwner>());
  const generationRef = useRef(0);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const activeCompPathRef = useRef(activeCompPath);
  activeCompPathRef.current = activeCompPath;
  const [reloadToken, setReloadToken] = useState(0);
  const reloadTokenRef = useRef(reloadToken);
  reloadTokenRef.current = reloadToken;
  const [unreachableProject, setUnreachableProject] = useState<string | null>(null);
  const [compositionMissing, setCompositionMissing] = useState(false);
  // Keyed `${projectId}:${path}` so a refresh that doesn't fix it (the file
  // really is gone) can't loop, and so it fires again for a genuinely
  // different path or project.
  const refreshedAbsentPathsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    refreshedAbsentPathsRef.current.clear();
  }, [projectId]);

  /**
   * Update `unreachableProject`/`compositionMissing` for one failed read, and
   * fire the once-per-path tree-refresh fallback on `absent`. Pulled out of
   * the open effect's `.then` — the branching there was pushing that
   * callback over the complexity threshold on its own.
   */
  function handleReadFailure(
    read: ProjectFileReadFailure,
    forProjectId: string,
    forPath: string,
  ): void {
    setUnreachableProject(unreachableProjectFor(read, forProjectId));
    setCompositionMissing(read.reason === "absent");
    if (read.reason !== "absent") return;
    const key = `${forProjectId}:${forPath}`;
    if (refreshedAbsentPathsRef.current.has(key)) return;
    refreshedAbsentPathsRef.current.add(key);
    onAbsentRead?.(forPath);
  }

  useEffect(
    () =>
      addExternalFileReloadListener((changedPath) => {
        // "." is a project-wide change (a reconnect or a replaced folder): every session reloads.
        if (changedPath === "." || changedPath === activeCompPathRef.current) {
          setReloadToken((token) => token + 1);
        }
      }),
    [],
  );

  // ── Open / re-open the session ──
  useEffect(() => {
    const generation = ++generationRef.current;
    let cancelled = false;

    // The preceding effect normally released its generation first. Clear any
    // remaining owner defensively so an invalid project/path cannot retain it.
    const previous = ownedSessionRef.current;
    ownedSessionRef.current = null;
    setOwnedSession(null);
    if (previous) disposeSdkSession(previous.session);

    if (!projectId || !activeCompPath) {
      setUnreachableProject(null);
      setCompositionMissing(false);
      return () => {
        cancelled = true;
      };
    }

    const owner: SdkSessionOwner = {
      projectId,
      path: activeCompPath,
      reloadToken,
      generation,
    };

    // Parsing the source for editing takes the main thread for hundreds of ms on a large film;
    // the first frame and play do not need it, so it waits for the live preview to boot.
    whenPreviewBooted(projectId)
      .then((booted) =>
        cancelled || !booted ? null : readProjectFileOptional(projectId, activeCompPath),
      )
      .then(async (read) => {
        if (!read || cancelled) return;
        if (!read.ok) {
          handleReadFailure(read, projectId, activeCompPath);
          return;
        }
        setUnreachableProject(null);
        setCompositionMissing(false);
        const content = read.content;
        // No persist queue: Studio's writeProjectFile (via sdkCutover's
        // persistSdkSerialize) is the SINGLE writer. Wiring the SDK persist
        // queue too would double-write the file (queue auto-writes on every
        // 'change' AND Studio writes explicitly) and race on disk; it would
        // also write the full active-composition serialization to the fixed
        // persistPath even when an edit targeted a sub-composition file.
        // Studio's editHistory is the authoritative undo stack — SDK history
        // is unused dead weight here (forceReloadSdkSession discards it on undo).
        const comp = await openComposition(content, { history: false });
        // Cleanup may have fired while openComposition was awaited; dispose immediately.
        if (cancelled) {
          disposeSdkSession(comp);
          return;
        }
        if (
          !isSessionOwnerCurrent(
            owner,
            generationRef.current,
            projectIdRef.current,
            activeCompPathRef.current,
            reloadTokenRef.current,
          )
        ) {
          disposeSdkSession(comp);
          // Not a failure: project/path/reloadToken moved on while this open was
          // in flight, and the effect that owns the new identity already opened
          // (or is opening) its own session.
          return;
        }
        const displaced = ownedSessionRef.current;
        const installed = { ...owner, session: comp };
        sessionOwnersRef.current.set(comp, owner);
        ownedSessionRef.current = installed;
        setOwnedSession(installed);
        if (displaced && displaced.session !== comp) disposeSdkSession(displaced.session);
      })
      .catch((error: unknown) => {
        if (!cancelled && generationRef.current === generation) {
          setOwnedSession(null);
          // openComposition threw (unparseable composition, OOM). A rejected
          // read never reaches here: `readProjectFileOptional` answers it.
          console.warn("[Studio] Opening the SDK session failed:", error);
        }
      });

    return () => {
      cancelled = true;
      // Publication preserves this generation, so cleanup releases whichever
      // session it currently owns (the initially opened one or its candidate).
      const owned = ownedSessionRef.current;
      if (owned?.generation === generation) {
        ownedSessionRef.current = null;
        disposeSdkSession(owned.session);
      }
    };
    // onAbsentRead deliberately excluded: it only reacts to a read failure
    // from this same effect run (the tree-refresh fallback), and re-running
    // the whole open/dispose cycle on every render (callers are not required
    // to memoize it) would drop and reopen a perfectly good session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, activeCompPath, reloadToken]);

  const forceReload = useCallback(() => setReloadToken((t) => t + 1), []);
  const publish = useCallback<PublishSdkSession>(({ candidate, expectedSession, targetPath }) => {
    const expectedOwner = sessionOwnersRef.current.get(expectedSession);
    const current = ownedSessionRef.current;
    if (
      !isSessionOwnerActive(
        expectedOwner,
        projectIdRef.current,
        activeCompPathRef.current,
        targetPath,
      )
    ) {
      return "rejected-inactive-target";
    }
    if (!ownsExpectedSession(current, expectedOwner, expectedSession, reloadTokenRef.current)) {
      // The durable write won, but another session was installed for this same
      // path before publication. Its self-write echo will be suppressed, so
      // explicitly re-open it from disk instead of leaving it stale.
      setReloadToken((t) => t + 1);
      return "rejected-active-target";
    }
    const next: OwnedSdkSession = { ...current, session: candidate };
    sessionOwnersRef.current.set(candidate, current);
    ownedSessionRef.current = next;
    setOwnedSession(next);
    if (current.session !== candidate) disposeSdkSession(current.session);
    return "published";
  }, []);
  const session =
    ownedSession?.projectId === projectId &&
    ownedSession.path === activeCompPath &&
    ownedSession.reloadToken === reloadToken
      ? ownedSession.session
      : null;
  return { session, publish, forceReload, unreachableProject, compositionMissing };
}
