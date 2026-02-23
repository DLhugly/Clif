import * as monaco from "monaco-editor";

// Configure Monaco workers
// Monaco needs web workers for language services
self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    const getWorkerModule = (moduleUrl: string) => {
      return new Worker(new URL(moduleUrl, import.meta.url), { type: "module" });
    };

    switch (label) {
      case "json":
        return getWorkerModule("monaco-editor/esm/vs/language/json/json.worker?worker");
      case "css":
      case "scss":
      case "less":
        return getWorkerModule("monaco-editor/esm/vs/language/css/css.worker?worker");
      case "html":
      case "handlebars":
      case "razor":
        return getWorkerModule("monaco-editor/esm/vs/language/html/html.worker?worker");
      case "typescript":
      case "javascript":
        return getWorkerModule(
          "monaco-editor/esm/vs/language/typescript/ts.worker?worker"
        );
      default:
        return getWorkerModule("monaco-editor/esm/vs/editor/editor.worker?worker");
    }
  },
};

export function configureMonaco() {
  // Additional Monaco configuration can go here
  // For example, registering custom languages, themes, etc.
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });

  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.languages.typescript.JsxEmit.Preserve,
    allowJs: true,
    strict: true,
    esModuleInterop: true,
  });
}
