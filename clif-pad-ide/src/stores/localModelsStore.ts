import { createSignal } from "solid-js";
import {
  localDetectHardware,
  localModelsCatalog,
  localModelDownload,
  localModelDelete,
  localModelSetActive,
  onLocalModelDownloadProgress,
} from "../lib/tauri";
import type {
  HardwareInfo,
  CatalogEntry,
  DownloadProgress,
} from "../types/localModels";

const [hardware, setHardware] = createSignal<HardwareInfo | null>(null);
const [catalog, setCatalog] = createSignal<CatalogEntry[]>([]);
const [loading, setLoading] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);

// id -> percent (0-100) while a download is in flight
const [progress, setProgress] = createSignal<Record<string, number>>({});

let progressListenerStarted = false;

/** Refresh hardware + catalog (catalog already carries fit/downloaded/active). */
async function refresh() {
  setLoading(true);
  setError(null);
  try {
    const [hw, cat] = await Promise.all([
      localDetectHardware(),
      localModelsCatalog(),
    ]);
    setHardware(hw);
    setCatalog(cat);
  } catch (e) {
    setError(String(e));
  } finally {
    setLoading(false);
  }
}

/** Start listening for download progress once. */
function ensureProgressListener() {
  if (progressListenerStarted) return;
  progressListenerStarted = true;
  onLocalModelDownloadProgress((p: DownloadProgress) => {
    setProgress((prev) => ({ ...prev, [p.id]: p.percent }));
    if (p.done) {
      // Clear the in-flight bar and re-pull catalog so "downloaded" flips.
      setProgress((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      if (p.error) setError(`Download failed: ${p.error}`);
      void refresh();
    }
  });
}

async function download(id: string) {
  setError(null);
  setProgress((prev) => ({ ...prev, [id]: 0 }));
  ensureProgressListener();
  try {
    await localModelDownload(id);
  } catch (e) {
    setError(String(e));
    setProgress((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }
}

async function remove(id: string) {
  setError(null);
  try {
    await localModelDelete(id);
    await refresh();
  } catch (e) {
    setError(String(e));
  }
}

async function setActive(id: string) {
  setError(null);
  try {
    await localModelSetActive(id);
    await refresh();
  } catch (e) {
    setError(String(e));
  }
}

export {
  hardware,
  catalog,
  loading,
  error,
  progress,
  refresh,
  download,
  remove,
  setActive,
};
