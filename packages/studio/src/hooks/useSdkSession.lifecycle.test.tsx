// fallow-ignore-file code-duplication
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openComposition = vi.fn();

vi.mock("@hyperframes/sdk", () => ({
  openComposition: (...args: unknown[]) => openComposition(...args),
}));

import type { Composition } from "@hyperframes/sdk";
import { useSdkSession, type SdkSessionHandle } from "./useSdkSession";
import { usePlayerStore } from "../player/store/playerStore";
import { notifyExternalFileReload } from "./externalFileReloadBus";

beforeEach(() => {
  usePlayerStore.setState({ timelineProjectId: "project-a", previewBooted: true });
});

function Probe({ projectId }: { projectId: string }) {
  useSdkSession(projectId, "index.html");
  return null;
}

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeSession(): Composition {
  return { dispose: vi.fn() } as unknown as Composition;
}

function response(content: string): Response {
  return { ok: true, json: async () => ({ content }) } as Response;
}

async function flushAsyncEffects(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("useSdkSession ownership", () => {
  beforeEach(() => {
    openComposition.mockReset();
    class FakeEventSource {
      addEventListener(): void {}
      close(): void {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not read or parse the composition until the live preview has booted", async () => {
    usePlayerStore.setState({ previewBooted: false });
    const fetchStub = vi.fn(async () => response("PROJECT_A"));
    vi.stubGlobal("fetch", fetchStub);
    openComposition.mockImplementation(async () => fakeSession());

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe projectId="project-a" />));
    await flushAsyncEffects();
    expect(fetchStub).not.toHaveBeenCalled();
    expect(openComposition).not.toHaveBeenCalled();

    await act(async () => usePlayerStore.getState().markPreviewBooted());
    await flushAsyncEffects();
    expect(openComposition).toHaveBeenCalledWith("PROJECT_A", { history: false });
    act(() => root.unmount());
  });

  it("hides project A immediately while project B with the same path is still opening", async () => {
    const sessionA = fakeSession();
    const publishedA = fakeSession();
    const sessionB = fakeSession();
    let resolveProjectB: ((value: Response) => void) | undefined;
    const projectBResponse = new Promise<Response>((resolve) => {
      resolveProjectB = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.includes("project-b") ? projectBResponse : Promise.resolve(response("PROJECT_A")),
      ),
    );
    openComposition.mockImplementation(async (content: string) =>
      content === "PROJECT_A" ? sessionA : sessionB,
    );

    const captured: { handle: SdkSessionHandle | null } = { handle: null };
    function Probe({ projectId }: { projectId: string }) {
      captured.handle = useSdkSession(projectId, "index.html");
      return null;
    }

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe projectId="project-a" />));
    await flushAsyncEffects();
    expect(captured.handle?.session).toBe(sessionA);

    let publication: ReturnType<SdkSessionHandle["publish"]> | undefined;
    await act(async () => {
      publication = captured.handle?.publish({
        candidate: publishedA,
        expectedSession: sessionA,
        targetPath: "index.html",
      });
    });
    expect(publication).toBe("published");
    expect(captured.handle?.session).toBe(publishedA);

    await act(async () => {
      usePlayerStore.getState().beginTimelineSession("project-b");
      usePlayerStore.getState().markPreviewBooted();
      root.render(<Probe projectId="project-b" />);
    });
    expect(captured.handle?.session).toBeNull();
    expect(publishedA.dispose).toHaveBeenCalledOnce();
    expect(
      captured.handle?.publish({
        candidate: fakeSession(),
        expectedSession: publishedA,
        targetPath: "index.html",
      }),
    ).toBe("rejected-inactive-target");

    resolveProjectB?.(response("PROJECT_B"));
    await flushAsyncEffects();
    expect(captured.handle?.session).toBe(sessionB);

    await act(async () => root.unmount());
    expect(sessionB.dispose).toHaveBeenCalledOnce();
  });

  it("disposes the currently published candidate when its owner unmounts", async () => {
    const opened = fakeSession();
    const published = fakeSession();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response("PROJECT_A")),
    );
    openComposition.mockResolvedValue(opened);

    const captured: { handle: SdkSessionHandle | null } = { handle: null };
    function Probe() {
      captured.handle = useSdkSession("project-a", "index.html");
      return null;
    }

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    await flushAsyncEffects();
    expect(captured.handle?.session).toBe(opened);
    let publication: ReturnType<SdkSessionHandle["publish"]> | undefined;
    await act(async () => {
      publication = captured.handle?.publish({
        candidate: published,
        expectedSession: opened,
        targetPath: "index.html",
      });
    });
    expect(publication).toBe("published");
    expect(opened.dispose).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    expect(published.dispose).toHaveBeenCalledOnce();
  });

  it("reopens on a project-wide external change whatever composition it holds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response("INDEX")),
    );
    openComposition.mockImplementation(async () => fakeSession());
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe projectId="project-a" />));
    await flushAsyncEffects();
    expect(openComposition).toHaveBeenCalledOnce();
    await act(async () => notifyExternalFileReload("film.html"));
    await flushAsyncEffects();
    expect(openComposition).toHaveBeenCalledOnce();
    await act(async () => notifyExternalFileReload("."));
    await flushAsyncEffects();
    expect(openComposition).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
  });
});

describe("useSdkSession unreachable project", () => {
  beforeEach(() => {
    openComposition.mockReset();
    class FakeEventSource {
      addEventListener(): void {}
      close(): void {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function probeHandle(projectId: string) {
    usePlayerStore.setState({ timelineProjectId: projectId });
    const captured: { handle: SdkSessionHandle | null } = { handle: null };
    function HandleProbe() {
      captured.handle = useSdkSession(projectId, "index.html");
      return null;
    }
    return { captured, HandleProbe };
  }

  const failedRead = (status: number) => async () =>
    ({ ok: false, status, json: async () => ({}) }) as Response;

  /** Render the hook for `projectId` against a stubbed read and let it settle. */
  async function readOutcome(
    projectId: string,
    read: () => Promise<Response>,
  ): Promise<{ captured: { handle: SdkSessionHandle | null }; unmount: () => Promise<void> }> {
    vi.stubGlobal("fetch", vi.fn(read));
    const { captured, HandleProbe } = probeHandle(projectId);
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<HandleProbe />));
    await flushAsyncEffects();
    return { captured, unmount: () => act(async () => root.unmount()) };
  }

  // A 404 on the composition read is the one failure that says something about
  // the PROJECT rather than the request: under the CLI host it means this
  // Studio serves a different one. Every edit then fails silently, so the UI
  // needs the id to explain that.
  it("names the project when the read is a 404", async () => {
    const { captured, unmount } = await readOutcome("gone-project", failedRead(404));

    expect(captured.handle?.unreachableProject).toBe("gone-project");
    await unmount();
  });

  // A 500 says the request failed, not that the project is elsewhere. Claiming
  // otherwise would tell a user their tab is pointed at the wrong project when
  // the server is merely unwell.
  it("stays quiet on a failure that says nothing about the project", async () => {
    const { captured, unmount } = await readOutcome("project-a", failedRead(500));

    expect(captured.handle?.unreachableProject).toBeNull();
    await unmount();
  });

  it("clears the state once the project resolves", async () => {
    const { captured, unmount } = await readOutcome("gone-project", failedRead(404));
    expect(captured.handle?.unreachableProject).toBe("gone-project");

    openComposition.mockResolvedValue(fakeSession());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response("PROJECT_A")),
    );
    await act(async () => {
      captured.handle?.forceReload();
    });
    await flushAsyncEffects();

    expect(captured.handle?.unreachableProject).toBeNull();
    await unmount();
  });
});

describe("useSdkSession read and open failures", () => {
  beforeEach(() => {
    openComposition.mockReset();
    class FakeEventSource {
      addEventListener(): void {}
      close(): void {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // `compositionMissing` and the once-per-path refresh fallback: proven
  // 2026-09-23 that `absent` means a stale tree (refreshFileTree only runs
  // after Studio's own file ops, never on an external change), so an `absent`
  // read is the one signal that should make the tree self-correct even when
  // the SSE-driven refresh in useExternalFileChangeCoordinator is missed.
  describe("compositionMissing and the absent-read refresh fallback", () => {
    function HandleProbe({
      projectId,
      path,
      onAbsentRead,
    }: {
      projectId: string;
      path: string;
      onAbsentRead?: (path: string) => void;
    }) {
      captured.handle = useSdkSession(projectId, path, onAbsentRead);
      return null;
    }
    const captured: { handle: SdkSessionHandle | null } = { handle: null };

    it("sets compositionMissing and calls onAbsentRead once for an absent read", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            ({ ok: true, json: async () => ({ content: "", missing: true }) }) as Response,
        ),
      );
      const onAbsentRead = vi.fn();
      const root = createRoot(document.createElement("div"));
      await act(async () =>
        root.render(
          <HandleProbe projectId="project-a" path="index.html" onAbsentRead={onAbsentRead} />,
        ),
      );
      await flushAsyncEffects();

      expect(captured.handle?.compositionMissing).toBe(true);
      expect(onAbsentRead).toHaveBeenCalledOnce();
      expect(onAbsentRead).toHaveBeenCalledWith("index.html");

      // A second absent read for the SAME path must not refresh again — the
      // refresh already ran and didn't fix it (the file really is gone).
      await act(async () => {
        captured.handle?.forceReload();
      });
      await flushAsyncEffects();
      expect(onAbsentRead).toHaveBeenCalledOnce();

      await act(async () => root.unmount());
    });

    it("calls onAbsentRead again for a different path", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            ({ ok: true, json: async () => ({ content: "", missing: true }) }) as Response,
        ),
      );
      const onAbsentRead = vi.fn();
      const root = createRoot(document.createElement("div"));
      await act(async () =>
        root.render(
          <HandleProbe projectId="project-a" path="scenes/a.html" onAbsentRead={onAbsentRead} />,
        ),
      );
      await flushAsyncEffects();
      await act(async () =>
        root.render(
          <HandleProbe projectId="project-a" path="scenes/b.html" onAbsentRead={onAbsentRead} />,
        ),
      );
      await flushAsyncEffects();

      expect(onAbsentRead).toHaveBeenCalledTimes(2);
      expect(onAbsentRead).toHaveBeenNthCalledWith(1, "scenes/a.html");
      expect(onAbsentRead).toHaveBeenNthCalledWith(2, "scenes/b.html");
      await act(async () => root.unmount());
    });

    it("resets the guard on project change, so the same path can refresh again", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            ({ ok: true, json: async () => ({ content: "", missing: true }) }) as Response,
        ),
      );
      const onAbsentRead = vi.fn();
      const root = createRoot(document.createElement("div"));
      await act(async () =>
        root.render(
          <HandleProbe projectId="project-a" path="index.html" onAbsentRead={onAbsentRead} />,
        ),
      );
      await flushAsyncEffects();
      await act(async () => {
        usePlayerStore.getState().beginTimelineSession("project-b");
        usePlayerStore.getState().markPreviewBooted();
        root.render(
          <HandleProbe projectId="project-b" path="index.html" onAbsentRead={onAbsentRead} />,
        );
      });
      await flushAsyncEffects();

      expect(onAbsentRead).toHaveBeenCalledTimes(2);
      await act(async () => root.unmount());
    });

    it("clears compositionMissing once a later read succeeds", async () => {
      const fetchMock = vi.fn(
        async () => ({ ok: true, json: async () => ({ content: "", missing: true }) }) as Response,
      );
      vi.stubGlobal("fetch", fetchMock);
      openComposition.mockResolvedValue(fakeSession());
      const root = createRoot(document.createElement("div"));
      await act(async () => root.render(<HandleProbe projectId="project-a" path="index.html" />));
      await flushAsyncEffects();
      expect(captured.handle?.compositionMissing).toBe(true);

      fetchMock.mockImplementation(async () => response("PROJECT_A"));
      await act(async () => {
        captured.handle?.forceReload();
      });
      await flushAsyncEffects();

      expect(captured.handle?.compositionMissing).toBe(false);
      await act(async () => root.unmount());
    });

    it("does not throw when onAbsentRead is not supplied", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            ({ ok: true, json: async () => ({ content: "", missing: true }) }) as Response,
        ),
      );
      const root = createRoot(document.createElement("div"));
      await act(async () => root.render(<HandleProbe projectId="project-a" path="index.html" />));
      await flushAsyncEffects();

      expect(captured.handle?.compositionMissing).toBe(true);
      await act(async () => root.unmount());
    });
  });

  it("warns with the parse failure when the composition cannot open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response("PROJECT_A")),
    );
    const failure = new Error("unparseable composition");
    openComposition.mockRejectedValue(failure);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe projectId="project-a" />));
    await flushAsyncEffects();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("SDK session"), failure);
    warn.mockRestore();
    await act(async () => root.unmount());
  });

  it("stays silent on the happy path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response("PROJECT_A")),
    );
    openComposition.mockResolvedValue(fakeSession());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe projectId="project-a" />));
    await flushAsyncEffects();

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    await act(async () => root.unmount());
  });
});
