import { ComponentMap, ComponentName } from './components.js';

export class World {
  private nextEntityId: number = 1;
  private entities: Set<number> = new Set();
  private components: Map<ComponentName, Map<number, any>> = new Map();

  constructor() {
    const componentNames: ComponentName[] = [
      'transform',
      'cardData',
      'stackNode',
      'draggable',
      'physical',
      'crafting',
      'packState',
      'combatant'
    ];
    for (const name of componentNames) {
      this.components.set(name, new Map());
    }
  }

  createEntity(): number {
    const id = this.nextEntityId++;
    this.entities.add(id);
    return id;
  }

  destroyEntity(entityId: number): void {
    if (!this.entities.has(entityId)) return;
    for (const store of this.components.values()) {
      store.delete(entityId);
    }
    this.entities.delete(entityId);
  }

  addComponent<K extends ComponentName>(entityId: number, name: K, component: ComponentMap[K]): void {
    if (!this.entities.has(entityId)) {
      throw new Error(`Cannot add component to nonexistent entity ${entityId}`);
    }
    this.components.get(name)?.set(entityId, component);
  }

  removeComponent(entityId: number, name: ComponentName): void {
    this.components.get(name)?.delete(entityId);
  }

  getComponent<K extends ComponentName>(entityId: number, name: K): ComponentMap[K] | undefined {
    return this.components.get(name)?.get(entityId) as ComponentMap[K] | undefined;
  }

  hasComponent(entityId: number, name: ComponentName): boolean {
    return this.components.get(name)?.has(entityId) ?? false;
  }

  query(...names: ComponentName[]): number[] {
    if (names.length === 0) return Array.from(this.entities);

    // Pick smallest component map to start intersection
    let smallestMap: Map<number, any> | undefined;
    let minSize = Infinity;

    for (const name of names) {
      const store = this.components.get(name);
      if (!store || store.size === 0) return [];
      if (store.size < minSize) {
        minSize = store.size;
        smallestMap = store;
      }
    }

    if (!smallestMap) return [];

    const result: number[] = [];
    for (const entityId of smallestMap.keys()) {
      let hasAll = true;
      for (const name of names) {
        if (!this.components.get(name)?.has(entityId)) {
          hasAll = false;
          break;
        }
      }
      if (hasAll) {
        result.push(entityId);
      }
    }

    return result;
  }

  getAllEntities(): number[] {
    return Array.from(this.entities);
  }

  clear(): void {
    this.entities.clear();
    for (const store of this.components.values()) {
      store.clear();
    }
    this.nextEntityId = 1;
  }
}
