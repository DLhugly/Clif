type KeyHandler = () => void;

interface Keybinding {
  key: string;
  mod: ("ctrl" | "meta" | "shift" | "alt")[];
  handler: KeyHandler;
  description: string;
}

const bindings: Keybinding[] = [];

export function registerKeybinding(
  key: string,
  mod: ("ctrl" | "meta" | "shift" | "alt")[],
  handler: KeyHandler,
  description: string
) {
  bindings.push({ key: key.toLowerCase(), mod, handler, description });
}

export function initKeybindings() {
  document.addEventListener("keydown", (e) => {
    const isMac = navigator.platform.includes("Mac");

    for (const binding of bindings) {
      const keyMatch = e.key.toLowerCase() === binding.key;
      const ctrlMatch = binding.mod.includes("ctrl")
        ? isMac
          ? e.metaKey
          : e.ctrlKey
        : true;
      const metaMatch = binding.mod.includes("meta") ? e.metaKey : true;
      const shiftMatch = binding.mod.includes("shift") ? e.shiftKey : !e.shiftKey;
      const altMatch = binding.mod.includes("alt") ? e.altKey : !e.altKey;

      // Ensure no extra modifiers
      const noExtraMods =
        (binding.mod.includes("ctrl") || binding.mod.includes("meta")
          ? true
          : !e.ctrlKey && !e.metaKey) &&
        (binding.mod.includes("shift") ? true : !e.shiftKey) &&
        (binding.mod.includes("alt") ? true : !e.altKey);

      if (keyMatch && ctrlMatch && metaMatch && shiftMatch && altMatch && noExtraMods) {
        e.preventDefault();
        e.stopPropagation();
        binding.handler();
        return;
      }
    }
  });
}

export function getBindings() {
  return [...bindings];
}
