# AgentBase — AI-Native Code Editor

## Project Overview
AgentBase is a blazing-fast, privacy-first, open-source AI-native code editor built with Tauri 2 + SolidJS + Monaco Editor. It competes with Cursor, Zed, and Windsurf.

## Tech Stack
- **App shell**: Tauri 2 (Rust backend, ~20MB binary)
- **Frontend**: SolidJS + TypeScript (reactive, ~7KB runtime)
- **Editor**: Monaco Editor (VS Code quality editing)
- **Styling**: Tailwind CSS 4 (utility-first)
- **Package manager**: npm
- **Build**: Vite 6
- **AI**: OpenRouter API (cloud) + Ollama (local) + Claude Code CLI

## Architecture
- `src-tauri/` — Rust backend: file I/O, AI API calls, git ops, Claude Code subprocess
- `src/` — SolidJS frontend: components, stores, types, lib utilities
- IPC via Tauri commands (invoke) and events (emit/listen)
- AI streaming via Tauri events ("ai_stream", "claude-code-output")

## Conventions
- SolidJS uses `class=` not `className=`
- CSS custom properties for theming via `style={{ prop: "var(--name)" }}`
- Stores are in `src/stores/` using SolidJS signals and createStore
- Tauri commands are in `src-tauri/src/commands/`
- Type definitions in `src/types/`
- All Tauri IPC wrappers in `src/lib/tauri.ts`

## Commands
- `npm install` — Install dependencies
- `npm run tauri dev` — Run in development mode with hot reload
- `npm run tauri build` — Build production binary
- `cd src-tauri && cargo check` — Check Rust compilation
