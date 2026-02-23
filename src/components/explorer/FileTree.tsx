import { Component, For, Show } from "solid-js";
import { fileTree, projectRoot } from "../../stores/fileStore";
import FileTreeItem from "./FileTreeItem";

const FileTree: Component<{ onOpenFolder?: () => void }> = (props) => {
  return (
    <div class="flex flex-col h-full">
      <Show
        when={projectRoot()}
        fallback={
          <div class="flex flex-col items-center justify-center h-full gap-4 p-4">
            <p
              class="text-sm text-center"
              style={{ color: "var(--text-muted)" }}
            >
              No folder opened
            </p>
            <button
              class="px-4 py-2 rounded text-sm font-medium transition-colors"
              style={{
                background: "var(--accent-blue)",
                color: "#ffffff",
              }}
              onClick={() => props.onOpenFolder?.()}
            >
              Open Folder
            </button>
          </div>
        }
      >
        <div class="flex-1 overflow-y-auto py-1">
          <For each={fileTree()}>
            {(entry) => <FileTreeItem entry={entry} depth={0} />}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default FileTree;
