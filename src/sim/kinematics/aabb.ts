export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function getCardAABB(x: number, y: number, width: number, height: number): AABB {
  const halfW = width / 2;
  const halfH = height / 2;
  return {
    minX: x - halfW,
    minY: y - halfH,
    maxX: x + halfW,
    maxY: y + halfH,
  };
}

export function calculateIntersectionArea(boxA: AABB, boxB: AABB): number {
  const overlapX = Math.max(0, Math.min(boxA.maxX, boxB.maxX) - Math.max(boxA.minX, boxB.minX));
  const overlapY = Math.max(0, Math.min(boxA.maxY, boxB.maxY) - Math.max(boxA.minY, boxB.minY));
  return overlapX * overlapY;
}

export function checkOverlapThreshold(
  boxA: AABB,
  boxB: AABB,
  thresholdRatio: number = 0.5
): boolean {
  const areaA = (boxA.maxX - boxA.minX) * (boxA.maxY - boxA.minY);
  const areaB = (boxB.maxX - boxB.minX) * (boxB.maxY - boxB.minY);
  const smallerArea = Math.min(areaA, areaB);
  if (smallerArea <= 0) return false;

  const intersection = calculateIntersectionArea(boxA, boxB);
  return intersection / smallerArea >= thresholdRatio;
}
