import { Component, Show, For, createSignal, createEffect } from "solid-js";
import type { FileEntry } from "../../types/files";
import { openFile, toggleDir, isDirExpanded, loadDirectory } from "../../stores/fileStore";

function getExtensionColor(ext: string | null): string {
  if (!ext) return "#6b7280"; // gray
  const colorMap: Record<string, string> = {
    ts: "#3b82f6",
    tsx: "#3b82f6",
    js: "#eab308",
    jsx: "#eab308",
    rs: "#f97316",
    py: "#22c55e",
    json: "#eab308",
    css: "#a855f7",
    scss: "#a855f7",
    html: "#ef4444",
    md: "#7dd3fc",
  };
  return colorMap[ext.toLowerCase()] || "#6b7280";
}

interface FileTreeItemProps {
  entry: FileEntry;
  depth: number;
}

const FileTreeItem: Component<FileTreeItemProps> = (props) => {
  const [children, setChildren] = createSignal<FileEntry[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [isHovered, setIsHovered] = createSignal(false);

  createEffect(() => {
    if (props.entry.is_dir && isDirExpanded(props.entry.path) && !loaded()) {
      loadDirectory(props.entry.path).then((entries) => {
        setChildren(entries);
        setLoaded(true);
      });
    }
  });

  function handleClick() {
    if (props.entry.is_dir) {
      toggleDir(props.entry.path);
      if (!loaded()) {
        loadDirectory(props.entry.path).then((entries) => {
          setChildren(entries);
          setLoaded(true);
        });
      }
    } else {
      openFile(props.entry.path);
    }
  }

  return (
    <div>
      <div
        class="flex items-center cursor-pointer select-none"
        style={{
          "padding-left": `${props.depth * 16}px`,
          "padding-right": "8px",
          height: "24px",
          "font-size": "13px",
          color: "var(--text-primary)",
          background: isHovered() ? "var(--bg-hover)" : "transparent",
        }}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <Show when={props.entry.is_dir}>
          {/* Chevron */}
          <span
            class="flex items-center justify-center shrink-0 transition-transform duration-150"
            style={{
              width: "16px",
              height: "16px",
              transform: isDirExpanded(props.entry.path) ? "rotate(90deg)" : "rotate(0deg)",
              color: "var(--text-muted)",
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M3 2 L7 5 L3 8 Z" />
            </svg>
          </span>
          {/* Folder icon */}
          <span
            class="flex items-center justify-center shrink-0 mr-1"
            style={{ width: "16px", height: "16px", color: "#e2b340" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
            </svg>
          </span>
        </Show>

        <Show when={!props.entry.is_dir}>
          {/* Spacer for alignment with folders */}
          <span class="shrink-0" style={{ width: "16px" }} />
          {/* File type color dot */}
          <span
            class="shrink-0 rounded-full mr-1.5"
            style={{
              width: "8px",
              height: "8px",
              background: getExtensionColor(props.entry.extension),
            }}
          />
        </Show>

        <span class="truncate">{props.entry.name}</span>
      </div>

      {/* Children (recursive) */}
      <Show when={props.entry.is_dir && isDirExpanded(props.entry.path)}>
        <For each={children()}>
          {(child) => <FileTreeItem entry={child} depth={props.depth + 1} />}
        </For>
      </Show>
    </div>
  );
};

export default FileTreeItem;
