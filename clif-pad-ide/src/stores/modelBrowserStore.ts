import { createSignal } from "solid-js";
import { POPULAR_MODELS, type OpenRouterModel } from "../components/agent/constants";

// Shared across every mount point of the model browser (top bar + agent
// panel) so switching context doesn't re-fetch or lose search/sort state.
const [openRouterModels, setOpenRouterModels] = createSignal<OpenRouterModel[]>([]);
const [fetchingModels, setFetchingModels] = createSignal(false);
const [modelSearch, setModelSearch] = createSignal("");
const [modelSort, setModelSort] = createSignal<"name" | "price-asc" | "price-desc" | "ctx">("name");
const [modelProviderFilter, setModelProviderFilter] = createSignal("all");

async function fetchOpenRouterModels() {
  if (openRouterModels().length > 0) return;
  setFetchingModels(true);
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/models?supported_parameters=tools&output_modalities=text");
    if (!resp.ok) return;
    const data = await resp.json();
    const models: OpenRouterModel[] = (data.data || [])
      .filter((m: OpenRouterModel) => m.id && !m.id.includes(":free"));
    setOpenRouterModels(models);
  } catch {
    // fall back to static list
  } finally {
    setFetchingModels(false);
  }
}

function filteredCloudModels(): OpenRouterModel[] {
  const q = modelSearch().toLowerCase();
  const pf = modelProviderFilter();
  let models: OpenRouterModel[] = openRouterModels().length > 0
    ? openRouterModels()
    : (POPULAR_MODELS.openrouter || []).map((m) => ({ id: m.value, name: m.label }) as OpenRouterModel);

  if (q) models = models.filter((m) =>
    m.id.toLowerCase().includes(q) || (m.name || "").toLowerCase().includes(q)
  );
  if (pf !== "all") models = models.filter((m) => m.id.startsWith(pf + "/"));

  const sort = modelSort();
  return [...models].sort((a, b) => {
    if (sort === "name") return (a.name || a.id).localeCompare(b.name || b.id);
    if (sort === "price-asc") return parseFloat(a.pricing?.prompt || "0") - parseFloat(b.pricing?.prompt || "0");
    if (sort === "price-desc") return parseFloat(b.pricing?.prompt || "0") - parseFloat(a.pricing?.prompt || "0");
    if (sort === "ctx") return (b.context_length || 0) - (a.context_length || 0);
    return 0;
  });
}

export {
  openRouterModels,
  fetchingModels,
  modelSearch,
  setModelSearch,
  modelSort,
  setModelSort,
  modelProviderFilter,
  setModelProviderFilter,
  fetchOpenRouterModels,
  filteredCloudModels,
};
