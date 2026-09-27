import { World } from '../ecs/world.js';
import { StackNodeComponent } from '../ecs/components.js';
import { globalEventBus } from '../events.js';

export class StackTopology {
  /**
   * Retrieves all entity IDs in order from the root to the leaf of the stack.
   */
  static getStackArray(world: World, rootEntityId: number): number[] {
    const result: number[] = [];
    let currentId: number | null = rootEntityId;

    while (currentId !== null) {
      result.push(currentId);
      const node: StackNodeComponent | undefined = world.getComponent(currentId, 'stackNode');
      if (!node) break;
      currentId = node.childId;
    }

    return result;
  }

  /**
   * Retrieves the terminal (leaf) card entity ID in a given stack.
   */
  static getStackLeaf(world: World, rootEntityId: number): number {
    let currentId = rootEntityId;
    while (true) {
      const node = world.getComponent(currentId, 'stackNode');
      if (!node || node.childId === null) {
        return currentId;
      }
      currentId = node.childId;
    }
  }

  /**
   * Checks whether attaching childEntityId beneath parentEntityId would create a cyclic graph.
   * Traverses upwards from parentEntityId: if childEntityId is an ancestor, return false.
   */
  static isAcyclic(world: World, parentEntityId: number, childEntityId: number): boolean {
    if (parentEntityId === childEntityId) return false;

    let current: number | null = parentEntityId;
    const visited = new Set<number>();

    while (current !== null) {
      if (current === childEntityId) {
        return false; // Cycle detected
      }
      if (visited.has(current)) {
        return false; // Graph already corrupted with cycle
      }
      visited.add(current);
      const node: StackNodeComponent | undefined = world.getComponent(current, 'stackNode');
      current = node ? node.parentId : null;
    }

    return true;
  }

  /**
   * Attaches a sub-stack starting at childEntityId to the terminal node of the target stack.
   */
  static attachSubStack(world: World, targetStackEntityId: number, childEntityId: number): boolean {
    // Find the terminal node of target stack
    const targetNode = world.getComponent(targetStackEntityId, 'stackNode');
    if (!targetNode) return false;

    const terminalParentId = this.getStackLeaf(world, targetNode.stackRootId);

    // Validate acyclic requirement
    if (!this.isAcyclic(world, terminalParentId, childEntityId)) {
      console.warn(`[StackTopology] Cycle prevented when attempting to attach ${childEntityId} to ${terminalParentId}`);
      return false;
    }

    const parentNode = world.getComponent(terminalParentId, 'stackNode');
    const childNode = world.getComponent(childEntityId, 'stackNode');
    if (!parentNode || !childNode) return false;

    // Connect doubly linked list
    parentNode.childId = childEntityId;
    childNode.parentId = terminalParentId;

    // Propagate root and stack indices down the newly attached subtree
    this.updateStackSubtree(world, terminalParentId);

    globalEventBus.emit('OnStackMutated', {
      parentEntityId: terminalParentId,
      childEntityId: childEntityId,
      type: 'attached',
    });

    return true;
  }

  /**
   * Extracts a card (and any children resting on top of it) from its current stack.
   * Severing the link between parent and this card.
   */
  static extractSubStack(world: World, entityId: number): number[] {
    const node = world.getComponent(entityId, 'stackNode');
    if (!node) return [entityId];

    const oldParentId = node.parentId;
    if (oldParentId !== null) {
      const oldParentNode = world.getComponent(oldParentId, 'stackNode');
      if (oldParentNode) {
        oldParentNode.childId = null;
      }
      node.parentId = null;
    }

    // This entity is now the root of its own sub-stack
    this.updateStackSubtree(world, entityId);

    globalEventBus.emit('OnStackMutated', {
      parentEntityId: oldParentId,
      childEntityId: entityId,
      type: 'extracted',
    });

    return this.getStackArray(world, entityId);
  }

  /**
   * Updates stackRootId, stackIndex, and elevation offsets for a stack or subtree.
   */
  static updateStackSubtree(world: World, startEntityId: number): void {
    const startNode = world.getComponent(startEntityId, 'stackNode');
    if (!startNode) return;

    let rootId = startEntityId;
    let baseIndex = 0;

    if (startNode.parentId !== null) {
      const parentNode = world.getComponent(startNode.parentId, 'stackNode');
      if (parentNode) {
        rootId = parentNode.stackRootId;
        baseIndex = parentNode.stackIndex + 1;
      }
    }

    let currentId: number | null = startEntityId;
    let currentIndex = baseIndex;

    while (currentId !== null) {
      const node: StackNodeComponent | undefined = world.getComponent(currentId, 'stackNode');
      const transform = world.getComponent(currentId, 'transform');

      if (node) {
        node.stackRootId = rootId;
        node.stackIndex = currentIndex;
      }

      if (transform) {
        transform.elevation = currentIndex;
        transform.zIndex = 10 + currentIndex;
      }

      currentId = node ? node.childId : null;
      currentIndex++;
    }
  }
}
