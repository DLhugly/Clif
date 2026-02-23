import { Component, onMount, onCleanup, createEffect } from "solid-js";
import * as monaco from "monaco-editor";
import { activeFile, updateFileContent, saveActiveFile } from "../../stores/fileStore";
import { theme, fontSize } from "../../stores/uiStore";
import { monacoThemes } from "../../lib/themes";
import type { Theme } from "../../stores/uiStore";

// Model + viewstate cache
const modelCache = new Map<string, monaco.editor.ITextModel>();
const viewStateCache = new Map<string, monaco.editor.ICodeEditorViewState>();

function getOrCreateModel(path: string, content: string, language: string): monaco.editor.ITextModel {
  const existing = modelCache.get(path);
  if (existing && !existing.isDisposed()) {
    const currentLang = existing.getLanguageId();
    if (currentLang !== language) {
      monaco.editor.setModelLanguage(existing, language);
    }
    if (existing.getValue() !== content) {
      existing.setValue(content);
    }
    return existing;
  }

  const uri = monaco.Uri.parse(`file://${path}`);
  const existingByUri = monaco.editor.getModel(uri);
  if (existingByUri) {
    modelCache.set(path, existingByUri);
    return existingByUri;
  }

  const model = monaco.editor.createModel(content, language, uri);
  modelCache.set(path, model);
  return model;
}

function getMonacoThemeName(t: Theme): string {
  return `agentbase-${t}`;
}

const MonacoEditor: Component = () => {
  let containerRef!: HTMLDivElement;
  let editorInstance: monaco.editor.IStandaloneCodeEditor | undefined;
  let currentPath: string | null = null;
  let onChangeDisposable: monaco.IDisposable | undefined;

  onMount(() => {
    // Register all 5 themes
    for (const [name, themeData] of Object.entries(monacoThemes)) {
      monaco.editor.defineTheme(`agentbase-${name}`, themeData);
    }

    editorInstance = monaco.editor.create(containerRef, {
      fontSize: fontSize(),
      fontFamily: "JetBrains Mono, Menlo, Monaco, 'Courier New', monospace",
      fontLigatures: true,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      renderWhitespace: "selection",
      cursorBlinking: "smooth",
      cursorSmoothCaretAnimation: "on",
      smoothScrolling: true,
      padding: { top: 8 },
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true },
      lineNumbers: "on",
      roundedSelection: true,
      tabSize: 2,
      automaticLayout: true,
      theme: getMonacoThemeName(theme()),
    });

    // Register Cmd+S / Ctrl+S to save
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveActiveFile();
    });
  });

  // Watch active file changes
  createEffect(() => {
    const file = activeFile();
    const editor = editorInstance;
    if (!editor) return;

    if (currentPath) {
      const state = editor.saveViewState();
      if (state) {
        viewStateCache.set(currentPath, state);
      }
    }

    if (onChangeDisposable) {
      onChangeDisposable.dispose();
      onChangeDisposable = undefined;
    }

    if (!file) {
      editor.setModel(null);
      currentPath = null;
      return;
    }

    const model = getOrCreateModel(file.path, file.content, file.language);
    editor.setModel(model);

    const savedState = viewStateCache.get(file.path);
    if (savedState) {
      editor.restoreViewState(savedState);
    }

    currentPath = file.path;

    onChangeDisposable = model.onDidChangeContent(() => {
      const value = model.getValue();
      updateFileContent(file.path, value);
    });
  });

  // Watch theme changes
  createEffect(() => {
    const t = theme();
    if (editorInstance) {
      monaco.editor.setTheme(getMonacoThemeName(t));
    }
  });

  // Watch font size changes
  createEffect(() => {
    const size = fontSize();
    if (editorInstance) {
      editorInstance.updateOptions({ fontSize: size });
    }
  });

  onCleanup(() => {
    if (currentPath && editorInstance) {
      const state = editorInstance.saveViewState();
      if (state) {
        viewStateCache.set(currentPath, state);
      }
    }

    if (onChangeDisposable) {
      onChangeDisposable.dispose();
    }

    if (editorInstance) {
      editorInstance.dispose();
    }

    modelCache.forEach((model) => {
      if (!model.isDisposed()) {
        model.dispose();
      }
    });
    modelCache.clear();
    viewStateCache.clear();
  });

  return (
    <div
      ref={containerRef}
      class="flex-1 w-full h-full overflow-hidden"
    />
  );
};

export default MonacoEditor;
