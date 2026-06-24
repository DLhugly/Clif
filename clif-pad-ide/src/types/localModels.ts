// Mirrors src-tauri/src/commands/local_models/*.rs serialization.

export interface GpuInfo {
  name: string;
  vram_gb: number | null;
  unified: boolean;
}

export interface HardwareInfo {
  os: string;
  cpu_brand: string;
  cpu_cores: number;
  total_ram_gb: number;
  gpu: GpuInfo | null;
  summary: string;
}

export type Fit = "comfortable" | "good" | "slow" | "too_large";

// CatalogEntry flattens CatalogModel (serde flatten), so model fields are inline.
export interface CatalogEntry {
  id: string;
  name: string;
  hf_repo: string;
  file: string;
  params_b: number;
  size_gb: number;
  quant: string;
  min_ram_gb: number;
  context: number;
  role: string;
  swe_note: string;
  fit: Fit;
  fit_label: string;
  downloaded: boolean;
  active: boolean;
}

export interface DownloadedModel {
  id: string;
  name: string;
  file: string;
  size_bytes: number;
  path: string;
  active: boolean;
}

export interface DownloadProgress {
  id: string;
  downloaded_bytes: number;
  total_bytes: number;
  percent: number;
  done: boolean;
  error: string | null;
}
