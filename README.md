<p align="center">
  <img src="logo.svg" alt="ClifCode" width="560" />
</p>

<p align="center">
  <img src="SplashScreen.png" alt="Clif-Code" width="800" />
</p>

<h3 align="center">Two tools. One mission. Ship faster.</h3>

<p align="center">
  <strong>ClifPad</strong> — ~20MB desktop IDE that replaces Electron bloat<br>
  <strong>ClifCode</strong> — AI agent that lives in your terminal
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License"></a>
  <a href="https://github.com/DLhugly/Clif-Code/releases"><img src="https://img.shields.io/github/v/release/DLhugly/Clif-Code?label=release&color=blue" alt="Release"></a>
  <a href="https://www.npmjs.com/package/clifcode"><img src="https://img.shields.io/npm/v/clifcode?color=red&label=npm" alt="npm"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="Platform">
</p>

<p align="center">
  <a href="https://clifcode.io">Website</a> &middot;
  <a href="#-clifpad--the-ide">ClifPad</a> &middot;
  <a href="#-clifcode--the-agent">ClifCode</a> &middot;
  <a href="#getting-started">Get Started</a> &middot;
  <a href="https://github.com/DLhugly/Clif-Code/releases">Downloads</a>
</p>

---

<br>

## Why Clif?

Every other "AI editor" ships a 400MB Electron wrapper, locks you into a subscription, and phones home with your code.

Clif is different:

- **Native.** Rust backend, ~20MB binary. Launches in under a second.
- **Private.** Zero telemetry. Zero cloud sync. Your code never leaves your machine.
- **Open.** MIT licensed. Read every line. Fork it. Ship it. No strings.
- **AI on your terms.** Bring your own key — OpenRouter, OpenAI, Anthropic, Ollama. Or turn it all off and use a pure offline editor.

<br>

```
Clif-Code/
├── clif-pad-ide/     Desktop IDE  — Tauri 2 + SolidJS + Monaco
├── clif-code-tui/    Terminal AI agent — pure Rust, any API
└── .github/          CI/CD (auto-release, npm publish)
```

<br>

---

<br>

## ClifPad — The IDE

> VS Code features. Fraction of the size. No Electron in sight.

<table>
<tr>
<td width="50%">

**Monaco Editor** — The same engine behind VS Code. 70+ languages, IntelliSense, multi-cursor, minimap, bracket matching, code folding. Full editing power in a native shell.

**Real Terminal** — Not a web simulation. Native PTY sessions via Rust with 256-color, auto-resize, and 10K scrollback. Your actual shell, running at full speed.

**Dev Preview** — One-click dev server launcher. Auto-detects localhost ports and renders a live iframe preview. Build and see changes without leaving the editor.

</td>
<td width="50%">

**Git Built In** — Branch, stage, commit, per-file diff stats, visual commit graph. All powered by Rust — not shell commands piped through a webview.

**AI Your Way** — OpenRouter for 100+ cloud models. Ollama for fully local inference. Claude Code CLI integration. Ghost text completions. All optional, all opt-in.

**5 Themes** — Midnight, Graphite, Dawn, Arctic, Dusk. Dark and light. Switch instantly.

</td>
</tr>
</table>

### Install ClifPad

Download the latest build from [Releases](https://github.com/DLhugly/Clif-Code/releases):

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [`.dmg`](https://github.com/DLhugly/Clif-Code/releases) |
| macOS (Intel) | [`.dmg`](https://github.com/DLhugly/Clif-Code/releases) |
| Windows | [`.exe`](https://github.com/DLhugly/Clif-Code/releases) |
| Linux | [`.deb`](https://github.com/DLhugly/Clif-Code/releases) |

> **macOS users:** If you see "App can't be opened", run `xattr -cr /Applications/ClifPad.app` — this removes Apple's quarantine flag on unsigned apps. Notarization is on the roadmap.

<br>

---

<br>

## ClifCode — The Agent

> Like Claude Code, but open source. Runs anywhere, talks to any model.

ClifCode is an AI coding agent that lives in your terminal. Give it a task, and it reads your codebase, writes code, runs commands, and commits — all through a tool-calling agent loop.

```
  ◆ Model  anthropic/claude-sonnet-4    ◆ Mode  auto-edit
  ◆ Path   ~/projects/my-app

  Type a task to get started, or /help for commands
  ─────────────────────────────────────────────

  ❯ add dark mode to the settings page
```

### What it does

- **Agentic tool loop** — reads files, writes code, runs shell commands, searches your codebase, manages git — up to 7 tool calls per turn, automatically
- **Any model, any provider** — OpenRouter, OpenAI, Anthropic, Ollama, or any OpenAI-compatible API. Swap providers with one flag
- **Parallel tool execution** — read-only calls (file reads, searches) run concurrently on threads for speed
- **Streaming markdown** — responses render live in your terminal with syntax highlighting
- **3 autonomy modes** — `suggest` (confirm every write), `auto-edit` (apply with collapsed diffs), `full-auto` (hands-off)
- **Session persistence** — conversations auto-save. Resume any session later with `/resume`
- **Auto-commit** — optionally commits changes with descriptive messages. Undo with `/undo`
- **Cost tracking** — per-turn and session-wide token usage and estimated cost
- **Workspace intelligence** — auto-scans your project structure, reads README/config files for context
- **Non-interactive mode** — pipe in a prompt with `clifcode -p "fix the login bug"` for scripting

### 9 Built-in Tools

| Tool | What it does |
|------|-------------|
| `read_file` | Read files with optional offset for large files |
| `write_file` | Create new files |
| `edit_file` | Surgical find-and-replace edits with diff preview |
| `find_file` | Locate files by name across the workspace |
| `list_files` | Directory listing with structure |
| `search` | Regex search across your codebase |
| `run_command` | Execute shell commands |
| `change_directory` | Switch workspace context |
| `submit` | Signal task completion with auto-commit |

### Install ClifCode

```bash
npm i -g clifcode
```

Or build from source:

```bash
cd clif-code-tui && cargo install --path .
```

### Usage

```bash
clifcode                                        # interactive — auto-detect backend
clifcode -p "explain this codebase"             # non-interactive — single prompt
clifcode --backend api --api-model gpt-4o       # specific model
clifcode --backend ollama                       # local Ollama server
clifcode --autonomy suggest                     # confirm every file write
clifcode --resume                               # pick up where you left off
```

### Slash Commands

```
Session:    /new  /sessions  /resume  /cost  /clear  /quit
Workspace:  /cd   /add       /drop    /context
Settings:   /mode /backend   /config
Git:        /status  /undo
```

<br>

---

<br>

## Getting Started

```bash
# Clone
git clone https://github.com/DLhugly/Clif-Code.git && cd Clif-Code

# ClifPad — desktop IDE
cd clif-pad-ide && npm install && npm run tauri dev

# ClifCode — terminal agent
cd clif-code-tui && cargo run --release
```

### Requirements

| | ClifPad | ClifCode |
|---|---------|----------|
| **Runtime** | Node 18+, Rust | Rust |
| **Install** | [Download](https://github.com/DLhugly/Clif-Code/releases) | `npm i -g clifcode` |
| **Size** | ~20MB | ~5MB |
| **AI needed?** | Optional | Yes (any provider) |

<br>

---

<br>

## Contributing

[Conventional commits](https://www.conventionalcommits.org/) — `feat:` bumps minor, `fix:` bumps patch, `feat!:` bumps major.

PRs welcome. The codebase is small enough to understand in an afternoon.

## License

[MIT](LICENSE) — do whatever you want.
