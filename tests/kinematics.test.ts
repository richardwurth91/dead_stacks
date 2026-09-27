import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/sim/ecs/world.js';
import { CardFactory } from '../src/sim/cardFactory.js';
import { StackTopology } from '../src/sim/kinematics/stackTopology.js';
import { getCardAABB, checkOverlapThreshold } from '../src/sim/kinematics/aabb.js';
import { calculateRepulsionImpulse, getArchimedeanSpiralOffsets } from '../src/sim/kinematics/repulsion.js';
import { SimLoop } from '../src/sim/loop/simLoop.js';

describe('Phase 1: Tabletop Kinematics & ECS Core', () => {
  let world: World;

  beforeEach(() => {
    world = new World();
  });

  describe('Stack Topology (Doubly Linked List)', () => {
    it('should correctly attach cards into a vertical stack', () => {
      const cardA = CardFactory.createCard(world, {
        defId: 'villager',
        nameTerm: 'Villager',
        type: 'Worker',
        x: 100,
        y: 100,
      });

      const cardB = CardFactory.createCard(world, {
        defId: 'wood',
        nameTerm: 'Wood',
        type: 'Resource',
        x: 100,
        y: 100,
      });

      const cardC = CardFactory.createCard(world, {
        defId: 'berry',
        nameTerm: 'Berry',
        type: 'Food',
        x: 100,
        y: 100,
      });

      // Attach B to A
      const attachedB = StackTopology.attachSubStack(world, cardA, cardB);
      expect(attachedB).toBe(true);

      // Attach C to the stack (attaching to A should find leaf B)
      const attachedC = StackTopology.attachSubStack(world, cardA, cardC);
      expect(attachedC).toBe(true);

      const stackArray = StackTopology.getStackArray(world, cardA);
      expect(stackArray).toEqual([cardA, cardB, cardC]);

      // Check parent/child references
      const nodeA = world.getComponent(cardA, 'stackNode')!;
      const nodeB = world.getComponent(cardB, 'stackNode')!;
      const nodeC = world.getComponent(cardC, 'stackNode')!;

      expect(nodeA.parentId).toBeNull();
      expect(nodeA.childId).toBe(cardB);
      expect(nodeA.stackIndex).toBe(0);

      expect(nodeB.parentId).toBe(cardA);
      expect(nodeB.childId).toBe(cardC);
      expect(nodeB.stackIndex).toBe(1);

      expect(nodeC.parentId).toBe(cardB);
      expect(nodeC.childId).toBeNull();
      expect(nodeC.stackIndex).toBe(2);
    });

    it('should extract a sub-stack cleanly without corrupting parent stack', () => {
      const cardA = CardFactory.createCard(world, { defId: 'a', nameTerm: 'A', type: 'Worker', x: 0, y: 0 });
      const cardB = CardFactory.createCard(world, { defId: 'b', nameTerm: 'B', type: 'Worker', x: 0, y: 0 });
      const cardC = CardFactory.createCard(world, { defId: 'c', nameTerm: 'C', type: 'Worker', x: 0, y: 0 });

      StackTopology.attachSubStack(world, cardA, cardB);
      StackTopology.attachSubStack(world, cardB, cardC);

      // Extract B (along with C) from A
      const extracted = StackTopology.extractSubStack(world, cardB);
      expect(extracted).toEqual([cardB, cardC]);

      // A should now be an independent card
      const nodeA = world.getComponent(cardA, 'stackNode')!;
      expect(nodeA.childId).toBeNull();
      expect(StackTopology.getStackArray(world, cardA)).toEqual([cardA]);

      // B and C should form a new valid stack
      const nodeB = world.getComponent(cardB, 'stackNode')!;
      expect(nodeB.parentId).toBeNull();
      expect(nodeB.childId).toBe(cardC);
      expect(nodeB.stackRootId).toBe(cardB);
      expect(nodeB.stackIndex).toBe(0);

      const nodeC = world.getComponent(cardC, 'stackNode')!;
      expect(nodeC.parentId).toBe(cardB);
      expect(nodeC.stackRootId).toBe(cardB);
      expect(nodeC.stackIndex).toBe(1);
    });

    it('should prevent cyclic dependency loops (u -> v -> u)', () => {
      const cardA = CardFactory.createCard(world, { defId: 'a', nameTerm: 'A', type: 'Worker', x: 0, y: 0 });
      const cardB = CardFactory.createCard(world, { defId: 'b', nameTerm: 'B', type: 'Worker', x: 0, y: 0 });

      StackTopology.attachSubStack(world, cardA, cardB); // A -> B

      // Attempting to attach A beneath B would create cycle
      const cycleAttempt = StackTopology.attachSubStack(world, cardB, cardA);
      expect(cycleAttempt).toBe(false);

      // Verify hierarchy wasn't corrupted
      expect(StackTopology.getStackArray(world, cardA)).toEqual([cardA, cardB]);
    });
  });

  describe('AABB & Overlap Calculation', () => {
    it('should detect 50% overlap between cards', () => {
      const boxA = getCardAABB(100, 100, 80, 110);
      // Box B placed with significant overlap
      const boxB = getCardAABB(110, 110, 80, 110);

      const isOverlapping = checkOverlapThreshold(boxA, boxB, 0.5);
      expect(isOverlapping).toBe(true);

      // Box C placed far away
      const boxC = getCardAABB(300, 300, 80, 110);
      expect(checkOverlapThreshold(boxA, boxC, 0.5)).toBe(false);
    });
  });

  describe('Repulsion Physics & Archimedean Spiral', () => {
    it('should calculate repulsive impulse when two cards overlap', () => {
      const impulse = calculateRepulsionImpulse(
        { x: 100, y: 100 },
        { x: 120, y: 100 },
        { x: 0, y: 0 },
        { x: 0, y: 0 }
      );

      // Card A should be pushed to the left (negative x)
      expect(impulse.x).toBeLessThan(0);
      expect(impulse.y).toBeCloseTo(0, 1);
    });

    it('should generate distinct non-zero coordinates in Archimedean spiral', () => {
      const offsets = getArchimedeanSpiralOffsets(10, 80, 20);
      expect(offsets.length).toBe(10);
      expect(offsets[0]).toEqual({ x: 0, y: 0 }); // First item at center

      // Subsequent offsets must be radially distributed
      for (let i = 1; i < offsets.length; i++) {
        const dist = Math.sqrt(offsets[i].x ** 2 + offsets[i].y ** 2);
        expect(dist).toBeGreaterThan(50);
      }
    });

    it('should not apply repulsion to or from cards being dragged', () => {
      const cardOnBoard = CardFactory.createCard(world, {
        defId: 'board_card',
        nameTerm: 'Board Card',
        type: 'Resource',
        x: 100,
        y: 100,
      });

      const draggedCard = CardFactory.createCard(world, {
        defId: 'dragged_card',
        nameTerm: 'Dragged Card',
        type: 'Worker',
        x: 105, // Overlapping closely (within 95px clearance)
        y: 100,
      });

      const draggable = world.getComponent(draggedCard, 'draggable')!;
      draggable.isDragging = true;

      const sim = new SimLoop(world);
      sim.tick();

      const transformBoard = world.getComponent(cardOnBoard, 'transform')!;
      const transformDragged = world.getComponent(draggedCard, 'transform')!;

      // Neither card should have acquired velocity from repulsion
      expect(transformBoard.vx).toBe(0);
      expect(transformBoard.vy).toBe(0);
      expect(transformDragged.vx).toBe(0);
      expect(transformDragged.vy).toBe(0);

      // Positions should remain unchanged
      expect(transformBoard.x).toBe(100);
      expect(transformDragged.x).toBe(105);
    });
  });

  describe('Simulation Loop & Headless Stepping', () => {
    it('should increment tick count on deterministic headless execution', () => {
      const sim = new SimLoop(world);
      expect(sim.getTickCount()).toBe(0);

      sim.runHeadlessTicks(60);
      expect(sim.getTickCount()).toBe(60);
    });

    it('should not advance tick count when paused', () => {
      const sim = new SimLoop(world);
      sim.setTimeScale(0);

      sim.update(1.0); // 1 second wall-clock time
      expect(sim.getTickCount()).toBe(0);
    });
  });
});
