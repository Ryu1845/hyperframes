import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IconContext } from "@phosphor-icons/react";
import { StudioApp } from "./App";
import { ShowThemeToggle } from "./components/ThemeToggle";
import { StudioErrorBoundary } from "./components/StudioErrorBoundary";
import { readIconTokens } from "./styles/iconTokens";
import { prefetchPreviewForHash } from "./utils/previewPrefetch";
import { bindThumbnailPageLifecycle } from "./player/lib/thumbnailPageLifecycle";
import "./styles/studio.css";

const unbindThumbnailPageLifecycle = bindThumbnailPageLifecycle(window, document);
import.meta.hot?.dispose(unbindThumbnailPageLifecycle);

prefetchPreviewForHash(window.location.hash);
window.addEventListener("hashchange", () => prefetchPreviewForHash(window.location.hash));

// A ResizeObserver that cannot deliver every notification in one frame reports
// "ResizeObserver loop" as a window error. It is benign, so keep it out of the
// console and away from any other error listener.
window.addEventListener("error", (event) => {
  if (event.message?.includes("ResizeObserver loop")) {
    event.stopImmediatePropagation();
    event.preventDefault();
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* One icon size and weight for the whole app, taken from the theme file.
        Icons that pass their own size or weight still win. */}
    <IconContext.Provider value={readIconTokens()}>
      <StudioErrorBoundary>
        <ShowThemeToggle.Provider value>
          <StudioApp />
        </ShowThemeToggle.Provider>
      </StudioErrorBoundary>
    </IconContext.Provider>
  </StrictMode>,
);
