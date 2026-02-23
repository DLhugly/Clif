import { Component, For, Show } from "solid-js";
import { openFiles, activeFilePath, setActiveFilePath, closeFile } from "../../stores/fileStore";
import Tab from "./Tab";

const TabBar: Component = () => {
  return (
    <Show when={openFiles.length > 0}>
      <div
        class="flex items-center bg-[var(--sidebar-bg)] border-b border-[var(--border-color)] overflow-x-auto overflow-y-hidden"
        style={{ height: "var(--tab-height, 36px)", "min-height": "var(--tab-height, 36px)" }}
      >
        <For each={openFiles}>
          {(file) => (
            <Tab
              file={file}
              isActive={activeFilePath() === file.path}
              onSelect={() => setActiveFilePath(file.path)}
              onClose={() => closeFile(file.path)}
            />
          )}
        </For>
      </div>
    </Show>
  );
};

export default TabBar;
