import { Component, Show } from "solid-js";
import type { OpenFile } from "../../types/files";

interface TabProps {
  file: OpenFile;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}

function getExtensionColor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const colorMap: Record<string, string> = {
    ts: "#3178c6",
    tsx: "#3178c6",
    js: "#f7df1e",
    jsx: "#61dafb",
    rs: "#dea584",
    py: "#3572a5",
    go: "#00add8",
    html: "#e34c26",
    css: "#563d7c",
    scss: "#c6538c",
    json: "#a8b1c1",
    md: "#519aba",
    toml: "#9c4121",
    yaml: "#cb171e",
    yml: "#cb171e",
    sh: "#89e051",
    sql: "#e38c00",
    lua: "#000080",
    rb: "#cc342d",
    java: "#b07219",
    kt: "#a97bff",
    swift: "#f05138",
    c: "#555555",
    cpp: "#f34b7d",
    vue: "#41b883",
    svelte: "#ff3e00",
  };
  return colorMap[ext] || "#8b949e";
}

const Tab: Component<TabProps> = (props) => {
  return (
    <div
      class={`group flex items-center gap-1.5 px-3 cursor-pointer select-none border-r border-[var(--border-color)] shrink-0 ${
        props.isActive
          ? "bg-[var(--editor-bg)] text-[var(--text-primary)] border-b-2 border-b-[var(--accent-color)]"
          : "bg-[var(--tab-bg)] text-[var(--text-secondary)] hover:bg-[var(--tab-hover-bg)] border-b-2 border-b-transparent"
      }`}
      style={{ height: "var(--tab-height, 36px)" }}
      onClick={() => props.onSelect()}
      onMouseDown={(e) => {
        // Middle click to close
        if (e.button === 1) {
          e.preventDefault();
          props.onClose();
        }
      }}
    >
      {/* File extension color dot */}
      <span
        class="w-2 h-2 rounded-full shrink-0"
        style={{ "background-color": getExtensionColor(props.file.name) }}
      />

      {/* Dirty indicator */}
      <Show when={props.file.isDirty}>
        <span class="w-1.5 h-1.5 rounded-full bg-white shrink-0" />
      </Show>

      {/* File name */}
      <span class="text-xs whitespace-nowrap overflow-hidden text-ellipsis max-w-[120px]">
        {props.file.name}
      </span>

      {/* Close button */}
      <button
        class={`ml-1 w-4 h-4 flex items-center justify-center rounded-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-bg)] shrink-0 ${
          props.isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
        onClick={(e) => {
          e.stopPropagation();
          props.onClose();
        }}
      >
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path
            d="M1 1L7 7M7 1L1 7"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  );
};

export default Tab;
