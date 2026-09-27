import { World } from '../ecs/world.js';
import { CardFactory } from '../cardFactory.js';
import { StackTopology } from '../kinematics/stackTopology.js';
import { globalEventBus } from '../events.js';
import { CardRegistry, globalCardRegistry } from '../../mods/cardRegistry.js';

export class SellSystem {
  static canSell(world: World, entityId: number): boolean {
    const cardData = world.getComponent(entityId, 'cardData');
    if (!cardData) return false;
    // Value of -1 designates unsellable items (e.g. Villagers)
    return cardData.value > 0;
  }

  static sellCard(
    world: World,
    entityId: number,
    spawnX: number = 200,
    spawnY: number = 200,
    registry: CardRegistry = globalCardRegistry
  ): number {
    if (!this.canSell(world, entityId)) return 0;

    const cardData = world.getComponent(entityId, 'cardData')!;
    const coinsToSpawn = cardData.value;

    // Sever links and destroy card
    StackTopology.extractSubStack(world, entityId);
    world.destroyEntity(entityId);
    globalEventBus.emit('OnCardDestroyed', { entityId, cardDefId: cardData.id });

    // Spawn gold coins
    for (let i = 0; i < coinsToSpawn; i++) {
      CardFactory.createFromRegistry(world, 'coin', spawnX + i * 15, spawnY + i * 15, registry);
    }

    return coinsToSpawn;
  }
}
