import { createSignal } from "solid-js";
import {
  localDetectHardware,
  localModelsCatalog,
  localModelResolve,
  localModelVariants,
  localModelDownload,
  localModelDelete,
  localModelSetActive,
  onLocalModelDownloadProgress,
} from "../lib/tauri";
import type {
  HardwareInfo,
  CatalogEntry,
  DownloadProgress,
  ResolvedModel,
  ModelVariants,
} from "../types/localModels";

const [hardware, setHardware] = createSignal<HardwareInfo | null>(null);
const [catalog, setCatalog] = createSignal<CatalogEntry[]>([]);
const [loading, setLoading] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);

// id -> percent (0-100) while a download is in flight
const [progress, setProgress] = createSignal<Record<string, number>>({});

// id -> resolved HF file (exact filename + real size), once verified
const [resolved, setResolved] = createSignal<Record<string, ResolvedModel>>({});
const [verifying, setVerifying] = createSignal(false);

// id -> full HF variant detail (popularity + quant options), lazily fetched
const [variants, setVariants] = createSignal<Record<string, ModelVariants>>({});
const [variantsLoading, setVariantsLoading] = createSignal<Record<string, boolean>>({});

// The model whose detail view is open in the full-screen experience.
const [selectedId, setSelectedId] = createSignal<string | null>(null);

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

/**
 * Resolve every catalog model against the Hugging Face API to confirm the exact
 * GGUF file exists and fetch its real size. This is the "don't guess" path —
 * user-initiated so we don't hammer HF on every panel open.
 */
async function verifyOnHf() {
  setVerifying(true);
  setError(null);
  const results: Record<string, ResolvedModel> = { ...resolved() };
  const failures: string[] = [];
  for (const entry of catalog()) {
    try {
      results[entry.id] = await localModelResolve(entry.id);
      setResolved({ ...results });
    } catch (e) {
      failures.push(entry.name);
    }
  }
  if (failures.length) {
    setError(`Not found on HF (may be gated or renamed): ${failures.join(", ")}`);
  }
  setVerifying(false);
}

/** Lazily fetch HF variant detail (popularity + quant options) for one model. */
async function loadVariants(id: string, force = false) {
  if (!force && variants()[id]) return;
  setVariantsLoading((p) => ({ ...p, [id]: true }));
  try {
    const v = await localModelVariants(id);
    setVariants((p) => ({ ...p, [id]: v }));
  } catch (e) {
    setError(String(e));
  } finally {
    setVariantsLoading((p) => ({ ...p, [id]: false }));
  }
}

/** Open a model's detail view and fetch its HF data. */
function select(id: string | null) {
  setSelectedId(id);
  if (id) void loadVariants(id);
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
  resolved,
  verifying,
  variants,
  variantsLoading,
  selectedId,
  refresh,
  verifyOnHf,
  loadVariants,
  select,
  download,
  remove,
  setActive,
};
