import { World } from './ecs/world.js';
import { CardDataComponent, CardType, CombatArchetype, CombatTier } from './ecs/components.js';
import { globalEventBus } from './events.js';
import { CardDefinition } from '../mods/types.js';
import { CardRegistry, globalCardRegistry } from '../mods/cardRegistry.js';
import { TIER_STATS_TABLE } from './combat/combatMath.js';

export interface CardSpawnOptions {
  defId: string;
  nameTerm: string;
  descriptionTerm?: string;
  type: CardType;
  x: number;
  y: number;
  value?: number;
  cardLimitCost?: number;
  dynamicProperties?: Record<string, any>;
  visualOverrides?: {
    background?: string;
    border?: string;
    typography?: string;
  };
}

let nextGuidId = 1;

export function generateCardGuid(defId: string): string {
  return `${defId}_${Date.now()}_${nextGuidId++}`;
}

export class CardFactory {
  static createFromDefinition(world: World, def: CardDefinition, x: number, y: number): number {
    return this.createCard(world, {
      defId: def.id,
      nameTerm: def.nameTerm,
      descriptionTerm: def.descriptionTerm,
      type: def.type,
      x,
      y,
      value: def.value,
      cardLimitCost: def.cardLimitCost,
      dynamicProperties: def.dynamicProperties,
      visualOverrides: def.visualOverrides,
    });
  }

  static createFromRegistry(
    world: World,
    defId: string,
    x: number,
    y: number,
    registry: CardRegistry = globalCardRegistry
  ): number {
    const def = registry.getCard(defId);
    if (!def) {
      throw new Error(`Card definition '${defId}' not found in registry`);
    }
    return this.createFromDefinition(world, def, x, y);
  }

  static createCard(world: World, options: CardSpawnOptions): number {
    const entityId = world.createEntity();

    const cardData: CardDataComponent = {
      id: options.defId,
      instanceGuid: generateCardGuid(options.defId),
      nameTerm: options.nameTerm,
      descriptionTerm: options.descriptionTerm || '',
      type: options.type,
      value: options.value ?? 1,
      cardLimitCost: options.cardLimitCost ?? 1,
      dynamicProperties: options.dynamicProperties || {},
      visualOverrides: options.visualOverrides,
    };

    world.addComponent(entityId, 'cardData', cardData);

    world.addComponent(entityId, 'transform', {
      x: options.x,
      y: options.y,
      vx: 0,
      vy: 0,
      elevation: 0,
      zIndex: 10,
    });

    world.addComponent(entityId, 'stackNode', {
      parentId: null,
      childId: null,
      stackRootId: entityId,
      stackIndex: 0,
    });

    world.addComponent(entityId, 'draggable', {
      isDragging: false,
      dragStartX: 0,
      dragStartY: 0,
      pointerOffsetX: 0,
      pointerOffsetY: 0,
    });

    world.addComponent(entityId, 'physical', {
      width: 80,
      height: 110,
      mass: 1.0,
      clearanceRadius: 95,
      isPinned: false,
    });

    // Attach CombatantComponent if applicable
    if (options.type === 'Mob' || options.type === 'Worker' || options.dynamicProperties?._CombatTier) {
      const tier =
        (options.dynamicProperties?._CombatTier as CombatTier) ||
        (options.type === 'Mob' ? 'Weak' : 'Normal');
      const stats = TIER_STATS_TABLE[tier] || TIER_STATS_TABLE['Normal'];
      const maxHp = options.dynamicProperties?._Health ?? (options.type === 'Mob' ? 4 : 6);

      world.addComponent(entityId, 'combatant', {
        archetype: (options.dynamicProperties?._Archetype as CombatArchetype) || 'Melee',
        tier,
        health: maxHp,
        maxHealth: maxHp,
        attackInterval: options.dynamicProperties?._AttackInterval ?? stats.attackInterval,
        attackCooldown: options.dynamicProperties?._AttackInterval ?? stats.attackInterval,
        hitProbability: options.dynamicProperties?._HitProbability ?? stats.hitProbability,
        baseDamage: options.dynamicProperties?._BaseDamage ?? stats.baseDamage,
        defenseBlock: options.dynamicProperties?._DefenseBlock ?? stats.defenseBlock,
        stunDuration: 0,
        specialEffect: options.dynamicProperties?._SpecialEffect,
        isHostile: options.dynamicProperties?._IsHostile ?? (options.type === 'Mob'),
        lootTable: options.dynamicProperties?._LootTable ?? (options.type === 'Mob' ? ['coin'] : []),
      });
    }

    globalEventBus.emit('OnCardSpawned', {
      entityId,
      cardDefId: options.defId,
      x: options.x,
      y: options.y,
    });

    return entityId;
  }
}
