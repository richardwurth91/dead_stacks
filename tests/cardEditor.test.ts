import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/sim/ecs/world.js';
import { CardRegistry } from '../src/mods/cardRegistry.js';
import { CardFactory } from '../src/sim/cardFactory.js';
import { CardEditor } from '../src/tools/cardEditor.js';
import { CraftingSystem } from '../src/sim/crafting/craftingSystem.js';
import { RecipeMatcher } from '../src/sim/crafting/recipeMatcher.js';
import { StackTopology } from '../src/sim/kinematics/stackTopology.js';
import { globalEventBus } from '../src/sim/events.js';

describe('In-UI Card Attribute & Recipe Editor (Visible & Invisible Attributes)', () => {
  let world: World;
  let registry: CardRegistry;
  let matcher: RecipeMatcher;
  let craftingSystem: CraftingSystem;

  beforeEach(() => {
    world = new World();
    registry = new CardRegistry();

    // Register initial core cards
    registry.registerCard({
      id: 'villager',
      nameTerm: 'Villager',
      type: 'Worker',
      value: 3,
      tags: ['worker', 'human'],
      dynamicProperties: { _FoodDemand: 1, _Health: 6, _BaseDamage: 2 },
    });

    registry.registerCard({
      id: 'wood',
      nameTerm: 'Wood',
      type: 'Resource',
      value: 1,
      tags: ['material'],
    });

    registry.registerCard({
      id: 'berry',
      nameTerm: 'Berry',
      type: 'Food',
      value: 1,
      tags: ['food'],
      dynamicProperties: { _FoodValue: 1 },
    });

    registry.registerCard({
      id: 'goblin',
      nameTerm: 'Goblin',
      type: 'Mob',
      value: 4,
      tags: ['enemy'],
      dynamicProperties: {
        _Archetype: 'Melee',
        _CombatTier: 'Weak',
        _Health: 4,
      },
    });

    matcher = new RecipeMatcher(registry);
    craftingSystem = new CraftingSystem(world, matcher, registry);
  });

  describe('Visible Attributes: Live Color and Styling Propagation', () => {
    it('changes card background color to white and updates all active board instances', () => {
      // Spawn two Villagers on the board
      const v1 = CardFactory.createFromRegistry(world, 'villager', 100, 100, registry);
      const v2 = CardFactory.createFromRegistry(world, 'villager', 200, 100, registry);

      let eventEmitted = false;
      const unsubscribe = globalEventBus.on('OnCardDefinitionUpdated', ({ defId, updatedDef }) => {
        if (defId === 'villager' && updatedDef.visualOverrides?.background === '#ffffff') {
          eventEmitted = true;
        }
      });

      // Modify the Villager definition directly via CardEditor (as triggered by the UI)
      CardEditor.applyCardModifications(world, registry, 'villager', {
        visualOverrides: {
          background: '#ffffff', // White background
          border: '#e2e8f0',
          typography: '#0f172a', // Dark text
        },
      });

      unsubscribe();

      expect(eventEmitted).toBe(true);

      // Verify BOTH active cards on the board immediately updated to white
      const c1Data = world.getComponent(v1, 'cardData')!;
      const c2Data = world.getComponent(v2, 'cardData')!;
      expect(c1Data.visualOverrides?.background).toBe('#ffffff');
      expect(c2Data.visualOverrides?.background).toBe('#ffffff');
      expect(c1Data.visualOverrides?.typography).toBe('#0f172a');
      expect(c2Data.visualOverrides?.typography).toBe('#0f172a');

      // Verify future cards spawned also inherit the white color
      const v3 = CardFactory.createFromRegistry(world, 'villager', 300, 100, registry);
      const c3Data = world.getComponent(v3, 'cardData')!;
      expect(c3Data.visualOverrides?.background).toBe('#ffffff');
    });

    it('changes display name and card type across all instances', () => {
      const v1 = CardFactory.createFromRegistry(world, 'villager', 100, 100, registry);

      CardEditor.applyCardModifications(world, registry, 'villager', {
        nameTerm: 'Elder Villager',
        type: 'Structure', // Change type from Worker to Structure
      });

      const cardData = world.getComponent(v1, 'cardData')!;
      expect(cardData.nameTerm).toBe('Elder Villager');
      expect(cardData.type).toBe('Structure');

      // Future instances also inherit Elder Villager and Structure
      const v2 = CardFactory.createFromRegistry(world, 'villager', 200, 100, registry);
      const card2Data = world.getComponent(v2, 'cardData')!;
      expect(card2Data.nameTerm).toBe('Elder Villager');
      expect(card2Data.type).toBe('Structure');
    });
  });

  describe('Invisible Attributes: Game Balance & Combat Stats', () => {
    it('modifies sell value and economic dynamic properties across all cards', () => {
      const b1 = CardFactory.createFromRegistry(world, 'berry', 50, 50, registry);

      CardEditor.applyCardModifications(world, registry, 'berry', {
        value: 10, // Increase sell value from 1 to 10
        dynamicProperties: {
          _FoodValue: 5, // Buff food nutrition from 1 to 5
        },
      });

      const cardData = world.getComponent(b1, 'cardData')!;
      expect(cardData.value).toBe(10);
      expect(cardData.dynamicProperties._FoodValue).toBe(5);

      // Verify future berries have the buffed nutrition and price
      const b2 = CardFactory.createFromRegistry(world, 'berry', 150, 50, registry);
      const card2Data = world.getComponent(b2, 'cardData')!;
      expect(card2Data.value).toBe(10);
      expect(card2Data.dynamicProperties._FoodValue).toBe(5);
    });

    it('modifies combat stats and updates active combatant components on board', () => {
      const g1 = CardFactory.createFromRegistry(world, 'goblin', 80, 80, registry);
      const combatBefore = world.getComponent(g1, 'combatant')!;
      expect(combatBefore.maxHealth).toBe(4);

      // Buff Goblin Boss attributes in editor
      CardEditor.applyCardModifications(world, registry, 'goblin', {
        nameTerm: 'Goblin Boss',
        dynamicProperties: {
          _Health: 15,
          _BaseDamage: 5,
          _CombatTier: 'Strong',
        },
      });

      const combatAfter = world.getComponent(g1, 'combatant')!;
      expect(combatAfter.maxHealth).toBe(15);
      expect(combatAfter.baseDamage).toBe(5);
      expect(combatAfter.tier).toBe('Strong');

      // Future goblins spawned become Goblin Boss with 15 HP
      const g2 = CardFactory.createFromRegistry(world, 'goblin', 180, 80, registry);
      const combat2 = world.getComponent(g2, 'combatant')!;
      expect(combat2.maxHealth).toBe(15);
      expect(combat2.baseDamage).toBe(5);
    });
  });

  describe('Invisible Attributes: Dynamic Recipe Creation & Combination', () => {
    it('defines a new recipe combining Berry + Wood to craft a Villager, and completes craft on stack', () => {
      // Define a custom combination recipe in the UI: Berry + Wood -> Villager
      CardEditor.addOrUpdateRecipe(registry, craftingSystem, {
        resultCardId: 'villager',
        ingredientCardIds: ['berry', 'wood'],
        durationSeconds: 1.5,
        statusTerm: 'Summoning Villager...',
        consumedInputs: [true, true], // Consume both ingredients
      });

      // Verify blueprint was added to registry
      const blueprints = registry.getBlueprintsProducingCard('villager');
      expect(blueprints.length).toBeGreaterThanOrEqual(1);

      // Spawn a Berry and Wood on the tabletop
      const berry = CardFactory.createFromRegistry(world, 'berry', 200, 200, registry);
      const wood = CardFactory.createFromRegistry(world, 'wood', 200, 228, registry);

      // Stack Wood onto Berry
      StackTopology.attachSubStack(world, berry, wood);

      // Verify that CraftingSystem immediately detected the new recipe!
      const craft = world.getComponent(berry, 'crafting');
      expect(craft).toBeDefined();
      expect(craft?.statusTerm).toBe('Summoning Villager...');
      expect(craft?.duration).toBe(1.5);

      // Progress craft to completion (1.6s)
      craftingSystem.update(1.6);

      // Ingredients should be consumed and a new Villager should be present!
      const allCards = world.query('cardData');
      const defIds = allCards.map((id) => world.getComponent(id, 'cardData')!.id);

      expect(defIds).toContain('villager');
      // Berry and Wood were consumed
      expect(defIds.filter((id) => id === 'berry').length).toBe(0);
      expect(defIds.filter((id) => id === 'wood').length).toBe(0);
    });

    it('triggers crafting immediately on cards that were ALREADY stacked when recipe is created', () => {
      // Stack Berry and Wood BEFORE the recipe exists
      const berry = CardFactory.createFromRegistry(world, 'berry', 300, 300, registry);
      const wood = CardFactory.createFromRegistry(world, 'wood', 300, 328, registry);
      StackTopology.attachSubStack(world, berry, wood);

      // Currently no recipe exists for [berry, wood]
      expect(world.hasComponent(berry, 'crafting')).toBe(false);

      // Now create the recipe in the UI while cards are already stacked on the table
      CardEditor.addOrUpdateRecipe(registry, craftingSystem, {
        resultCardId: 'villager',
        ingredientCardIds: ['berry', 'wood'],
        durationSeconds: 2.0,
      });

      // Crafting should start immediately without needing to re-stack the cards!
      const craft = world.getComponent(berry, 'crafting');
      expect(craft).toBeDefined();
      expect(craft?.duration).toBe(2.0);
    });
  });
});
