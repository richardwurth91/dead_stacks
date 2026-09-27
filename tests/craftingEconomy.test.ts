import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/sim/ecs/world.js';
import { CardRegistry } from '../src/mods/cardRegistry.js';
import { RecipeMatcher } from '../src/sim/crafting/recipeMatcher.js';
import { CraftingSystem } from '../src/sim/crafting/craftingSystem.js';
import { MoonSystem } from '../src/sim/economy/moonSystem.js';
import { PackManager } from '../src/sim/economy/packManager.js';
import { SellSystem } from '../src/sim/economy/sellSystem.js';
import { CardFactory } from '../src/sim/cardFactory.js';
import { StackTopology } from '../src/sim/kinematics/stackTopology.js';

describe('Phase 3: Crafting Engine, Temporal Cycles & Macroeconomics', () => {
  let world: World;
  let registry: CardRegistry;
  let matcher: RecipeMatcher;
  let crafting: CraftingSystem;
  let moon: MoonSystem;
  let packMgr: PackManager;

  const spawn = (defId: string, x = 0, y = 0) =>
    CardFactory.createFromRegistry(world, defId, x, y, registry);

  beforeEach(() => {
    world = new World();
    registry = new CardRegistry();
    matcher = new RecipeMatcher(registry);
    crafting = new CraftingSystem(world, matcher, registry);
    moon = new MoonSystem(world, { moonDurationSeconds: 10, baseMaxCards: 20 }, registry);
    packMgr = new PackManager(world, registry);

    // Register basic definitions
    registry.registerCard({
      id: 'villager',
      nameTerm: 'Villager',
      type: 'Worker',
      value: -1,
      tags: ['tag:worker', 'tag:human'],
      dynamicProperties: { _FoodDemand: 1 },
    });

    registry.registerCard({
      id: 'berry_bush',
      nameTerm: 'Berry Bush',
      type: 'Resource',
      value: 1,
      tags: ['tag:plant', 'tag:harvestable'],
    });

    registry.registerCard({
      id: 'berry',
      nameTerm: 'Berry',
      type: 'Food',
      value: 1,
      tags: ['tag:food'],
      dynamicProperties: { _FoodValue: 1 },
    });

    registry.registerCard({
      id: 'wood',
      nameTerm: 'Wood',
      type: 'Resource',
      value: 1,
      tags: ['tag:material'],
    });

    registry.registerCard({
      id: 'coin',
      nameTerm: 'Coin',
      type: 'Coin',
      value: 1,
      cardLimitCost: 0,
      tags: ['tag:currency'],
    });

    registry.registerCard({
      id: 'corpse',
      nameTerm: 'Corpse',
      type: 'Corpse',
      value: 0,
      tags: ['tag:remains'],
    });

    // Register test blueprints
    registry.registerBlueprint({
      id: 'blueprint_foraging',
      nameTerm: 'Forage',
      group: 'Nature',
      subprints: [
        {
          requiredCards: ['berry_bush', 'tag:worker'],
          resultCards: [{ id: 'berry', chance: 1.0, amount: 1 }],
          consumedInputs: [false, false],
          time: 3.0,
          statusTerm: 'status_foraging',
          priority: 5,
        },
      ],
    });

    registry.registerBlueprint({
      id: 'blueprint_chop_wood',
      nameTerm: 'Chop Wood',
      group: 'Nature',
      subprints: [
        {
          requiredCards: ['wood', 'tag:worker'],
          resultCards: [{ id: 'wood', chance: 1.0, amount: 1 }],
          consumedInputs: [true, false],
          time: 2.0,
          statusTerm: 'status_chopping',
          priority: 5,
        },
      ],
    });

    // Register test pack
    registry.registerPack({
      id: 'pack_test',
      cost: 3,
      cardsPerPack: 2,
      dropPool: [
        { id: 'wood', weight: 80 },
        { id: 'villager', weight: 20 },
      ],
      guaranteeRules: [
        { cardId: 'villager', afterPacks: 2 },
      ],
    });
  });

  describe('Multiset Recipe Matching & Conflict Resolution', () => {
    it('should match a recipe regardless of card order in the stack', () => {
      // Order 1: Bush -> Villager
      const bush1 = spawn('berry_bush', 0, 0);
      const villager1 = spawn('villager', 0, 0);
      StackTopology.attachSubStack(world, bush1, villager1);

      const match1 = matcher.findBestRecipeForStack(world, bush1);
      expect(match1).not.toBeNull();
      expect(match1?.blueprint.id).toBe('blueprint_foraging');

      // Order 2: Villager -> Bush
      const villager2 = spawn('villager', 100, 0);
      const bush2 = spawn('berry_bush', 100, 0);
      StackTopology.attachSubStack(world, villager2, bush2);

      const match2 = matcher.findBestRecipeForStack(world, villager2);
      expect(match2).not.toBeNull();
      expect(match2?.blueprint.id).toBe('blueprint_foraging');
    });

    it('should resolve conflicts using Priority Tier', () => {
      registry.registerBlueprint({
        id: 'blueprint_high_priority',
        nameTerm: 'High Priority',
        group: 'Test',
        subprints: [
          {
            requiredCards: ['berry_bush', 'tag:worker'],
            resultCards: [{ id: 'berry', chance: 1.0, amount: 2 }],
            consumedInputs: [false, false],
            time: 1.0,
            statusTerm: 'status_priority',
            priority: 99, // Higher than foraging (5)
          },
        ],
      });

      const bush = spawn('berry_bush', 0, 0);
      const villager = spawn('villager', 0, 0);
      StackTopology.attachSubStack(world, bush, villager);

      const match = matcher.findBestRecipeForStack(world, bush);
      expect(match?.blueprint.id).toBe('blueprint_high_priority');
    });

    it('should resolve conflicts using Ingredient Specificity', () => {
      // Same priority (5), but one specifies concrete 'villager' ID instead of 'tag:worker'
      registry.registerBlueprint({
        id: 'blueprint_specific',
        nameTerm: 'Specific Recipe',
        group: 'Test',
        subprints: [
          {
            requiredCards: ['berry_bush', 'villager'], // 2 concrete IDs vs 1 concrete + 1 tag
            resultCards: [{ id: 'berry', chance: 1.0, amount: 3 }],
            consumedInputs: [false, false],
            time: 1.0,
            statusTerm: 'status_specific',
            priority: 5,
          },
        ],
      });

      const bush = spawn('berry_bush', 0, 0);
      const villager = spawn('villager', 0, 0);
      StackTopology.attachSubStack(world, bush, villager);

      const match = matcher.findBestRecipeForStack(world, bush);
      expect(match?.blueprint.id).toBe('blueprint_specific');
    });
  });

  describe('Crafting Lifecycle & Mid-Craft Disturbance Safeguards', () => {
    it('should progress crafting and spawn output items upon completion', () => {
      const bush = spawn('berry_bush', 100, 100);
      const villager = spawn('villager', 100, 100);
      StackTopology.attachSubStack(world, bush, villager);

      // Verify craft started
      crafting.evaluateStack(bush);
      const craft = world.getComponent(bush, 'crafting');
      expect(craft).toBeDefined();
      expect(craft?.recipeId).toBe('blueprint_foraging');

      // Advance by 3 seconds (full duration)
      crafting.update(3.1);

      // Berry should have spawned
      const allCards = world.query('cardData');
      const berries = allCards.filter((id) => world.getComponent(id, 'cardData')?.id === 'berry');
      expect(berries.length).toBe(1);

      // Worker and bush should still exist (consumedInputs was [false, false])
      expect(world.hasComponent(bush, 'cardData')).toBe(true);
      expect(world.hasComponent(villager, 'cardData')).toBe(true);
    });

    it('should cancel active crafting immediately when stack is disturbed mid-craft', () => {
      const bush = spawn('berry_bush', 100, 100);
      const villager = spawn('villager', 100, 100);
      StackTopology.attachSubStack(world, bush, villager);

      crafting.evaluateStack(bush);
      expect(world.hasComponent(bush, 'crafting')).toBe(true);

      // Advance craft halfway (1.5s / 3.0s)
      crafting.update(1.5);
      expect(world.getComponent(bush, 'crafting')?.progress).toBeCloseTo(1.5, 1);

      // Player extracts the villager mid-craft!
      StackTopology.extractSubStack(world, villager);

      // Craft should be completely aborted and removed
      expect(world.hasComponent(bush, 'crafting')).toBe(false);

      // Ticking further should NOT spawn berries
      crafting.update(2.0);
      const allCards = world.query('cardData');
      const berries = allCards.filter((id) => world.getComponent(id, 'cardData')?.id === 'berry');
      expect(berries.length).toBe(0);
    });
  });

  describe('Moon Temporal Cycle & Starvation Lifecycle', () => {
    it('should feed workers when sufficient food is available', () => {
      const v1 = spawn('villager', 0, 0);
      const v2 = spawn('villager', 50, 0);
      const f1 = spawn('berry', 100, 0);
      const f2 = spawn('berry', 150, 0);

      const result = moon.resolveMoonEnd();
      expect(result.fedWorkers).toBe(2);
      expect(result.starvedWorkers).toBe(0);

      // Both berries consumed
      expect(world.hasComponent(f1, 'cardData')).toBe(false);
      expect(world.hasComponent(f2, 'cardData')).toBe(false);

      // Workers alive
      expect(world.hasComponent(v1, 'cardData')).toBe(true);
      expect(world.hasComponent(v2, 'cardData')).toBe(true);
    });

    it('should starve unfed workers and spawn corpses at their coordinates', () => {
      const villager = spawn('villager', 320, 240);

      // Zero food on board
      const result = moon.resolveMoonEnd();
      expect(result.fedWorkers).toBe(0);
      expect(result.starvedWorkers).toBe(1);

      // Villager destroyed
      expect(world.hasComponent(villager, 'cardData')).toBe(false);

      // Corpse spawned at villager's location
      const corpses = world.query('cardData').filter(
        (id) => world.getComponent(id, 'cardData')?.id === 'corpse'
      );
      expect(corpses.length).toBe(1);

      const corpseTransform = world.getComponent(corpses[0], 'transform')!;
      expect(corpseTransform.x).toBe(320);
      expect(corpseTransform.y).toBe(240);
    });
  });

  describe('Booster Pack Economics & Pity Guarantees', () => {
    it('should require sufficient coins stacked on pack before opening', () => {
      const packCard = CardFactory.createCard(world, {
        defId: 'pack_test',
        nameTerm: 'Test Pack',
        type: 'Pack',
        x: 100,
        y: 100,
      });

      const coin1 = spawn('coin', 100, 100);
      const coin2 = spawn('coin', 100, 100);

      StackTopology.attachSubStack(world, packCard, coin1);
      StackTopology.attachSubStack(world, packCard, coin2);

      // Cost is 3, only 2 coins attached
      expect(packMgr.canOpenPack(packCard)).toBe(false);

      // Attach 3rd coin
      const coin3 = spawn('coin', 100, 100);
      StackTopology.attachSubStack(world, packCard, coin3);

      expect(packMgr.canOpenPack(packCard)).toBe(true);

      // Opening consumes coins, destroys pack, and returns drawn card IDs
      const drawn = packMgr.openPack(packCard);
      expect(drawn.length).toBe(2);
      expect(world.hasComponent(packCard, 'cardData')).toBe(false);
      expect(world.hasComponent(coin1, 'cardData')).toBe(false);
      expect(world.hasComponent(coin2, 'cardData')).toBe(false);
      expect(world.hasComponent(coin3, 'cardData')).toBe(false);
    });
  });

  describe('Sell System', () => {
    it('should sell cards with positive value and reject unsellable cards', () => {
      const wood = spawn('wood', 100, 100);
      const villager = spawn('villager', 200, 200);

      expect(SellSystem.canSell(world, wood)).toBe(true);
      expect(SellSystem.canSell(world, villager)).toBe(false); // value = -1

      const coinsSpawned = SellSystem.sellCard(world, wood, 100, 100, registry);
      expect(coinsSpawned).toBe(1);
      expect(world.hasComponent(wood, 'cardData')).toBe(false);

      const allCoins = world.query('cardData').filter(
        (id) => world.getComponent(id, 'cardData')?.id === 'coin'
      );
      expect(allCoins.length).toBe(1);
    });
  });
});
