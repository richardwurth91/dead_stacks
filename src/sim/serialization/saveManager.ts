import { World } from '../ecs/world.js';
import {
  CardDataComponent,
  TransformComponent,
  StackNodeComponent,
  CombatantComponent,
  PackStateComponent,
  CraftingComponent,
  CardType,
  CombatArchetype,
  CombatTier,
  SpecialCombatEffect,
} from '../ecs/components.js';
import { SimLoop } from '../loop/simLoop.js';
import { PackManager } from '../economy/packManager.js';
import { globalEventBus } from '../events.js';
import { CardRegistry, globalCardRegistry } from '../../mods/cardRegistry.js';

export interface SerializedCard {
  guid: string;
  defId: string;
  nameTerm: string;
  descriptionTerm?: string;
  type: CardType;
  value: number;
  cardLimitCost: number;
  dynamicProperties: Record<string, any>;
  visualOverrides?: {
    background?: string;
    border?: string;
    typography?: string;
  };
  transform: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    elevation: number;
    zIndex: number;
  };
  stackNode: {
    parentGuid: string | null;
    childGuid: string | null;
    stackRootGuid: string;
    stackIndex: number;
  };
  combatant?: {
    archetype: CombatArchetype;
    tier: CombatTier;
    health: number;
    maxHealth: number;
    attackCooldown: number;
    attackInterval: number;
    hitProbability: number;
    baseDamage: number;
    defenseBlock: number;
    stunDuration: number;
    specialEffect?: SpecialCombatEffect;
    isHostile: boolean;
    lootTable?: string[];
  };
  packState?: {
    packDefId: string;
    cost: number;
    depositedCoins: number;
  };
}

export interface SerializedCrafting {
  stackRootGuid: string;
  recipeId: string;
  subprintIndex: number;
  progress: number;
  duration: number;
  normalizedProgress: number; // t_norm in [0, 1]
  statusTerm: string;
  inputGuids: string[];
  consumedMap: boolean[];
}

export interface SerializedBoardState {
  version: number;
  engineVersion: string;
  timestamp: number;
  moon: {
    moonNumber: number;
    timeRemaining: number;
    isFeedingPhase: boolean;
  };
  packManager: {
    pityTrackers: Record<string, Record<string, number>>;
    unlockedBlueprints: string[];
  };
  cards: SerializedCard[];
  crafting: SerializedCrafting[];
}

export class SaveManager {
  static readonly CURRENT_VERSION = 1;
  static readonly ENGINE_VERSION = '0.5.0-alpha';

  /**
   * Serializes the complete active simulation state to a deterministic JSON-serializable object.
   */
  static serialize(
    world: World,
    simLoop: SimLoop,
    packManager: PackManager
  ): SerializedBoardState {
    const cardEntities = world.query('cardData', 'transform', 'stackNode');
    const entityToGuid = new Map<number, string>();

    // 1. Map all entity IDs to their instance GUIDs
    for (const entityId of cardEntities) {
      const cardData = world.getComponent(entityId, 'cardData') as CardDataComponent;
      entityToGuid.set(entityId, cardData.instanceGuid);
    }

    // 2. Serialize all cards
    const serializedCards: SerializedCard[] = [];
    for (const entityId of cardEntities) {
      const cardData = world.getComponent(entityId, 'cardData') as CardDataComponent;
      const transform = world.getComponent(entityId, 'transform') as TransformComponent;
      const stackNode = world.getComponent(entityId, 'stackNode') as StackNodeComponent;
      const combatant = world.getComponent(entityId, 'combatant') as CombatantComponent | undefined;
      const packState = world.getComponent(entityId, 'packState') as PackStateComponent | undefined;

      const parentGuid = stackNode.parentId !== null ? entityToGuid.get(stackNode.parentId) ?? null : null;
      const childGuid = stackNode.childId !== null ? entityToGuid.get(stackNode.childId) ?? null : null;
      const stackRootGuid = entityToGuid.get(stackNode.stackRootId) ?? cardData.instanceGuid;

      const card: SerializedCard = {
        guid: cardData.instanceGuid,
        defId: cardData.id,
        nameTerm: cardData.nameTerm,
        descriptionTerm: cardData.descriptionTerm,
        type: cardData.type,
        value: cardData.value,
        cardLimitCost: cardData.cardLimitCost,
        dynamicProperties: { ...cardData.dynamicProperties },
        visualOverrides: cardData.visualOverrides ? { ...cardData.visualOverrides } : undefined,
        transform: {
          x: transform.x,
          y: transform.y,
          vx: transform.vx,
          vy: transform.vy,
          elevation: transform.elevation,
          zIndex: transform.zIndex,
        },
        stackNode: {
          parentGuid,
          childGuid,
          stackRootGuid,
          stackIndex: stackNode.stackIndex,
        },
      };

      if (combatant) {
        card.combatant = { ...combatant };
      }
      if (packState) {
        card.packState = { ...packState };
      }

      serializedCards.push(card);
    }

    // 3. Serialize active crafting operations
    const craftingEntities = world.query('crafting');
    const serializedCrafting: SerializedCrafting[] = [];
    for (const rootId of craftingEntities) {
      const craft = world.getComponent(rootId, 'crafting') as CraftingComponent;
      const rootGuid = entityToGuid.get(rootId);
      if (!rootGuid) continue;

      const inputGuids: string[] = [];
      for (const inputId of craft.inputEntityIds) {
        const guid = entityToGuid.get(inputId);
        if (guid) inputGuids.push(guid);
      }

      const duration = craft.duration > 0 ? craft.duration : 1;
      const normalized = Math.min(1, Math.max(0, craft.progress / duration));

      serializedCrafting.push({
        stackRootGuid: rootGuid,
        recipeId: craft.recipeId,
        subprintIndex: craft.subprintIndex,
        progress: craft.progress,
        duration: craft.duration,
        normalizedProgress: normalized,
        statusTerm: craft.statusTerm,
        inputGuids,
        consumedMap: [...craft.consumedMap],
      });
    }

    return {
      version: this.CURRENT_VERSION,
      engineVersion: this.ENGINE_VERSION,
      timestamp: Date.now(),
      moon: simLoop.moonSystem.getState(),
      packManager: packManager.getState(),
      cards: serializedCards,
      crafting: serializedCrafting,
    };
  }

  /**
   * Deserializes a full board state back into the simulation world.
   */
  static deserialize(
    state: SerializedBoardState,
    world: World,
    simLoop: SimLoop,
    packManager: PackManager,
    _registry: CardRegistry = globalCardRegistry
  ): Map<string, number> {
    // 1. Clear existing cards cleanly from the world
    const existingCardEntities = Array.from(world.query('cardData'));
    for (const entityId of existingCardEntities) {
      const cardData = world.getComponent(entityId, 'cardData');
      world.destroyEntity(entityId);
      globalEventBus.emit('OnCardDestroyed', {
        entityId,
        cardDefId: cardData?.id ?? 'unknown',
      });
    }

    // 2. Instantiate all card entities
    const guidToEntityId = new Map<string, number>();

    for (const card of state.cards) {
      const entityId = world.createEntity();
      guidToEntityId.set(card.guid, entityId);

      const cardData: CardDataComponent = {
        id: card.defId,
        instanceGuid: card.guid,
        nameTerm: card.nameTerm,
        descriptionTerm: card.descriptionTerm || '',
        type: card.type,
        value: card.value,
        cardLimitCost: card.cardLimitCost,
        dynamicProperties: card.dynamicProperties || {},
        visualOverrides: card.visualOverrides,
      };
      world.addComponent(entityId, 'cardData', cardData);

      world.addComponent(entityId, 'transform', {
        x: card.transform.x,
        y: card.transform.y,
        vx: card.transform.vx,
        vy: card.transform.vy,
        elevation: card.transform.elevation,
        zIndex: card.transform.zIndex,
      });

      world.addComponent(entityId, 'physical', {
        width: 80,
        height: 110,
        mass: 1.0,
        clearanceRadius: 95,
        isPinned: false,
      });

      world.addComponent(entityId, 'draggable', {
        isDragging: false,
        dragStartX: 0,
        dragStartY: 0,
        pointerOffsetX: 0,
        pointerOffsetY: 0,
      });

      if (card.combatant) {
        world.addComponent(entityId, 'combatant', { ...card.combatant });
      }

      if (card.packState) {
        world.addComponent(entityId, 'packState', { ...card.packState });
      }
    }

    // 3. Reconstruct stack topology linkages
    for (const card of state.cards) {
      const entityId = guidToEntityId.get(card.guid)!;
      const parentId = card.stackNode.parentGuid ? guidToEntityId.get(card.stackNode.parentGuid) ?? null : null;
      const childId = card.stackNode.childGuid ? guidToEntityId.get(card.stackNode.childGuid) ?? null : null;
      const stackRootId = guidToEntityId.get(card.stackNode.stackRootGuid) ?? entityId;

      world.addComponent(entityId, 'stackNode', {
        parentId,
        childId,
        stackRootId,
        stackIndex: card.stackNode.stackIndex,
      });
    }

    // 4. Reconstruct crafting state
    for (const craft of state.crafting) {
      const rootEntityId = guidToEntityId.get(craft.stackRootGuid);
      if (rootEntityId === undefined) continue;

      const inputEntityIds = craft.inputGuids
        .map((g) => guidToEntityId.get(g))
        .filter((id): id is number => id !== undefined);

      const craftingComp: CraftingComponent = {
        recipeId: craft.recipeId,
        subprintIndex: craft.subprintIndex,
        progress: craft.progress,
        duration: craft.duration,
        statusTerm: craft.statusTerm,
        inputEntityIds,
        consumedMap: [...craft.consumedMap],
      };
      world.addComponent(rootEntityId, 'crafting', craftingComp);

      globalEventBus.emit('OnRecipeProgress', {
        stackRootId: rootEntityId,
        progress: craft.progress,
        duration: craft.duration,
      });
    }

    // 5. Restore Moon & Pack Systems
    if (state.moon) {
      simLoop.moonSystem.restoreState(state.moon);
    }
    if (state.packManager) {
      packManager.restoreState(state.packManager);
    }

    // 6. Emit OnCardSpawned for all newly instantiated cards so View layer renders them
    for (const card of state.cards) {
      const entityId = guidToEntityId.get(card.guid)!;
      globalEventBus.emit('OnCardSpawned', {
        entityId,
        cardDefId: card.defId,
        x: card.transform.x,
        y: card.transform.y,
      });
    }

    return guidToEntityId;
  }

  /**
   * Saves state to browser LocalStorage.
   */
  static saveToLocalStorage(
    world: World,
    simLoop: SimLoop,
    packManager: PackManager,
    key: string = 'village_card_engine_quicksave'
  ): void {
    const state = this.serialize(world, simLoop, packManager);
    localStorage.setItem(key, JSON.stringify(state));
  }

  /**
   * Loads state from browser LocalStorage.
   */
  static loadFromLocalStorage(
    world: World,
    simLoop: SimLoop,
    packManager: PackManager,
    key: string = 'village_card_engine_quicksave',
    registry: CardRegistry = globalCardRegistry
  ): boolean {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    try {
      const state = JSON.parse(raw) as SerializedBoardState;
      this.deserialize(state, world, simLoop, packManager, registry);
      return true;
    } catch (err) {
      console.error('[SaveManager] Failed to load state from localStorage:', err);
      return false;
    }
  }

  /**
   * Exports the board state as a JSON file download in browser.
   */
  static exportToJsonFile(
    world: World,
    simLoop: SimLoop,
    packManager: PackManager,
    filename: string = `village_save_${Date.now()}.json`
  ): void {
    const state = this.serialize(world, simLoop, packManager);
    const jsonStr = JSON.stringify(state, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
