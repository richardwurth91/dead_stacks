import { World } from '../ecs/world.js';
import { CombatantComponent } from '../ecs/components.js';
import { CombatMath, defaultRandomProvider, RandomProvider } from './combatMath.js';
import { StackTopology } from '../kinematics/stackTopology.js';
import { CardFactory } from '../cardFactory.js';
import { CardRegistry, globalCardRegistry } from '../../mods/cardRegistry.js';
import { globalEventBus } from '../events.js';

export interface AttackQueueEntry {
  attackerId: number;
}

export class CombatSystem {
  private world: World;
  private registry: CardRegistry;
  private rng: RandomProvider;
  private globalAttackLock: number = 0; // seconds remaining in global throttle
  private globalAttackThrottleDuration: number = 0.3; // 0.3s coordination window
  private attackQueue: AttackQueueEntry[] = [];

  constructor(
    world: World,
    registry: CardRegistry = globalCardRegistry,
    rng: RandomProvider = defaultRandomProvider,
    throttleDuration: number = 0.3
  ) {
    this.world = world;
    this.registry = registry;
    this.rng = rng;
    this.globalAttackThrottleDuration = throttleDuration;
  }

  getGlobalAttackLock(): number {
    return this.globalAttackLock;
  }

  getAttackQueueLength(): number {
    return this.attackQueue.length;
  }

  /**
   * Updates combat cooldowns, manages global throttle window, and executes queued strikes.
   */
  update(dt: number): void {
    // 1. Tick down global attack throttle window
    if (this.globalAttackLock > 0) {
      this.globalAttackLock -= dt;
      if (this.globalAttackLock < 0) this.globalAttackLock = 0;
    }

    // 2. Discover all active combat stacks
    const combatStacks = this.findCombatStacks();
    if (combatStacks.length === 0) {
      this.attackQueue = [];
      return;
    }

    // 3. For each skirmish, advance cooldowns (or tick down stuns)
    const combatantsReadyThisFrame: number[] = [];

    for (const stack of combatStacks) {
      for (const entityId of stack.entities) {
        const combatant = this.world.getComponent(entityId, 'combatant')!;

        // If stunned, tick down stun duration
        if (combatant.stunDuration > 0) {
          combatant.stunDuration -= dt;
          if (combatant.stunDuration < 0) combatant.stunDuration = 0;
          continue; // Cooldown timer remains paused during stun
        }

        // Tick down attack cooldown
        if (combatant.attackCooldown > 0) {
          combatant.attackCooldown -= dt;
          if (combatant.attackCooldown < 0) {
            combatant.attackCooldown = 0;
          }
        }

        if (combatant.attackCooldown === 0) {
          // Attack is ready!
          if (!this.attackQueue.some((entry) => entry.attackerId === entityId)) {
            combatantsReadyThisFrame.push(entityId);
          }
        }
      }
    }

    // 4. Deterministic Tie-Breaking for simultaneous ready triggers:
    // Sort ready combatants by lowest entity ID before enqueueing (FIFO)
    combatantsReadyThisFrame.sort((a, b) => a - b);
    for (const id of combatantsReadyThisFrame) {
      this.attackQueue.push({ attackerId: id });
    }

    // 5. Execute attacks from queue if global attack lock has expired
    while (this.globalAttackLock <= 0 && this.attackQueue.length > 0) {
      const entry = this.attackQueue.shift()!;
      const attackerId = entry.attackerId;

      const executed = this.executeAttack(attackerId);
      if (executed) {
        // Enforce global coordination window lock
        this.globalAttackLock = this.globalAttackThrottleDuration;
        break;
      }
    }
  }

  /**
   * Executes a single attack from attackerId to the primary opposing target in their stack.
   */
  executeAttack(attackerId: number): boolean {
    const attacker = this.world.getComponent(attackerId, 'combatant');
    const attackerNode = this.world.getComponent(attackerId, 'stackNode');
    if (!attacker || !attackerNode) return false;

    // Retrieve full stack
    const stackEntityIds = StackTopology.getStackArray(this.world, attackerNode.stackRootId);

    // Find opposing targets
    const targets = stackEntityIds
      .map((id) => ({ id, combat: this.world.getComponent(id, 'combatant') }))
      .filter((t): t is { id: number; combat: CombatantComponent } =>
        t.combat !== undefined && t.combat.isHostile !== attacker.isHostile && t.combat.health > 0
      );

    if (targets.length === 0) return false;

    const primaryTarget = targets[0];

    // Resolve mathematical damage pipeline
    const strike = CombatMath.resolveStrike(attacker, primaryTarget.combat, this.rng);

    // Handle Stun
    if (strike.isStun) {
      primaryTarget.combat.stunDuration = 2.0; // 2 seconds stun
    }

    // Handle Lifesteal
    if (strike.isLifesteal && strike.healthRestored > 0) {
      attacker.health = Math.min(attacker.maxHealth, attacker.health + strike.healthRestored);
    }

    // Handle AOE or Single Target damage
    if (strike.isAOE) {
      for (const target of targets) {
        target.combat.health -= strike.finalDamage;
        this.checkEntityDeath(target.id, target.combat);
      }
    } else {
      primaryTarget.combat.health -= strike.finalDamage;
      this.checkEntityDeath(primaryTarget.id, primaryTarget.combat);
    }

    globalEventBus.emit('OnCombatRoundResolved', {
      attackerId,
      targetId: primaryTarget.id,
      damage: strike.finalDamage,
      isCrit: strike.isCrit,
    });

    // Reset attacker's cooldown
    attacker.attackCooldown = attacker.attackInterval;

    return true;
  }

  private checkEntityDeath(entityId: number, combat: CombatantComponent): void {
    if (combat.health <= 0) {
      const transform = this.world.getComponent(entityId, 'transform');
      const spawnX = transform ? transform.x : 200;
      const spawnY = transform ? transform.y : 200;
      const lootTable = combat.lootTable || [];

      // Extract from stack and destroy
      StackTopology.extractSubStack(this.world, entityId);
      this.world.destroyEntity(entityId);

      globalEventBus.emit('OnCardDestroyed', {
        entityId,
        cardDefId: '',
      });

      // Spawn loot drops
      for (let i = 0; i < lootTable.length; i++) {
        const lootId = lootTable[i];
        CardFactory.createFromRegistry(
          this.world,
          lootId,
          spawnX + i * 20,
          spawnY + i * 20,
          this.registry
        );
      }
    }
  }

  /**
   * Identifies all active stacks that contain both friendly and hostile combatants.
   */
  findCombatStacks(): Array<{ rootId: number; entities: number[] }> {
    const cardEntities = this.world.query('stackNode', 'combatant');
    const rootMap = new Map<number, number[]>();

    for (const id of cardEntities) {
      const node = this.world.getComponent(id, 'stackNode')!;
      if (!rootMap.has(node.stackRootId)) {
        rootMap.set(node.stackRootId, []);
      }
      rootMap.get(node.stackRootId)!.push(id);
    }

    const skirmishStacks: Array<{ rootId: number; entities: number[] }> = [];

    for (const [rootId, entities] of rootMap.entries()) {
      let hasFriendly = false;
      let hasHostile = false;

      for (const id of entities) {
        const combat = this.world.getComponent(id, 'combatant')!;
        if (combat.health > 0) {
          if (combat.isHostile) hasHostile = true;
          else hasFriendly = true;
        }
      }

      if (hasFriendly && hasHostile) {
        skirmishStacks.push({ rootId, entities });
      }
    }

    return skirmishStacks;
  }
}
