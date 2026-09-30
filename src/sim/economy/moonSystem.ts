import { World } from '../ecs/world.js';
import { globalEventBus } from '../events.js';
import { CardFactory } from '../cardFactory.js';
import { StackTopology } from '../kinematics/stackTopology.js';
import { CardRegistry, globalCardRegistry } from '../../mods/cardRegistry.js';

export interface MoonConfig {
  moonDurationSeconds: number; // 120s by default
  baseMaxCards: number;        // 20 by default
}

export const DEFAULT_MOON_CONFIG: MoonConfig = {
  moonDurationSeconds: 120,
  baseMaxCards: 20,
};

export class MoonSystem {
  private world: World;
  private config: MoonConfig;
  private registry: CardRegistry;
  private moonNumber: number = 1;
  private timeRemaining: number;
  private isFeedingPhase: boolean = false;
  private isCapacityExceeded: boolean = false;

  constructor(
    world: World,
    config: MoonConfig = DEFAULT_MOON_CONFIG,
    registry: CardRegistry = globalCardRegistry
  ) {
    this.world = world;
    this.config = config;
    this.registry = registry;
    this.timeRemaining = config.moonDurationSeconds;
  }

  getMoonNumber(): number {
    return this.moonNumber;
  }

  getTimeRemaining(): number {
    return this.timeRemaining;
  }

  isFeeding(): boolean {
    return this.isFeedingPhase;
  }

  getMoonProgress(): number {
    return (this.config.moonDurationSeconds - this.timeRemaining) / this.config.moonDurationSeconds;
  }

  getMaxCards(): number {
    // Can be expanded by structures (e.g. sheds/houses)
    let maxCards = this.config.baseMaxCards;
    const cards = this.world.query('cardData');
    for (const id of cards) {
      const card = this.world.getComponent(id, 'cardData')!;
      if (card.dynamicProperties._ExtraCardLimit) {
        maxCards += Number(card.dynamicProperties._ExtraCardLimit);
      }
    }
    return maxCards;
  }

  getTotalCardCount(): number {
    const cards = this.world.query('cardData');
    let total = 0;
    for (const id of cards) {
      const card = this.world.getComponent(id, 'cardData')!;
      total += card.cardLimitCost ?? 1;
    }
    return total;
  }

  isOverCapacity(): boolean {
    return this.getTotalCardCount() > this.getMaxCards();
  }

  update(dt: number): void {
    // Check if board is over capacity
    this.isCapacityExceeded = this.isOverCapacity();
    if (this.isCapacityExceeded) {
      // Game progression paused until player cleans up cards
      return;
    }

    this.timeRemaining -= dt;

    if (this.timeRemaining <= 0) {
      this.resolveMoonEnd();
    } else {
      globalEventBus.emit('OnMoonPhaseChanged', {
        moonNumber: this.moonNumber,
        timeRemaining: this.timeRemaining,
        isFeeding: false,
      });
    }
  }

  /**
   * Resolves the Sustenance & Feeding Phase at the conclusion of a Moon cycle.
   */
  resolveMoonEnd(): { fedWorkers: number; starvedWorkers: number } {
    this.isFeedingPhase = true;

    // 1. Demand Aggregation: iterate over all active workers
    const allCards = this.world.query('cardData', 'transform');
    const workerEntities: number[] = [];
    let totalDemand = 0;

    for (const id of allCards) {
      const card = this.world.getComponent(id, 'cardData')!;
      if (card.type === 'Worker') {
        workerEntities.push(id);
        const demand = card.dynamicProperties._FoodDemand ?? 1;
        totalDemand += demand;
      }
    }

    // 2. Resource Scavenging: locate all food cards
    const foodCards: Array<{ entityId: number; foodValue: number }> = [];
    for (const id of allCards) {
      const card = this.world.getComponent(id, 'cardData')!;
      if (card.type === 'Food') {
        const val = card.dynamicProperties._FoodValue ?? 1;
        foodCards.push({ entityId: id, foodValue: val });
      }
    }

    // Sort food cards descending by food value (greedy selection minimizing waste)
    foodCards.sort((a, b) => b.foodValue - a.foodValue);

    // 3. Nutrition Resolution
    let foodAvailable = foodCards.reduce((acc, f) => acc + f.foodValue, 0);
    let foodAllocated = 0;
    const consumedFoodEntities: number[] = [];

    for (const f of foodCards) {
      if (foodAllocated < totalDemand) {
        foodAllocated += f.foodValue;
        consumedFoodEntities.push(f.entityId);
      }
    }

    // Destroy consumed food cards
    for (const foodId of consumedFoodEntities) {
      StackTopology.extractSubStack(this.world, foodId);
      this.world.destroyEntity(foodId);
      globalEventBus.emit('OnCardDestroyed', { entityId: foodId, cardDefId: 'food' });
    }

    // Determine starvation
    const fedCount = Math.min(workerEntities.length, Math.floor(foodAvailable));
    const starvedCount = Math.max(0, workerEntities.length - fedCount);

    // If workers starve, destroy them and spawn corpses at their coordinates
    if (starvedCount > 0) {
      // Pick unfed workers from the end of the list
      const unfedWorkers = workerEntities.slice(fedCount);
      for (const workerId of unfedWorkers) {
        StackTopology.extractSubStack(this.world, workerId);
        this.world.destroyEntity(workerId);
        globalEventBus.emit('OnCardDestroyed', { entityId: workerId, cardDefId: 'villager' });

        const transform = this.world.getComponent(workerId, 'transform');
        const corpseX = transform ? transform.x : 200;
        const corpseY = transform ? transform.y : 200;

        // Instantiate corpse card
        CardFactory.createFromRegistry(this.world, 'corpse', corpseX, corpseY, this.registry);
      }
    }

    // Advance to next moon
    this.moonNumber++;
    this.timeRemaining = this.config.moonDurationSeconds;
    this.isFeedingPhase = false;

    globalEventBus.emit('OnMoonPhaseChanged', {
      moonNumber: this.moonNumber,
      timeRemaining: this.timeRemaining,
      isFeeding: true,
    });

    return {
      fedWorkers: fedCount,
      starvedWorkers: starvedCount,
    };
  }

  reset(moonDurationSeconds?: number): void {
    if (moonDurationSeconds) {
      this.config.moonDurationSeconds = moonDurationSeconds;
    }
    this.moonNumber = 1;
    this.timeRemaining = this.config.moonDurationSeconds;
    this.isFeedingPhase = false;
  }

  getState(): { moonNumber: number; timeRemaining: number; isFeedingPhase: boolean } {
    return {
      moonNumber: this.moonNumber,
      timeRemaining: this.timeRemaining,
      isFeedingPhase: this.isFeedingPhase,
    };
  }

  restoreState(state: { moonNumber: number; timeRemaining: number; isFeedingPhase?: boolean }): void {
    this.moonNumber = state.moonNumber;
    this.timeRemaining = state.timeRemaining;
    this.isFeedingPhase = state.isFeedingPhase ?? false;
    globalEventBus.emit('OnMoonPhaseChanged', {
      moonNumber: this.moonNumber,
      timeRemaining: this.timeRemaining,
      isFeeding: this.isFeedingPhase,
    });
  }
}
