import { World } from '../ecs/world.js';
import { CardRegistry, globalCardRegistry } from '../../mods/cardRegistry.js';
import { StackTopology } from '../kinematics/stackTopology.js';
import { CardFactory } from '../cardFactory.js';
import { getArchimedeanSpiralOffsets } from '../kinematics/repulsion.js';
import { globalEventBus } from '../events.js';

export class PackManager {
  private world: World;
  private registry: CardRegistry;
  private pityTrackers: Map<string, Map<string, number>> = new Map(); // packId -> (cardId -> failStreak)
  private unlockedBlueprints: Set<string> = new Set();

  constructor(world: World, registry: CardRegistry = globalCardRegistry) {
    this.world = world;
    this.registry = registry;
  }

  unlockBlueprint(blueprintId: string): void {
    this.unlockedBlueprints.add(blueprintId);
  }

  isBlueprintUnlocked(blueprintId: string): boolean {
    return this.unlockedBlueprints.has(blueprintId);
  }

  getPityStreak(packId: string, cardId: string): number {
    return this.pityTrackers.get(packId)?.get(cardId) ?? 0;
  }

  /**
   * Checks if a pack stack has accumulated enough coins to open.
   */
  canOpenPack(stackRootId: number): boolean {
    const rootCard = this.world.getComponent(stackRootId, 'cardData');
    if (!rootCard || rootCard.type !== 'Pack') return false;

    const packDef = this.registry.getPack(rootCard.id);
    if (!packDef) return false;

    const stack = StackTopology.getStackArray(this.world, stackRootId);
    let coinCount = 0;

    for (let i = 1; i < stack.length; i++) {
      const childCard = this.world.getComponent(stack[i], 'cardData');
      if (childCard && childCard.type === 'Coin') {
        coinCount += childCard.value ?? 1;
      }
    }

    return coinCount >= packDef.cost;
  }

  /**
   * Opens a pack: consumes stacked coins, destroys the pack, draws cards via weighted pity algorithm,
   * and ejects cards outward onto the tabletop.
   */
  openPack(stackRootId: number): string[] {
    const rootCard = this.world.getComponent(stackRootId, 'cardData')!;
    const packDef = this.registry.getPack(rootCard.id)!;
    const rootTransform = this.world.getComponent(stackRootId, 'transform')!;

    const originX = rootTransform.x;
    const originY = rootTransform.y;

    // 1. Consume required coins from stack
    const stack = StackTopology.getStackArray(this.world, stackRootId);
    let coinsNeeded = packDef.cost;
    const coinsToDestroy: number[] = [];

    for (let i = 1; i < stack.length; i++) {
      const childCard = this.world.getComponent(stack[i], 'cardData');
      if (childCard && childCard.type === 'Coin' && coinsNeeded > 0) {
        coinsToDestroy.push(stack[i]);
        coinsNeeded -= (childCard.value ?? 1);
      }
    }

    for (const coinId of coinsToDestroy) {
      StackTopology.extractSubStack(this.world, coinId);
      this.world.destroyEntity(coinId);
      globalEventBus.emit('OnCardDestroyed', { entityId: coinId, cardDefId: 'coin' });
    }

    // 2. Compute dynamic drop weights with anti-frustration pity modifiers
    if (!this.pityTrackers.has(packDef.id)) {
      this.pityTrackers.set(packDef.id, new Map());
    }
    const packPity = this.pityTrackers.get(packDef.id)!;

    const modifiedPool = packDef.dropPool.map((entry) => {
      let dynamicModifier = 0;

      // Filter already unlocked blueprints
      if (entry.id.startsWith('blueprint_') && this.unlockedBlueprints.has(entry.id)) {
        return { id: entry.id, weight: 0 };
      }

      // Check guarantee/pity rules
      const rule = packDef.guaranteeRules?.find((r) => r.cardId === entry.id);
      if (rule) {
        const streak = packPity.get(entry.id) ?? 0;
        if (streak >= rule.afterPacks) {
          dynamicModifier = 1000; // Guaranteed acquisition
        } else {
          dynamicModifier = streak * 15; // Scaled upward
        }
      }

      return {
        id: entry.id,
        weight: entry.weight + dynamicModifier,
      };
    });

    // 3. Draw cardsPerPack items using cumulative weighted selection
    const drawnCardIds: string[] = [];
    for (let d = 0; d < packDef.cardsPerPack; d++) {
      const totalWeight = modifiedPool.reduce((sum, item) => sum + item.weight, 0);
      if (totalWeight <= 0) break;

      let roll = Math.random() * totalWeight;
      for (const item of modifiedPool) {
        roll -= item.weight;
        if (roll <= 0) {
          drawnCardIds.push(item.id);
          break;
        }
      }
    }

    // Update pity streaks
    if (packDef.guaranteeRules) {
      for (const rule of packDef.guaranteeRules) {
        if (drawnCardIds.includes(rule.cardId)) {
          packPity.set(rule.cardId, 0); // Reset pity
        } else {
          const currentStreak = packPity.get(rule.cardId) ?? 0;
          packPity.set(rule.cardId, currentStreak + 1);
        }
      }
    }

    // 4. Destroy pack card
    StackTopology.extractSubStack(this.world, stackRootId);
    this.world.destroyEntity(stackRootId);
    globalEventBus.emit('OnCardDestroyed', { entityId: stackRootId, cardDefId: packDef.id });

    // 5. Eject spawned cards across tabletop with Archimedean spiral dispersal
    const offsets = getArchimedeanSpiralOffsets(drawnCardIds.length, 90, 20);
    for (let i = 0; i < drawnCardIds.length; i++) {
      const cardDefId = drawnCardIds[i];
      const offset = offsets[i] || { x: 0, y: 0 };
      CardFactory.createFromRegistry(
        this.world,
        cardDefId,
        originX + offset.x,
        originY + offset.y,
        this.registry
      );
    }

    return drawnCardIds;
  }

  getState(): { pityTrackers: Record<string, Record<string, number>>; unlockedBlueprints: string[] } {
    const serializedPity: Record<string, Record<string, number>> = {};
    for (const [packId, cardMap] of this.pityTrackers.entries()) {
      serializedPity[packId] = Object.fromEntries(cardMap.entries());
    }
    return {
      pityTrackers: serializedPity,
      unlockedBlueprints: Array.from(this.unlockedBlueprints),
    };
  }

  restoreState(state: { pityTrackers?: Record<string, Record<string, number>>; unlockedBlueprints?: string[] }): void {
    if (state.pityTrackers) {
      this.pityTrackers.clear();
      for (const [packId, cardMap] of Object.entries(state.pityTrackers)) {
        this.pityTrackers.set(packId, new Map(Object.entries(cardMap)));
      }
    }
    if (state.unlockedBlueprints) {
      this.unlockedBlueprints = new Set(state.unlockedBlueprints);
    }
  }
}
