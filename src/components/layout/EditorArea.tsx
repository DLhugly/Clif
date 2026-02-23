import { Component, Show, lazy, Suspense } from "solid-js";
import { activeFile, openFiles } from "../../stores/fileStore";

const TabBar = lazy(() => import("../editor/TabBar"));
const MonacoEditor = lazy(() => import("../editor/MonacoEditor"));

const EmptyState: Component = () => (
  <div
    class="flex flex-col items-center justify-center h-full select-none"
    style={{ background: "var(--bg-base)" }}
  >
    <div class="flex flex-col items-center gap-4">
      <svg
        width="48" height="48" viewBox="0 0 24 24" fill="none"
        stroke="var(--text-muted)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"
        style={{ opacity: "0.4" }}
      >
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
        <polyline points="13 2 13 9 20 9" />
      </svg>
      <p class="text-sm" style={{ color: "var(--text-muted)" }}>
        No files open
      </p>
      <p class="text-xs" style={{ color: "var(--text-muted)", opacity: "0.6" }}>
        Open a folder or let Claude edit files
      </p>
    </div>
  </div>
);

const EditorArea: Component = () => {
  const hasOpenFiles = () => openFiles.length > 0;

  return (
    <div
      class="flex flex-col flex-1 min-w-0 h-full overflow-hidden"
      style={{ background: "var(--bg-base)" }}
    >
      {/* Tab bar - only show when files are open */}
      <Show when={hasOpenFiles()}>
        <Suspense>
          <TabBar />
        </Suspense>
      </Show>

      {/* Editor or Empty state */}
      <div class="flex-1 min-h-0 overflow-hidden">
        <Show when={activeFile()} fallback={<EmptyState />}>
          <Suspense
            fallback={
              <div
                class="flex items-center justify-center h-full"
                style={{ color: "var(--text-muted)" }}
              >
                <span class="text-sm">Loading editor...</span>
              </div>
            }
          >
            <MonacoEditor />
          </Suspense>
        </Show>
      </div>
    </div>
  );
};

export default EditorArea;
