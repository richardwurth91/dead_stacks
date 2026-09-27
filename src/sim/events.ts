export type EventCallback<T = any> = (data: T) => void;

export interface StackMutationEvent {
  parentEntityId: number | null;
  childEntityId: number;
  type: 'attached' | 'extracted' | 'reordered';
}

export interface CardMovedEvent {
  entityId: number;
  x: number;
  y: number;
}

export interface CardSpawnedEvent {
  entityId: number;
  cardDefId: string;
  x: number;
  y: number;
}

export interface CardDestroyedEvent {
  entityId: number;
  cardDefId: string;
}

export interface CardDefinitionUpdatedEvent {
  defId: string;
  updatedDef: any;
}

export interface BlueprintRegisteredEvent {
  blueprint: any;
}

export type EngineEventMap = {
  OnStackMutated: StackMutationEvent;
  OnCardMoved: CardMovedEvent;
  OnCardSpawned: CardSpawnedEvent;
  OnCardDestroyed: CardDestroyedEvent;
  OnCardDefinitionUpdated: CardDefinitionUpdatedEvent;
  OnBlueprintRegistered: BlueprintRegisteredEvent;
  OnRecipeProgress: { stackRootId: number; progress: number; duration: number };
  OnRecipeCompleted: { stackRootId: number; recipeId: string };
  OnMoonPhaseChanged: { moonNumber: number; timeRemaining: number; isFeeding: boolean };
  OnCombatRoundResolved: { attackerId: number; targetId: number; damage: number; isCrit: boolean };
};

export class EventBus {
  private listeners: Map<string, Set<EventCallback>> = new Map();

  on<K extends keyof EngineEventMap>(event: K, callback: EventCallback<EngineEventMap[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as EventCallback);
    return () => this.off(event, callback);
  }

  off<K extends keyof EngineEventMap>(event: K, callback: EventCallback<EngineEventMap[K]>): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(callback as EventCallback);
    }
  }

  emit<K extends keyof EngineEventMap>(event: K, data: EngineEventMap[K]): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const callback of set) {
        try {
          callback(data);
        } catch (err) {
          console.error(`Error in event listener for ${event}:`, err);
        }
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const globalEventBus = new EventBus();
