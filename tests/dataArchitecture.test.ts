import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaValidator } from '../src/mods/schemaValidator.js';
import { CardRegistry } from '../src/mods/cardRegistry.js';
import { LocalizationManager } from '../src/mods/localization.js';
import { ModLoader, ModPackageData } from '../src/mods/modLoader.js';
import { World } from '../src/sim/ecs/world.js';
import { CardFactory } from '../src/sim/cardFactory.js';
import { CardDefinition } from '../src/mods/types.js';

describe('Phase 2: Data Architecture & Modularity Pipeline', () => {
  let validator: SchemaValidator;
  let registry: CardRegistry;
  let loc: LocalizationManager;

  beforeEach(() => {
    validator = new SchemaValidator();
    registry = new CardRegistry();
    loc = new LocalizationManager('en');
  });

  describe('JSON Schema Validation', () => {
    it('should validate a compliant card definition', () => {
      const validCard = {
        id: 'iron_ore',
        nameTerm: 'card_iron_ore_name',
        descriptionTerm: 'card_iron_ore_desc',
        type: 'Resource',
        value: 2,
        cardLimitCost: 1,
        tags: ['tag:mineral', 'tag:raw_metal'],
        dynamicProperties: {
          _SmeltYield: 'iron_bar',
        },
        visualOverrides: {
          background: '#546e7a',
          border: '#cfd8dc',
          typography: '#ffffff',
        },
      };

      const result = validator.validateCardDefinition(validCard);
      expect(result.valid).toBe(true);
      expect(result.data?.id).toBe('iron_ore');
    });

    it('should reject a card with missing required properties or invalid type', () => {
      const invalidCard = {
        id: 'bad_card',
        // Missing nameTerm
        type: 'InvalidTypeEnum',
      };

      const result = validator.validateCardDefinition(invalidCard);
      expect(result.valid).toBe(false);
      expect(result.errors?.length).toBeGreaterThan(0);
    });

    it('should validate a compliant blueprint definition', () => {
      const validBlueprint = {
        id: 'blueprint_smelt_iron',
        nameTerm: 'recipe_smelt_name',
        group: 'Industry',
        subprints: [
          {
            requiredCards: ['iron_ore', 'wood', 'tag:worker'],
            resultCards: [{ id: 'iron_bar', chance: 1.0, amount: 1 }],
            consumedInputs: [true, true, false],
            time: 6.5,
            statusTerm: 'status_smelting',
            priority: 10,
          },
        ],
      };

      const result = validator.validateBlueprintDefinition(validBlueprint);
      expect(result.valid).toBe(true);
      expect(result.data?.subprints[0].time).toBe(6.5);
    });

    it('should reject a blueprint with invalid probability (> 1.0)', () => {
      const invalidBlueprint = {
        id: 'bad_bp',
        nameTerm: 'recipe_bad',
        group: 'Industry',
        subprints: [
          {
            requiredCards: ['wood'],
            resultCards: [{ id: 'wood', chance: 1.5, amount: 1 }], // chance > 1.0
            consumedInputs: [true],
            time: 2.0,
            statusTerm: 'status_bad',
          },
        ],
      };

      const result = validator.validateBlueprintDefinition(invalidBlueprint);
      expect(result.valid).toBe(false);
    });

    it('should validate a booster pack definition', () => {
      const validPack = {
        id: 'pack_industry',
        cost: 5,
        cardsPerPack: 4,
        dropPool: [
          { id: 'iron_ore', weight: 40 },
          { id: 'wood', weight: 60 },
        ],
        guaranteeRules: [{ cardId: 'iron_ore', afterPacks: 3 }],
      };

      const result = validator.validatePackDefinition(validPack);
      expect(result.valid).toBe(true);
      expect(result.data?.cost).toBe(5);
    });
  });

  describe('Card Registry & Multiset Tag Indexing', () => {
    it('should index cards by explicit and implicit tags', () => {
      const villager: CardDefinition = {
        id: 'villager',
        nameTerm: 'card_villager_name',
        type: 'Worker',
        tags: ['tag:worker', 'tag:human'],
      };

      const berry: CardDefinition = {
        id: 'berry',
        nameTerm: 'card_berry_name',
        type: 'Food',
        tags: ['tag:food'],
      };

      registry.registerCard(villager);
      registry.registerCard(berry);

      // Query by ID
      expect(registry.getCard('villager')?.id).toBe('villager');

      // Query by explicit tag
      const humans = registry.getCardsByTag('tag:human');
      expect(humans.map((c) => c.id)).toContain('villager');

      // Query by implicit type tag
      const foods = registry.getCardsByTag('tag:food');
      expect(foods.map((c) => c.id)).toContain('berry');

      // Match requirement helper
      expect(registry.matchesRequirement(villager, 'villager')).toBe(true);
      expect(registry.matchesRequirement(villager, 'tag:worker')).toBe(true);
      expect(registry.matchesRequirement(villager, 'tag:food')).toBe(false);
    });
  });

  describe('Localization Manager', () => {
    it('should parse TSV table and return correct translations with fallback', () => {
      const sampleTsv = `key\ten\tes
card_villager_name\tVillager\tAldeano
card_berry_name\tBerry\tBaya`;

      loc.loadFromTsv(sampleTsv);

      // Default language (en)
      expect(loc.t('card_villager_name')).toBe('Villager');
      expect(loc.t('card_berry_name')).toBe('Berry');

      // Switch language to Spanish (es)
      loc.setLanguage('es');
      expect(loc.t('card_villager_name')).toBe('Aldeano');
      expect(loc.t('card_berry_name')).toBe('Baya');

      // Fallback for missing key
      expect(loc.t('unknown_token', 'Default')).toBe('Default');
    });
  });

  describe('Mod Ingestion & Entity Spawning', () => {
    it('should ingest a complete mod and spawn cards from registry', () => {
      const mockMod: ModPackageData = {
        manifest: {
          id: 'expansion_alchemy',
          name: 'Alchemy Expansion',
          version: '1.0.0',
          priority: 50,
        },
        localizationTsv: `key\ten
card_potion_name\tHealth Potion`,
        cards: {
          health_potion: {
            id: 'health_potion',
            nameTerm: 'card_potion_name',
            type: 'Food',
            value: 5,
            cardLimitCost: 1,
            tags: ['tag:potion', 'tag:consumable'],
            dynamicProperties: {
              _HealAmount: 10,
            },
            visualOverrides: {
              background: '#8e24aa',
              border: '#ce93d8',
              typography: '#ffffff',
            },
          },
        },
        blueprints: {},
        packs: {},
      };

      const result = ModLoader.ingestMod(mockMod);
      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);

      // Spawn card into ECS world
      const world = new World();
      const entityId = CardFactory.createFromRegistry(world, 'health_potion', 150, 200);

      const cardData = world.getComponent(entityId, 'cardData')!;
      expect(cardData.id).toBe('health_potion');
      expect(cardData.value).toBe(5);
      expect(cardData.dynamicProperties._HealAmount).toBe(10);
      expect(cardData.visualOverrides?.background).toBe('#8e24aa');
    });
  });
});
