# WoPeD Next

**The modern web-based Petri net editor for workflow modeling and analysis.**

[![Live Demo](https://img.shields.io/badge/demo-GitHub%20Pages-646cff?style=flat-square)](https://taminofischer.github.io/woped-next/)
[![Vue.js](https://img.shields.io/badge/Vue.js-3.5-42b883?style=flat-square&logo=vue.js)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-7.x-646cff?style=flat-square&logo=vite)](https://vite.dev/)

> Built for education and research — WoPeD Next brings Petri net modeling, token-game simulation, and workflow analysis to the browser. It is the web successor to the Java Swing **WoPeD** (Workflow Petri Net Designer) from DHBW Karlsruhe.

---

## Features

### Petri net editor

- Drag-and-drop canvas with places, transitions, arcs, and arc weights
- Workflow operators (AND/XOR split and join, combined operators)
- Subprocesses with drill-down navigation and process tree
- Quick Connect pad on right-click to add successors quickly
- Snap-to-grid, auto-layout, fit-to-view, and optional van der Aalst operator notation
- PNML and JSON import/export, SVG/PNG image export
- Auto-save and drag-and-drop file opening

### Token game

- Animated token flow with step-by-step or automatic execution
- Conflict resolution and subprocess stepping
- Runtime statistics and deadlock detection

### Analysis and simulation

- Qualitative analysis (structure, soundness, coverability graph)
- Process metrics and custom metric builder
- Quantitative discrete-event simulation with resources, roles, and bottlenecks
- Mass analysis across multiple nets

### AI chat assistant

- Built-in chat panel (OpenAI or Google Gemini, BYOK — key stays in your browser)
- Create nets from natural language via **T2P 2.0** (`/t2p-2.0/v2/generate/pnml`)
- Describe the current model via **P2T**
- Analyze, modify, and get modeling help with model context
- Optional WoPeD service endpoints configurable in Settings (T2P/P2T, prompting strategy)

### Templates and learning

- **19 educational templates** — from basic patterns to dining philosophers, loan application, and state machines
- In-app help, tooltips, and guided tour (EN/DE)

---

## Quick start

**Requirements:** Node.js 22+, npm

```bash
git clone https://github.com/TaminoFischer/woped-next.git
cd woped-next
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Other commands

| Command | Description |
|---------|-------------|
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview production build locally |
| `npm run test` | Vitest in watch mode |
| `npm run test:run` | Run tests once |
| `npm run test:coverage` | Tests with coverage report |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |

---

## Docker

```bash
docker compose up --build
```

The app is served on [http://localhost:8080](http://localhost:8080) via nginx.

---

## Tech stack

| Area | Technology |
|------|------------|
| UI | Vue 3 (Composition API, `<script setup>`) |
| Canvas | Konva + vue-konva |
| State | Pinia |
| i18n | vue-i18n (English, German) |
| Types & validation | TypeScript, Zod |
| Styling | CSS variables + Tailwind CSS 4 |
| Layout | dagre (auto-layout) |
| Tests | Vitest, happy-dom, @vue/test-utils |
| Build | Vite 7 |
| Deploy | GitHub Pages, Docker + nginx |

---

## Documentation

| Document | Description |
|----------|-------------|
| [AGENTS.md](AGENTS.md) | Project reference for developers and AI coding agents |
| [Architecture](docs/dev/architecture.md) | System design, stores, and canvas patterns |
| [Design tokens](docs/dev/design.md) | UI colors and theme variables |
| [Migration status](docs/migration/migrations.md) | Feature parity with legacy WoPeD |
| [NLP chat feature](docs/features/03-nlp-chat.md) | Chat assistant design and T2P/P2T integration |
| [Deployment](docs/ops/deployment.md) | GitHub Pages and Docker deployment |
| [Learn guides](docs/learn/README.md) | Tutorials for Vue, Pinia, i18n, testing, and more |

---

## What is WoPeD?

**WoPeD** models and analyzes workflow processes using Petri nets. Places (circles) represent conditions, transitions (rectangles) represent activities, tokens mark the current marking, and arcs connect the net.

```
    (●)  ───►  [ T1 ]  ───►  ( )
   Place    Transition    Place
  (1 token)              (0 tokens)
```

---

## Contributing

1. Branch from `main`
2. Develop with `npm run dev`
3. Before opening a PR, run:

```bash
npm run typecheck
npm run test:run
npm run build
```

4. Add new UI strings to both `src/i18n/locales/en.ts` and `de.ts`
5. Open a pull request against `main`

See [AGENTS.md](AGENTS.md) for architecture conventions, folder layout, and coding guidelines.

---

## Links

- [Live demo](https://taminofischer.github.io/woped-next/) — try it in your browser
- [Original WoPeD](http://woped.dhbw-karlsruhe.de/) — legacy Java application
- [Petri Nets World](https://www.informatik.uni-hamburg.de/TGI/PetriNets/) — background on Petri nets

---

<p align="center">
  Made for the Petri net community
</p>
