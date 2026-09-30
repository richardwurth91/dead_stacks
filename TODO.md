# Project Backlog & To-Do List

This document tracks outstanding engineering tasks, missing safeguards, incomplete feature implementations, and edge-case handling across the simulation engine.

---

## 1. Kinematics & Physics Engine (`src/sim/kinematics/`)

- [ ] **Handle Identical Coordinate Singularity (`repulsion.ts`)**
  - **Issue**: When two cards spawn or land on the exact same tabletop coordinate (`dist === 0`), `dx / dist` and `dy / dist` result in `0 / 0 = NaN`.
  - **Task**: Implement a deterministic micro-offset (or check `dist === 0`) to prevent division by zero and maintain finite coordinates.

- [ ] **Repulsion Force Vector Clamping (`repulsion.ts`)**
  - **Issue**: Heavily overlapped cards with high spring compression generate unbounded impulse forces.
  - **Task**: Restore maximum impulse clamping (`config.maxImpulse`) on total force vectors (`totalFx`, `totalFy`) to prevent cards from being flung off-screen at near-infinite velocities.

---

## 2. Crafting System (`src/sim/crafting/`)

- [ ] **Multi-Output Recipe Yields (`craftingSystem.ts`)**
  - **Issue**: Craft completion only instantiates the first entry in `subprint.resultCards[0]`, dropping any remaining results.
  - **Task**: Support recipes that produce multiple outputs (`resultCards.length > 1`) and amounts (`result.amount > 1`).

- [ ] **Probabilistic Drop Distributions (`craftingSystem.ts`)**
  - **Issue**: Craft outputs do not evaluate the probability threshold (`result.chance`).
  - **Task**: Reintroduce probability rolls (`Math.random() <= result.chance`) for randomized drop tables and resource harvesting yields.

---

## 3. Economy & Moon Cycle (`src/sim/economy/`)

- [ ] **Corpse Coordinate Preservation (`moonSystem.ts`)**
  - **Issue**: During starvation resolution at the end of a Moon cycle, the worker entity is destroyed before reading its `transform` component, causing `getComponent(workerId, 'transform')` to return `undefined` and forcing corpse coordinates to `(200, 200)`.
  - **Task**: Query and cache worker coordinates prior to destroying the entity so corpses spawn at the exact position where the worker died.

- [ ] **Fractional Nutrition Rollover & Food Rationing (`moonSystem.ts`)**
  - **Task**: Enhance the sustenance engine to support fractional food consumption rollover and rationing mechanics to prevent whole-card waste.

---

## 4. Combat Subsystem (`src/sim/combat/`)

- [ ] **Attack Queue Target Re-Validation & Death Pruning (`combatSystem.ts`)**
  - **Issue**: When multiple attacks are queued within the same frame, an entity killed by an earlier attack remains in the queue. Calling `executeAttack()` on a dead entity produces unhandled exceptions.
  - **Task**: Verify attacker existence (`world.hasComponent(attackerId, 'combatant')`) before executing each dequeued attack.

- [ ] **Loot Drop Registry Validation (`combatSystem.ts`)**
  - **Issue**: When an enemy dies, loot IDs from `lootTable` are passed directly to `CardFactory.createFromRegistry()` without checking if they exist in the registry.
  - **Task**: Guard loot drop instantiation with `registry.hasCard(lootId)` to handle missing or deprecated card definitions gracefully.

---

## 5. Serialization & Persistence (`src/sim/serialization/`)

- [ ] **Pack Pity State Restoration (`saveManager.ts`)**
  - **Issue**: Deserializing a saved board state does not restore `pityTrackers` on `PackManager`, resetting pack guarantee streaks to 0 upon reload.
  - **Task**: Restore `state.packManager.pityTrackers` during save state hydration.

- [ ] **Stack Topology GUID Resolution Resilience (`saveManager.ts`)**
  - **Issue**: Parent and child GUID lookups are cast directly as numbers (`guidToEntityId.get(...) as number`) without fallback.
  - **Task**: Add null-coalescing fallbacks (`?? null`) to ensure missing, orphaned, or corrupted GUID references safely evaluate to `null` rather than `undefined`.

---

## 6. Developer Tools & Card Editor (`src/tools/`)

- [ ] **Input Sanitization & Schema Validation (`cardEditor.ts`)**
  - **Task**: Add validation to the Card Editor UI to ensure user-entered hex colors (background, border, typography) and numeric attributes conform to valid formats and bounds.

- [ ] **Recipe Ingredient Registry Verification (`cardEditor.ts`)**
  - **Task**: Validate that specified ingredient card IDs and result card IDs exist in `CardRegistry` before registering new blueprints, preventing silent crafting stalls.
