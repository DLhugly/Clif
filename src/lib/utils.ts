// Get file language from extension for Monaco editor
export function getLanguageFromExtension(ext: string | null): string {
  if (!ext) return "plaintext";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescriptreact",
    js: "javascript",
    jsx: "javascriptreact",
    rs: "rust",
    py: "python",
    rb: "ruby",
    go: "go",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    json: "json",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    md: "markdown",
    sql: "sql",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    dockerfile: "dockerfile",
    graphql: "graphql",
    vue: "html",
    svelte: "html",
    lua: "lua",
    r: "r",
    dart: "dart",
    zig: "zig",
  };
  return map[ext.toLowerCase()] || "plaintext";
}

// Get file icon indicator based on extension
export function getFileIcon(ext: string | null, isDir: boolean): string {
  if (isDir) return "folder";
  if (!ext) return "file";
  const iconMap: Record<string, string> = {
    ts: "typescript",
    tsx: "react",
    js: "javascript",
    jsx: "react",
    rs: "rust",
    py: "python",
    go: "go",
    json: "json",
    html: "html",
    css: "css",
    md: "markdown",
    toml: "config",
    yaml: "config",
    yml: "config",
    lock: "lock",
    gitignore: "git",
  };
  return iconMap[ext.toLowerCase()] || "file";
}

// Format file size
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Get file name from path
export function getFileName(path: string): string {
  return path.split("/").pop() || path;
}

// Get file extension
export function getFileExtension(name: string): string | null {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()! : null;
}

// Debounce utility
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// Generate a simple unique ID
export function uid(): string {
  return Math.random().toString(36).slice(2, 11);
}
