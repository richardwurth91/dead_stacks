export interface RepulsionConfig {
  springStiffness: number;  // k_s (e.g., 250)
  dampingCoefficient: number; // c_d (e.g., 20)
  clearanceRadius: number;   // r_clear (e.g., 90px)
  maxImpulse: number;        // Maximum impulse clamp (e.g., 1000)
}

export const DEFAULT_REPULSION_CONFIG: RepulsionConfig = {
  springStiffness: 280,
  dampingCoefficient: 22,
  clearanceRadius: 95,
  maxImpulse: 1200,
};

export interface Vector2D {
  x: number;
  y: number;
}

export function calculateRepulsionImpulse(
  posA: Vector2D,
  posB: Vector2D,
  velA: Vector2D,
  velB: Vector2D,
  config: RepulsionConfig = DEFAULT_REPULSION_CONFIG
): Vector2D {
  const dx = posA.x - posB.x;
  const dy = posA.y - posB.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // If cards are exactly co-located or beyond clearance radius, return 0 or small jitter
  if (dist >= config.clearanceRadius) {
    return { x: 0, y: 0 };
  }

  // Handle exact overlap with a deterministic micro-offset to prevent NaN
  const nx = dist === 0 ? 0.7071 : dx / dist;
  const ny = dist === 0 ? 0.7071 : dy / dist;

  // Spring compression distance (negative since distance is less than clearance)
  const compression = dist - config.clearanceRadius;
  const springForceMagnitude = -config.springStiffness * compression;

  // Relative velocity damping
  const relVelX = velA.x - velB.x;
  const relVelY = velA.y - velB.y;
  const dampingForceX = -config.dampingCoefficient * relVelX;
  const dampingForceY = -config.dampingCoefficient * relVelY;

  // Total force vector
  let totalFx = springForceMagnitude * nx + dampingForceX;
  let totalFy = springForceMagnitude * ny + dampingForceY;

  // Clamp maximum impulse
  const forceMagnitude = Math.sqrt(totalFx * totalFx + totalFy * totalFy);
  if (forceMagnitude > config.maxImpulse) {
    const scale = config.maxImpulse / forceMagnitude;
    totalFx *= scale;
    totalFy *= scale;
  }

  return { x: totalFx, y: totalFy };
}

/**
 * Calculates Archimedean spiral coordinates when spawning many cards simultaneously,
 * preventing clumping explosions.
 * r = b * theta
 */
export function getArchimedeanSpiralOffsets(
  count: number,
  spacing: number = 75,
  bCoefficient: number = 18
): Vector2D[] {
  const offsets: Vector2D[] = [];
  const goldenAngle = 2.399963; // ~137.5 degrees in radians

  for (let i = 0; i < count; i++) {
    if (i === 0) {
      offsets.push({ x: 0, y: 0 });
      continue;
    }
    const theta = i * goldenAngle;
    const r = spacing + bCoefficient * Math.sqrt(i);
    offsets.push({
      x: r * Math.cos(theta),
      y: r * Math.sin(theta),
    });
  }

  return offsets;
}
