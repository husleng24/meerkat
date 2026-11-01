# Meerkat

**English** · [简体中文](README.zh-CN.md)

**See what changed in any field, effortlessly.**

A local-first daily brief: it watches the fields you care about, keeps only what actually changed,
and tells you what is different from yesterday.

![Two-level sidebar: domains and topics](docs/assets/ui-two-level-sidebar.png)

> v0.1.1 · 402 tests · typecheck / build green · built and run on macOS; Windows artifacts built by CI

## Download

Grab an installer from [Releases](https://github.com/husleng24/meerkat/releases):

| Platform | File |
|---|---|
| macOS (Apple Silicon) | [Meerkat-0.1.1-arm64.dmg](https://github.com/husleng24/meerkat/releases/download/v0.1.1/Meerkat-0.1.1-arm64.dmg) |
| macOS (Intel) | [Meerkat-0.1.1-x64.dmg](https://github.com/husleng24/meerkat/releases/download/v0.1.1/Meerkat-0.1.1-x64.dmg) |
| Windows (installer) | [Meerkat-0.1.1-x64.exe](https://github.com/husleng24/meerkat/releases/download/v0.1.1/Meerkat-0.1.1-x64.exe) |
| Windows (portable) | [Meerkat-0.1.1-portable.exe](https://github.com/husleng24/meerkat/releases/download/v0.1.1/Meerkat-0.1.1-portable.exe) |

Neither platform is code-signed, and that has consequences:

- **macOS**: right-click **Open** or `xattr -dr com.apple.quarantine` may still be refused —
  Gatekeeper/AMFI can reject an unsigned build on macOS 15+ (`Unrecoverable CT signature issue`).
  Until a Developer ID certificate and notarization are in place, the macOS build is for local
  development only.
- **Windows**: SmartScreen → **More info → Run anyway**; this works, but the publisher is unknown.

## What it is

- A **local-first desktop brief**: data, keys and briefs stay on your own machine; there is no server
- For people with five minutes a day who want to know what *actually changed* in a field
- Organized as **domain → topic**: a domain groups topics; each topic has its own sources, schedule and brief
- **AI is the default example** (sources and prompts ship tuned for it); the domain/topic/source model is
  generic — fashion, chips or policy work the same way once you add sources

## What it is not

- Not a news aggregator: it aims for **few and precise**, 15–24 items per issue
- Not an online service: no account, no cloud sync
- Not a general reader: it keeps titles, one-line interpretations and links; no full-text extraction
- Not a chatbot: the built-in chat only asks and summarizes today's brief

## Why Meerkat

- **Local by design** — no account, no telemetry; keys are encrypted on disk and your data is one SQLite file
  you can back up or delete
- **Only the delta** — a 48-hour window, scoring and cross-day dedupe, so an issue is 15–24 items, not a feed
- **Domain → topic → rollup** — start from a domain-level overview and drill into a topic; new topics start
  with a few recommended sources instead of copying every source
- **Never a blank page** — without a model it produces a links-only digest, a failed rollup falls back to
  excerpts, and unhealthy sources are visible and replaceable

## Features

### One brief per day

Collects over a 48-hour window, scores and dedupes, then has a model write
"three-line overview + per-section items + one closing line". With no model configured it degrades to a
titles-and-links digest instead of failing.

### Domain → topic

Switch domains at the top of the sidebar; topics of that domain sit below, and `⌘1–9` jumps directly.
A topic is the unit of collection and briefing; a domain groups topics and produces rollups.
**New topics start with 8 recommended sources** instead of copying every source.

![Choosing topics when adding a source](docs/assets/ui-source-topic-picker.png)

### Compared with yesterday

`New / Progressed / Not repeated again` three numbers under the header, expandable to the exact items.

### Search, timeline and reading state

FTS5 full-text search (with section, source, time filters, highlighting and sorting); timeline for past briefs;
read / saved / hidden flags are persisted and mapped back to item ids by URL.

### Source management

Sources are global (health is per source); membership is many-to-many per topic. The sources page shows
consecutive failures and unstable feeds, and suggests replacements. When adding a source you pick the topics
(grouped by domain) and get an explainable rule-based recommendation. In settings you can search, tick, or use
**✨ recommended for this topic** to fill gaps.

### Domain rollup

Every day at 08:45 (after topics finish), each domain merges its topics' briefs into one rollup: a cross-topic
overview plus per-topic items, deduped by URL. Without a model (or when the call fails) it falls back to an
excerpt sheet instead of blocking. The **Domain rollup** page in the sidebar lets you recompose at any time.

![Domain rollup](docs/assets/ui-domain-rollup.png)

### AI chat

Bottom-right panel (`⌘J`): ask and summarize today's brief, switching between configured providers. One thread
per topic per day; context carries the brief and history, not the raw material. Reordering the brief is
deferred to P2.

![AI chat over the day's brief](docs/assets/ui-chat.png)

### Update notice

On launch it asks GitHub for the latest release (cached for 24 hours). When a newer version exists, a small
**sidebar-footer entry** appears (`↓ v0.1.2 · Download`); clicking it opens the release page, where both the
changelog and the installers are. Settings → About checks on demand and expands the changelog in place.
It never downloads or replaces the app itself — both platforms are unsigned.

### Export

Markdown / HTML / PDF / rich text, written to `Documents/Meerkat/`.

## Quick start

### Requirements

- Node 20+, pnpm 11
- macOS or Windows; native modules (better-sqlite3) are compiled on first install

```bash
pnpm install
pnpm dev          # development (electron-vite)
```

Packaging:

```bash
pnpm build        # builds out/ only
pnpm dist         # Windows NSIS installer (see electron-builder.yml)
# macOS local check: pnpm exec electron-builder --mac --dir
```

### First launch

Pick a few domains in onboarding → domains/topics are created with default sources → one collection runs
immediately (about 1–2 minutes). After that it runs on schedule; the header's **Update** button triggers a run
manually.

### Three environment pitfalls

1. **`ELECTRON_RUN_AS_NODE=1`** turns Electron into plain Node (fails with `bad option: --no-sandbox`).
   Unset it before launching: `env -u ELECTRON_RUN_AS_NODE ...`
2. **better-sqlite3 must be rebuilt for Electron's ABI**: `pnpm rebuild:native`
   (= `electron-builder install-app-deps`), otherwise it crashes on launch.
3. **Slow networks (e.g. in China)**: set
   `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`, and for node-gyp headers
   `npm_config_disturl=https://npmmirror.com/mirrors/node/`.

Full reproduction steps: [docs/HISTORY.md](docs/HISTORY.md) (Chinese).

## Usage

### Domains, topics, sources

- Settings → **Domains** manages groups; **Topics** are grouped by domain and each row has **Sources**
  to jump to its source list
- A topic's sources can be searched, ticked, or filled from recommendations; selecting all warns that the
  topic will duplicate others
- **New source** on the sources page asks for type/URL/tier/section and which topics to join

### Schedule and manual runs

Each topic defaults to 08:30, domain rollups to 08:45; a missed slot is caught up within **6 hours**.
Settings lets you change times, disable the schedule, run now or cancel. The tray menu shows the next run;
a notification appears when it finishes.

### Models and keys

- Providers: DeepSeek, OpenAI, Anthropic (the first two use the OpenAI-compatible protocol, Anthropic uses Messages)
- Keys are encrypted per provider under `userData` (`secret.bin` / `secret-<provider>.bin`), or come from
  `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
- One-click import from a local DeepSeek Harness credentials file
- Composition prefers DeepSeek → OpenAI → Anthropic; a provider's model id can be overridden in settings

### Where the data lives

| Content | Location |
|---|---|
| Database | `app.getPath('userData')/meerkat.db` (macOS `~/Library/Application Support/Meerkat`; Windows `%APPDATA%\Meerkat`) |
| Keys | encrypted files in the same directory |
| Logs | `logs/main.log` in the same directory |
| Exports | `Documents/Meerkat/` |

## Architecture

```
renderer (React)  ──IPC──▶  main (Electron assembly)
                                │
                    app (use cases: collect / compose / chat / rollup)
                                │  depends on ports only
                    core (domain / pipeline / policy / ports, pure)
                                ▲
              adapters (sqlite / sources / llm) implement the ports
```

| Layer | Path | Responsibility |
|---|---|---|
| core | `src/core` | Domain model, scoring and dedupe, prompt context, port interfaces; imports no adapters |
| app | `src/app` | Use cases: collection, composition, recommendations, rollups, diagnostics; depends only on core ports |
| adapters | `src/adapters` | SQLite repositories, source fetchers, OpenAI/Anthropic protocols, composer |
| main | `src/main` | Electron assembly, IPC, scheduler, tray, export, keystore |
| renderer | `src/renderer` | React UI; talks to main only through `window.meerkat` |

**Data model (schema v5)**: `sources` / `topics` / `topic_sources` / `domains` / `items` / `briefs` /
`brief_items` / `domain_briefs` / `item_flags` / `chat_threads` / `chat_messages` / `runs` / `settings`.
Migrations are driven by `PRAGMA user_version` and only ever add.

**IPC conventions**: inputs are validated with zod at the boundary; long tasks push progress via events;
handlers return a Result shape instead of throwing into the renderer. Repository interfaces are synchronous
(better-sqlite3 is synchronous).

## Quality

| Item | Status |
|---|---|
| Tests | `pnpm test`: **402 passing** (unit + jsdom + local HTTP stubs) |
| Types | `pnpm typecheck`: both node and web tsconfigs |
| Build | `pnpm build` passes; `pnpm dist` produces the Windows installer |
| Real-device verification | Every feature was checked with screenshots; record in [docs/VERIFICATION-RESULT.md](docs/VERIFICATION-RESULT.md) (Chinese) |

Common commands: `pnpm dev` / `pnpm test` / `pnpm typecheck` / `pnpm build` / `pnpm dist` /
`pnpm run-once` (collect once) / `pnpm compose-once` (compose once) / `pnpm prep-schedule` (seed schedule data).

## Known limitations

- **Windows installer**: `electron-builder.yml` is ready, but the NSIS installer is not yet verified on a
  physical Windows machine (CI builds it)
- **Menu bar shows "Electron" in development**: the macOS app name comes from the bundle's `Info.plist` and
  cannot change at runtime; the packaged `Meerkat.app` is fine (the Dock icon is fixed in dev via
  `app.dock.setIcon`)
- **Single instance**: launching again focuses the existing window; no side-by-side
- **AI chat is not streaming**; reordering is P2
- **Updates are a notice, not a download**: the app links to the Release page instead of installing it
- **macOS distribution needs a Developer ID**: unsigned/ad-hoc builds can be refused by AMFI (see Download)
- **Rollup quality depends on topic briefs**: a topic without a brief for the day falls back to its latest one

## Docs

Most design docs are currently written in Chinese.

| File | Content |
|---|---|
| [PRODUCT.md](PRODUCT.md) | Users, positioning, constraints |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layers and seams |
| [DESIGN.md](DESIGN.md) | Feature design and data flow |
| [docs/VISUAL-WORLD.md](docs/VISUAL-WORLD.md) | Visual spec: colors, type scale, layout rules |
| [docs/AI-CHAT.md](docs/AI-CHAT.md) | AI chat design and status |
| [docs/DOMAIN-ROLLUP.md](docs/DOMAIN-ROLLUP.md) | Domain rollup design and implementation |
| [docs/DOMAIN-TOPIC-MODEL.md](docs/DOMAIN-TOPIC-MODEL.md) | Evaluating the domain/topic model |
| [docs/TOPIC-NAV.md](docs/TOPIC-NAV.md) / [docs/DOMAIN-PLACEMENT.md](docs/DOMAIN-PLACEMENT.md) | Navigation research and trade-offs |
| [docs/HARNESS.md](docs/HARNESS.md) | Local agent harness research (deferred) |
| [docs/TODO.md](docs/TODO.md) | TODOs, limitations and engineering debt |
| [docs/FEEDBACK.md](docs/FEEDBACK.md) | Feedback triage and fix flow |
| [docs/VERIFICATION-RESULT.md](docs/VERIFICATION-RESULT.md) | Raw real-device verification records |
| [docs/RELEASE.md](docs/RELEASE.md) | Release process and artifacts |
| [docs/HISTORY.md](docs/HISTORY.md) | P1–P4 development log (archived) |

## Development conventions

- **Commit messages in English** (imperative subject, body explains why); code comments, docs and UI copy in
  Chinese (enforced by `.githooks/commit-msg`, enable with `git config core.hooksPath .githooks`)
- Run `pnpm test` and `pnpm typecheck` before committing; UI changes need a screenshot, not just types
- Architecture rules: `core` imports no adapters; `app` depends only on core ports; `main` does the assembly
- One implementation per behavior (the desktop "Run now" and scripts share the same `runCollect`)

## License

[MIT](LICENSE) © 2026 husleng24
