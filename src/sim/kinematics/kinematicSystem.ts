import { World } from '../ecs/world.js';
import { StackNodeComponent } from '../ecs/components.js';
import { calculateRepulsionImpulse, DEFAULT_REPULSION_CONFIG } from './repulsion.js';

export const STACK_VERTICAL_OFFSET = 24; // Pixel offset per stacked card

export class KinematicSystem {
  static update(world: World, dt: number): void {
    const cardEntities = world.query('transform', 'stackNode', 'physical');

    // 1. First, identify stack roots and update dragged entities
    const stackRoots: number[] = [];

    for (const entityId of cardEntities) {
      const node = world.getComponent(entityId, 'stackNode')!;
      const transform = world.getComponent(entityId, 'transform')!;
      const draggable = world.getComponent(entityId, 'draggable');

      // Check if this entity is a stack root (no parent)
      if (node.parentId === null) {
        stackRoots.push(entityId);
      }

      // If being dragged, zero out physics velocity
      if (draggable && draggable.isDragging) {
        transform.vx = 0;
        transform.vy = 0;
      }
    }

    // 2. Apply spring-damper repulsion between independent stack roots
    for (let i = 0; i < stackRoots.length; i++) {
      const entityA = stackRoots[i];
      const transformA = world.getComponent(entityA, 'transform')!;
      const physicalA = world.getComponent(entityA, 'physical')!;
      const draggableA = world.getComponent(entityA, 'draggable');

      // Pinned or currently dragged roots do not receive repulsion displacement
      if (physicalA.isPinned || (draggableA && draggableA.isDragging)) {
        continue;
      }

      let netForceX = 0;
      let netForceY = 0;

      for (let j = 0; j < stackRoots.length; j++) {
        if (i === j) continue;
        const entityB = stackRoots[j];
        const draggableB = world.getComponent(entityB, 'draggable');
        const physicalB = world.getComponent(entityB, 'physical');

        // Dragged or pinned cards are elevated or static and do not exert repulsion on board cards
        if ((draggableB && draggableB.isDragging) || (physicalB && physicalB.isPinned)) {
          continue;
        }

        const transformB = world.getComponent(entityB, 'transform')!;

        const impulse = calculateRepulsionImpulse(
          { x: transformA.x, y: transformA.y },
          { x: transformB.x, y: transformB.y },
          { x: transformA.vx, y: transformA.vy },
          { x: transformB.vx, y: transformB.vy },
          DEFAULT_REPULSION_CONFIG
        );

        netForceX += impulse.x;
        netForceY += impulse.y;
      }

      // Acceleration: a = F / m
      const mass = Math.max(0.1, physicalA.mass);
      transformA.vx += (netForceX / mass) * dt;
      transformA.vy += (netForceY / mass) * dt;

      // Natural tabletop friction
      const friction = Math.exp(-6.0 * dt);
      transformA.vx *= friction;
      transformA.vy *= friction;

      // Stop jitter at small velocities
      if (Math.abs(transformA.vx) < 0.5) transformA.vx = 0;
      if (Math.abs(transformA.vy) < 0.5) transformA.vy = 0;

      transformA.x += transformA.vx * dt;
      transformA.y += transformA.vy * dt;
    }

    // 3. Propagate stack positions downwards from each root to its children
    for (const rootId of stackRoots) {
      const rootTransform = world.getComponent(rootId, 'transform')!;
      let currentId: number | null = rootId;
      let depth = 0;

      while (currentId !== null) {
        const node: StackNodeComponent | undefined = world.getComponent(currentId, 'stackNode');
        const transform = world.getComponent(currentId, 'transform');

        if (transform && currentId !== rootId) {
          // Smoothly interpolate or snap child to parent position + stack vertical offset
          const targetX = rootTransform.x;
          const targetY = rootTransform.y + depth * STACK_VERTICAL_OFFSET;

          // Gentle spring follow
          const lerpFactor = Math.min(1.0, 25.0 * dt);
          transform.x += (targetX - transform.x) * lerpFactor;
          transform.y += (targetY - transform.y) * lerpFactor;
          transform.vx = rootTransform.vx;
          transform.vy = rootTransform.vy;
          transform.elevation = depth;
        }

        currentId = node ? node.childId : null;
        depth++;
      }
    }
  }
}
