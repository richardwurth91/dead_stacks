import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/sim/ecs/world.js';
import { SimLoop } from '../src/sim/loop/simLoop.js';
import { CardFactory } from '../src/sim/cardFactory.js';
import { StackTopology } from '../src/sim/kinematics/stackTopology.js';
import { findUnoccupiedPosition } from '../src/sim/kinematics/placement.js';
import { SaveManager } from '../src/sim/serialization/saveManager.js';
import { CardRegistry } from '../src/mods/cardRegistry.js';
import { PackManager } from '../src/sim/economy/packManager.js';
import { CraftingSystem } from '../src/sim/crafting/craftingSystem.js';
import { MoonSystem } from '../src/sim/economy/moonSystem.js';
import { CombatSystem } from '../src/sim/combat/combatSystem.js';
import { RecipeMatcher } from '../src/sim/crafting/recipeMatcher.js';
import { DevOverlay } from '../src/tools/devOverlay.js';

describe('Phase 5: Hardening, Developer Tooling & Serialization', () => {
  let registry: CardRegistry;
  let matcher: RecipeMatcher;

  function createTestSimLoop(world: World): SimLoop {
    const craft = new CraftingSystem(world, matcher, registry);
    const moon = new MoonSystem(world, undefined, registry);
    const combat = new CombatSystem(world, registry);
    return new SimLoop(world, craft, moon, combat);
  }

  beforeEach(() => {
    registry = new CardRegistry();

    // Register basic test cards
    registry.registerCard({
      id: 'villager',
      nameTerm: 'card.villager.name',
      type: 'Worker',
      value: 3,
      tags: ['worker', 'human'],
      dynamicProperties: { _FoodDemand: 1 },
    });

    registry.registerCard({
      id: 'berry_bush',
      nameTerm: 'card.berry_bush.name',
      type: 'Resource',
      value: 2,
      tags: ['nature', 'harvestable'],
    });

    registry.registerCard({
      id: 'berry',
      nameTerm: 'card.berry.name',
      type: 'Food',
      value: 1,
      tags: ['food'],
      dynamicProperties: { _FoodValue: 1 },
    });

    registry.registerCard({
      id: 'wood',
      nameTerm: 'card.wood.name',
      type: 'Resource',
      value: 1,
      tags: ['material'],
    });

    registry.registerCard({
      id: 'rock',
      nameTerm: 'card.rock.name',
      type: 'Resource',
      value: 1,
      tags: ['material'],
    });

    registry.registerCard({
      id: 'coin',
      nameTerm: 'card.coin.name',
      type: 'Coin',
      value: 1,
      tags: ['currency'],
    });

    registry.registerCard({
      id: 'goblin',
      nameTerm: 'card.goblin.name',
      type: 'Mob',
      value: 4,
      tags: ['enemy'],
      dynamicProperties: {
        _Archetype: 'Melee',
        _CombatTier: 'Weak',
        _Health: 4,
      },
    });

    registry.registerBlueprint({
      id: 'bp_harvest_berries',
      nameTerm: 'Harvest Berries',
      group: 'Foraging',
      subprints: [
        {
          requiredCards: ['villager', 'berry_bush'],
          time: 2.0,
          statusTerm: 'Harvesting Berries...',
          consumedInputs: [false, false],
          resultCards: [{ id: 'berry', chance: 1, amount: 1 }],
        },
      ],
    });

    matcher = new RecipeMatcher(registry);
  });

  describe('Spatial Raycast & Placement (findUnoccupiedPosition)', () => {
    it('returns preferred position when table is completely empty', () => {
      const world = new World();
      const pos = findUnoccupiedPosition(world, 250, 300);
      expect(pos.x).toBe(250);
      expect(pos.y).toBe(300);
    });

    it('sweeps outward when preferred position is already occupied by a card', () => {
      const world = new World();
      CardFactory.createFromRegistry(world, 'villager', 200, 200, registry);

      const targetPos = findUnoccupiedPosition(world, 200, 200, { clearanceRadius: 95 });
      const dist = Math.hypot(targetPos.x - 200, targetPos.y - 200);

      // Must be at least clearance radius away
      expect(dist).toBeGreaterThanOrEqual(95);
    });

    it('finds valid clearance when multiple cards cluster near the center', () => {
      const world = new World();
      CardFactory.createFromRegistry(world, 'villager', 300, 300, registry);
      CardFactory.createFromRegistry(world, 'wood', 380, 300, registry);
      CardFactory.createFromRegistry(world, 'rock', 300, 380, registry);

      const candidate = findUnoccupiedPosition(world, 300, 300, { clearanceRadius: 90 });
      const cards = world.query('transform');

      for (const id of cards) {
        const tr = world.getComponent(id, 'transform')!;
        const dist = Math.hypot(candidate.x - tr.x, candidate.y - tr.y);
        expect(dist).toBeGreaterThanOrEqual(85);
      }
    });
  });

  describe('Full Board State Serialization & Deserialization', () => {
    it('serializes and deserializes active board topology, stacks, and MoonSystem state', () => {
      const worldA = new World();
      const simLoopA = createTestSimLoop(worldA);
      const packManagerA = new PackManager(worldA, registry);

      // Create a stack: Villager -> Berry Bush -> Coin
      const c1 = CardFactory.createFromRegistry(worldA, 'villager', 100, 100, registry);
      const c2 = CardFactory.createFromRegistry(worldA, 'berry_bush', 100, 128, registry);
      const c3 = CardFactory.createFromRegistry(worldA, 'coin', 100, 156, registry);

      StackTopology.attachSubStack(worldA, c1, c2);
      StackTopology.attachSubStack(worldA, c2, c3);

      // Modify Moon state
      simLoopA.moonSystem.update(35); // 120 - 35 = 85s remaining

      // Serialize
      const savedState = SaveManager.serialize(worldA, simLoopA, packManagerA);
      expect(savedState.version).toBe(1);
      expect(savedState.cards.length).toBe(3);
      expect(savedState.moon.timeRemaining).toBeCloseTo(85, 1);

      // Verify stack linkages in saved data
      const vCard = savedState.cards.find((c) => c.defId === 'villager')!;
      const bCard = savedState.cards.find((c) => c.defId === 'berry_bush')!;
      const coinCard = savedState.cards.find((c) => c.defId === 'coin')!;

      expect(vCard.stackNode.parentGuid).toBeNull();
      expect(vCard.stackNode.childGuid).toBe(bCard.guid);
      expect(bCard.stackNode.parentGuid).toBe(vCard.guid);
      expect(bCard.stackNode.childGuid).toBe(coinCard.guid);
      expect(coinCard.stackNode.childGuid).toBeNull();

      // Deserialize into fresh World B
      const worldB = new World();
      const simLoopB = createTestSimLoop(worldB);
      const packManagerB = new PackManager(worldB, registry);

      SaveManager.deserialize(savedState, worldB, simLoopB, packManagerB, registry);

      const restoredCards = worldB.query('cardData');
      expect(restoredCards.length).toBe(3);

      // Verify MoonSystem restored
      expect(simLoopB.moonSystem.getTimeRemaining()).toBeCloseTo(85, 1);

      // Verify stack restored in World B
      const rootCandidates = restoredCards.filter((id) => {
        const node = worldB.getComponent(id, 'stackNode')!;
        return node.parentId === null;
      });
      expect(rootCandidates.length).toBe(1);

      const stackArray = StackTopology.getStackArray(worldB, rootCandidates[0]);
      expect(stackArray.length).toBe(3);

      const typeArray = stackArray.map((id) => worldB.getComponent(id, 'cardData')!.type);
      expect(typeArray).toEqual(['Worker', 'Resource', 'Coin']);
    });

    it('accurately captures and restores mid-craft progress without duplicating ingredients', () => {
      const worldA = new World();
      const simLoopA = createTestSimLoop(worldA);
      const packManagerA = new PackManager(worldA, registry);

      const villager = CardFactory.createFromRegistry(worldA, 'villager', 200, 200, registry);
      const bush = CardFactory.createFromRegistry(worldA, 'berry_bush', 200, 228, registry);
      StackTopology.attachSubStack(worldA, villager, bush);

      // Update crafting for 1.0 second (halfway through 2.0s duration)
      simLoopA.craftingSystem.update(1.0);
      const craftA = worldA.getComponent(villager, 'crafting')!;
      expect(craftA).toBeDefined();
      expect(craftA.progress).toBeCloseTo(1.0, 1);

      // Serialize mid-craft
      const state = SaveManager.serialize(worldA, simLoopA, packManagerA);
      expect(state.crafting.length).toBe(1);
      expect(state.crafting[0].normalizedProgress).toBeCloseTo(0.5, 2);

      // Deserialize in World B
      const worldB = new World();
      const simLoopB = createTestSimLoop(worldB);
      const packManagerB = new PackManager(worldB, registry);

      SaveManager.deserialize(state, worldB, simLoopB, packManagerB, registry);

      const restoredCards = worldB.query('cardData');
      expect(restoredCards.length).toBe(2);

      const restoredCrafting = worldB.query('crafting');
      expect(restoredCrafting.length).toBe(1);

      const restoredCraft = worldB.getComponent(restoredCrafting[0], 'crafting')!;
      expect(restoredCraft.progress).toBeCloseTo(1.0, 1);
      expect(restoredCraft.duration).toBe(2.0);

      // Run simulation for remaining 1.1s in World B -> Crafting should successfully complete and spawn berry!
      simLoopB.craftingSystem.update(1.1);

      const cardsAfterFinish = worldB.query('cardData');
      // Should now have villager, bush, and newly harvested berry
      expect(cardsAfterFinish.length).toBe(3);
      const defIds = cardsAfterFinish.map((id) => worldB.getComponent(id, 'cardData')!.id);
      expect(defIds).toContain('berry');
    });

    it('serializes and deserializes damaged combatants with exact health and cooldowns', () => {
      const worldA = new World();
      const simLoopA = createTestSimLoop(worldA);
      const packManagerA = new PackManager(worldA, registry);

      const goblin = CardFactory.createFromRegistry(worldA, 'goblin', 300, 300, registry);
      const combatComp = worldA.getComponent(goblin, 'combatant')!;
      combatComp.health = 2; // Damaged down to 2
      combatComp.attackCooldown = 0.75;

      const state = SaveManager.serialize(worldA, simLoopA, packManagerA);
      expect(state.cards[0].combatant?.health).toBe(2);
      expect(state.cards[0].combatant?.attackCooldown).toBe(0.75);

      const worldB = new World();
      const simLoopB = createTestSimLoop(worldB);
      const packManagerB = new PackManager(worldB, registry);

      SaveManager.deserialize(state, worldB, simLoopB, packManagerB, registry);

      const restoredCards = worldB.query('combatant');
      expect(restoredCards.length).toBe(1);
      const restoredCombat = worldB.getComponent(restoredCards[0], 'combatant')!;
      expect(restoredCombat.health).toBe(2);
      expect(restoredCombat.attackCooldown).toBe(0.75);
    });
  });

  describe('Developer Tooling & Hotkey Duplication', () => {
    it('duplicates a selected card stack into a brand new stack cleanly', () => {
      const world = new World();
      const simLoop = createTestSimLoop(world);
      const packManager = new PackManager(world, registry);
      const devOverlay = new DevOverlay(world, simLoop, packManager, registry);

      // Create a stack: Villager + Berry Bush
      const villager = CardFactory.createFromRegistry(world, 'villager', 200, 200, registry);
      const bush = CardFactory.createFromRegistry(world, 'berry_bush', 200, 228, registry);
      StackTopology.attachSubStack(world, villager, bush);

      devOverlay.setSelectedCard(bush); // Select child or root

      const success = devOverlay.duplicateSelectedStack();
      expect(success).toBe(true);

      // Now 4 total cards in world
      const allCards = world.query('cardData');
      expect(allCards.length).toBe(4);

      // Should have 2 distinct stack roots
      const roots = allCards.filter((id) => {
        const node = world.getComponent(id, 'stackNode')!;
        return node.parentId === null;
      });
      expect(roots.length).toBe(2);

      // Both roots should have a child
      for (const r of roots) {
        const stack = StackTopology.getStackArray(world, r);
        expect(stack.length).toBe(2);
      }
    });

    it('injects 5 coins into the simulation', () => {
      const world = new World();
      const simLoop = createTestSimLoop(world);
      const packManager = new PackManager(world, registry);
      const devOverlay = new DevOverlay(world, simLoop, packManager, registry);

      devOverlay.grantCoins(5, 400, 400);

      const coins = world.query('cardData').filter((id) => {
        return world.getComponent(id, 'cardData')!.type === 'Coin';
      });
      expect(coins.length).toBe(5);
    });
  });

  describe('High-Density Stress Benchmark (500 Cards)', () => {
    it('simulates 500 cards across 60 fixed ticks without crash, cycle, or NaN coordinates', () => {
      const world = new World();
      const simLoop = createTestSimLoop(world);

      const count = 500;
      const originX = 500;
      const originY = 500;

      // Spawn 500 cards in concentric / Archimedean rings
      for (let i = 0; i < count; i++) {
        const angle = i * 2.399963;
        const r = 25 * Math.sqrt(i);
        const x = originX + r * Math.cos(angle);
        const y = originY + r * Math.sin(angle);

        CardFactory.createFromRegistry(
          world,
          i % 2 === 0 ? 'villager' : 'berry_bush',
          x,
          y,
          registry
        );
      }

      expect(world.query('cardData').length).toBe(count);

      const startTime = performance.now();

      // Run 60 fixed physics/simulation ticks (1 full simulated second)
      for (let tick = 0; tick < 60; tick++) {
        simLoop.update(1 / 60);
      }

      const totalTimeMs = performance.now() - startTime;

      // Ensure no entity has NaN coordinates or exploded off screen
      const allTransforms = world.query('transform');
      expect(allTransforms.length).toBe(count);

      for (const id of allTransforms) {
        const tr = world.getComponent(id, 'transform')!;
        expect(Number.isFinite(tr.x)).toBe(true);
        expect(Number.isFinite(tr.y)).toBe(true);
        expect(Number.isFinite(tr.vx)).toBe(true);
        expect(Number.isFinite(tr.vy)).toBe(true);
        expect(isNaN(tr.x)).toBe(false);
        expect(isNaN(tr.y)).toBe(false);
      }

      console.log(`[Stress Benchmark] 500 cards simulated for 60 ticks in ${totalTimeMs.toFixed(2)}ms`);
      // Performance check: should complete comfortably under 5000ms
      expect(totalTimeMs).toBeLessThan(5000);
    });
  });
});
