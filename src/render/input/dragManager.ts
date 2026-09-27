import { World } from '../../sim/ecs/world.js';
import { StackTopology } from '../../sim/kinematics/stackTopology.js';
import { getCardAABB, checkOverlapThreshold } from '../../sim/kinematics/aabb.js';
import { STACK_VERTICAL_OFFSET } from '../../sim/kinematics/kinematicSystem.js';

export class DragManager {
  private world: World;
  private draggedEntityId: number | null = null;
  private draggedSubtree: number[] = [];
  private pointerOffsetX: number = 0;
  private pointerOffsetY: number = 0;

  constructor(world: World) {
    this.world = world;
  }

  public isDragging(): boolean {
    return this.draggedEntityId !== null;
  }

  public getDraggedSubtree(): number[] {
    return this.draggedSubtree;
  }

  public startDrag(entityId: number, pointerWorldX: number, pointerWorldY: number): void {
    const transform = this.world.getComponent(entityId, 'transform');
    if (!transform) return;

    // Extract sub-stack from parent if part of a stack
    this.draggedSubtree = StackTopology.extractSubStack(this.world, entityId);
    this.draggedEntityId = entityId;

    this.pointerOffsetX = transform.x - pointerWorldX;
    this.pointerOffsetY = transform.y - pointerWorldY;

    // Flag all cards in sub-stack as dragging
    for (let i = 0; i < this.draggedSubtree.length; i++) {
      const id = this.draggedSubtree[i];
      const draggable = this.world.getComponent(id, 'draggable');
      const cardTransform = this.world.getComponent(id, 'transform');
      if (draggable) draggable.isDragging = true;
      if (cardTransform) {
        cardTransform.elevation = 10 + i;
        cardTransform.zIndex = 1000 + i;
      }
    }
  }

  public onPointerMove(pointerWorldX: number, pointerWorldY: number): void {
    if (this.draggedEntityId === null) return;

    const rootTransform = this.world.getComponent(this.draggedEntityId, 'transform');
    if (!rootTransform) return;

    rootTransform.x = pointerWorldX + this.pointerOffsetX;
    rootTransform.y = pointerWorldY + this.pointerOffsetY;

    // Instantly cascade dragged children with root for responsive feel
    for (let i = 1; i < this.draggedSubtree.length; i++) {
      const childId = this.draggedSubtree[i];
      const childTransform = this.world.getComponent(childId, 'transform');
      if (childTransform) {
        childTransform.x = rootTransform.x;
        childTransform.y = rootTransform.y + i * STACK_VERTICAL_OFFSET;
      }
    }
  }

  public endDrag(): { attached: boolean; targetId: number | null } {
    if (this.draggedEntityId === null) {
      return { attached: false, targetId: null };
    }

    const draggedRoot = this.draggedEntityId;
    const rootTransform = this.world.getComponent(draggedRoot, 'transform');
    const rootPhysical = this.world.getComponent(draggedRoot, 'physical');

    let attached = false;
    let targetCandidateId: number | null = null;

    if (rootTransform && rootPhysical) {
      const draggedBox = getCardAABB(
        rootTransform.x,
        rootTransform.y,
        rootPhysical.width,
        rootPhysical.height
      );

      const allCards = this.world.query('transform', 'stackNode', 'physical');
      const subtreeSet = new Set(this.draggedSubtree);

      for (const candidateId of allCards) {
        if (subtreeSet.has(candidateId)) continue;

        const candTransform = this.world.getComponent(candidateId, 'transform')!;
        const candPhysical = this.world.getComponent(candidateId, 'physical')!;
        const candBox = getCardAABB(
          candTransform.x,
          candTransform.y,
          candPhysical.width,
          candPhysical.height
        );

        if (checkOverlapThreshold(draggedBox, candBox, 0.45)) {
          // Find terminal leaf of the target candidate's stack
          const candNode = this.world.getComponent(candidateId, 'stackNode')!;
          const terminalLeafId = StackTopology.getStackLeaf(this.world, candNode.stackRootId);

          if (!subtreeSet.has(terminalLeafId)) {
            targetCandidateId = terminalLeafId;
            break;
          }
        }
      }

      if (targetCandidateId !== null) {
        attached = StackTopology.attachSubStack(this.world, targetCandidateId, draggedRoot);
      }
    }

    // Reset dragging flags
    for (const id of this.draggedSubtree) {
      const draggable = this.world.getComponent(id, 'draggable');
      if (draggable) draggable.isDragging = false;
    }

    // Update stack properties if not attached
    if (!attached) {
      StackTopology.updateStackSubtree(this.world, draggedRoot);
    }

    const result = { attached, targetId: targetCandidateId };
    this.draggedEntityId = null;
    this.draggedSubtree = [];

    return result;
  }
}
