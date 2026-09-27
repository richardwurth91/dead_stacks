# dead_stacks

A data-driven, modular 2D/2.5D tabletop village card simulation engine modeled on the core systemic loops of *Stacklands*.

## Architecture Highlights
- **Decoupled Simulation & Presentation**: The Model (ECS World, Kinematic Physics, Doubly Linked List Stacks) is completely decoupled from the View (Pixi.js).
- **100% Data-Driven Architecture (Phase 2)**:
  - Cards, Blueprints, Packs, and Manifests are declared externally in `/Mods` via JSON schemas validated at runtime using `Ajv`.
  - Abstract tag indexing (`tag:worker`, `tag:food`, `tag:material`) for multiset recipe queries.
  - Multi-language localization system supporting `.tsv` translation tables (English & Spanish included in Core).
  - Dynamic visual overrides (background, border, typography hex colors) and dynamic properties (`_FoodValue`, `_FoodDemand`, `_CombatTier`).
- **Crafting & Macroeconomics (Phase 3)**:
  - Multiset recipe matching with 4-tier conflict resolution hierarchy (Priority > Specificity > Scale > Lexicographical).
  - Disturbance-safe asynchronous crafting timers with animated progress bars.
  - 120-second Moon temporal cycles, sustenance hunger engine, corpse generation on starvation, and Sell Zone economics.
  - Booster packs with coin stacking unlocks and dynamic anti-frustration pity rules.
- **Quantitative Combat Subsystem (Phase 4)**:
  - Rock-Paper-Scissors tactical triad: Ranged $\xrightarrow{+40\%}$ Melee $\xrightarrow{+40\%}$ Magic $\xrightarrow{+40\%}$ Ranged.
  - 6 attribute tiers standardizing attack intervals, hit chances, base damage, and block.
  - Deterministic damage pipeline: Accuracy $\to$ Special Hits (Stun, Lifesteal, Crit, AOE) $\to$ Variance $\to$ Defense Mitigation (50% scratch check) $\to$ Affinity Multiplication.
  - Global skirmish attack coordination lock ($0.3\text{s}$) with FIFO tie-breaking and loot drops.
- **Deterministic Fixed-Step Loop**: Simulation updates at a fixed $60\text{ Hz}$ tick rate with dynamic time-scaling ($0\times, 1\times, 2\times, 5\times$).
- **Headless Execution**: Full headless testing capabilities via Vitest.

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Launch Interactive Tabletop (Browser Dev Server)
```bash
npm run dev
```
Open `http://localhost:3000` in your browser.

### 3. Run Headless Simulation Tests
```bash
npm test
```

### 4. Build Production Bundle
```bash
npm run build
```

## Directory Structure
- `schemas/`: Official JSON schemas (`card.schema.json`, `blueprint.schema.json`, `pack.schema.json`, `manifest.schema.json`).
- `Mods/`: Modding packages.
  - `Mods/Core/`: Base game package with manifest, TSV translations, cards, blueprints, and booster packs.
- `src/sim/`: Headless simulation core (ECS World, Kinematics, Stacks, Repulsion, EventBus, Crafting, Moon Cycle, Combat, Fixed Loop). Zero DOM/renderer dependencies.
- `src/mods/`: External ingestion pipeline, Ajv schema validator, CardRegistry, and Localization manager.
- `src/render/`: Pixi.js presentation layer, card shaders, procedural drop shadows, health bars, drag-and-drop input manager.
- `tests/`: Automated unit tests for kinematics, data architecture, crafting & economy, and combat skirmishes.
