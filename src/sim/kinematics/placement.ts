import { World } from '../ecs/world.js';
import { TransformComponent, StackNodeComponent } from '../ecs/components.js';

export interface PlacementOptions {
  clearanceRadius?: number;
  maxRadius?: number;
  stepAngle?: number;
  radialGrowth?: number;
}

/**
 * Searches for an unoccupied tabletop coordinate starting from (preferredX, preferredY)
 * using an Archimedean spiral raycast sweep. Ensures newly spawned cards do not land directly
 * on top of existing cards or stacks unless intentional.
 */
export function findUnoccupiedPosition(
  world: World,
  preferredX: number,
  preferredY: number,
  options: PlacementOptions = {}
): { x: number; y: number } {
  const clearance = options.clearanceRadius ?? 95;
  const maxRadius = options.maxRadius ?? 600;
  const stepAngle = options.stepAngle ?? (Math.PI / 8); // 22.5 deg steps
  const radialGrowth = options.radialGrowth ?? 25;

  const cardEntities = world.query('transform', 'stackNode');
  const existingPositions: { x: number; y: number }[] = [];

  for (const id of cardEntities) {
    const stackNode = world.getComponent(id, 'stackNode') as StackNodeComponent;
    // Only test against stack roots or independent cards
    if (stackNode.parentId === null) {
      const transform = world.getComponent(id, 'transform') as TransformComponent;
      if (transform) {
        existingPositions.push({ x: transform.x, y: transform.y });
      }
    }
  }

  // Quick check if preferred position is already clear
  const isClear = (x: number, y: number): boolean => {
    for (const pos of existingPositions) {
      const dx = x - pos.x;
      const dy = y - pos.y;
      if (Math.hypot(dx, dy) < clearance) {
        return false;
      }
    }
    return true;
  };

  if (isClear(preferredX, preferredY)) {
    return { x: preferredX, y: preferredY };
  }

  // Archimedean spiral scan: r = radialGrowth * theta
  let theta = 0;
  let radius = 0;

  while (radius <= maxRadius) {
    theta += stepAngle;
    radius = (radialGrowth * theta) / (2 * Math.PI);

    const candidateX = preferredX + radius * Math.cos(theta);
    const candidateY = preferredY + radius * Math.sin(theta);

    if (isClear(candidateX, candidateY)) {
      return { x: candidateX, y: candidateY };
    }
  }

  // If table is exceptionally crowded, return preferred position with a slight jitter
  return {
    x: preferredX + (Math.random() * 40 - 20),
    y: preferredY + (Math.random() * 40 - 20),
  };
}
