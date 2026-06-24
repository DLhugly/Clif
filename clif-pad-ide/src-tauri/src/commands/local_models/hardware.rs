//! Best-effort hardware detection for model recommendations.
//!
//! RAM + CPU are reliable via `sysinfo`. Discrete-GPU VRAM detection is hard and
//! cross-platform-fragile, so v1 keeps it honest: on Apple Silicon the GPU shares
//! unified memory (so VRAM ≈ RAM), and elsewhere we report the GPU as unknown
//! rather than guess. RAM is the signal that actually drives fit.

use serde::Serialize;
use sysinfo::System;

#[derive(Serialize, Clone)]
pub struct GpuInfo {
    pub name: String,
    /// Best-effort VRAM. On unified-memory Macs this equals system RAM.
    pub vram_gb: Option<f64>,
    pub unified: bool,
}

#[derive(Serialize, Clone)]
pub struct HardwareInfo {
    pub os: String,
    pub cpu_brand: String,
    pub cpu_cores: usize,
    pub total_ram_gb: f64,
    pub gpu: Option<GpuInfo>,
    /// Human-readable one-liner for the UI header.
    pub summary: String,
}

pub fn detect() -> HardwareInfo {
    let mut sys = System::new_all();
    sys.refresh_memory();

    // sysinfo >= 0.30 returns memory in bytes.
    let total_ram_gb = sys.total_memory() as f64 / 1_000_000_000.0;
    let cpu_cores = sys.cpus().len();
    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .filter(|b| !b.is_empty())
        .unwrap_or_else(|| "Unknown CPU".to_string());

    let os = std::env::consts::OS.to_string();

    let gpu = detect_gpu(&os, &cpu_brand, total_ram_gb);
    let summary = build_summary(total_ram_gb, &gpu);

    HardwareInfo {
        os,
        cpu_brand,
        cpu_cores,
        total_ram_gb,
        gpu,
        summary,
    }
}

fn detect_gpu(os: &str, cpu_brand: &str, total_ram_gb: f64) -> Option<GpuInfo> {
    if os == "macos" {
        // Apple Silicon: unified memory, GPU shares RAM. Intel Macs have weak
        // iGPUs/dGPUs we don't try to size here.
        let apple_silicon = cpu_brand.to_lowercase().contains("apple");
        if apple_silicon {
            return Some(GpuInfo {
                name: format!("{} GPU (unified memory)", cpu_brand),
                vram_gb: Some(total_ram_gb),
                unified: true,
            });
        }
    }
    // Windows/Linux discrete-GPU VRAM detection is out of scope for v1.
    None
}

fn build_summary(total_ram_gb: f64, gpu: &Option<GpuInfo>) -> String {
    let ram = format!("{:.0}GB RAM", total_ram_gb.round());
    match gpu {
        Some(g) if g.unified => format!("Detected: {} ({})", ram, g.name),
        Some(g) => match g.vram_gb {
            Some(v) => format!("Detected: {} + {} ({:.0}GB VRAM)", ram, g.name, v),
            None => format!("Detected: {} + {}", ram, g.name),
        },
        None => format!("Detected: {}", ram),
    }
}
