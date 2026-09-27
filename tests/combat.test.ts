import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/sim/ecs/world.js';
import { CombatMath, RandomProvider } from '../src/sim/combat/combatMath.js';
import { CombatSystem } from '../src/sim/combat/combatSystem.js';
import { CardRegistry } from '../src/mods/cardRegistry.js';
import { CardFactory } from '../src/sim/cardFactory.js';
import { StackTopology } from '../src/sim/kinematics/stackTopology.js';
import { CombatantComponent } from '../src/sim/ecs/components.js';

describe('Phase 4: Quantitative Combat Subsystem', () => {
  let world: World;
  let registry: CardRegistry;
  let combatSystem: CombatSystem;

  beforeEach(() => {
    world = new World();
    registry = new CardRegistry();
    combatSystem = new CombatSystem(world, registry);

    registry.registerCard({
      id: 'villager',
      nameTerm: 'Villager',
      type: 'Worker',
      value: -1,
      tags: ['tag:worker'],
    });

    registry.registerCard({
      id: 'goblin',
      nameTerm: 'Goblin',
      type: 'Mob',
      value: 2,
      tags: ['tag:mob'],
    });

    registry.registerCard({
      id: 'coin',
      nameTerm: 'Coin',
      type: 'Coin',
      value: 1,
      tags: ['tag:currency'],
    });
  });

  describe('Combat Triad & Tactical Affinity', () => {
    it('should correctly determine rock-paper-scissors affinity advantages', () => {
      expect(CombatMath.hasAffinityAdvantage('Ranged', 'Melee')).toBe(true);
      expect(CombatMath.hasAffinityAdvantage('Melee', 'Magic')).toBe(true);
      expect(CombatMath.hasAffinityAdvantage('Magic', 'Ranged')).toBe(true);

      // Disadvantages or neutrals
      expect(CombatMath.hasAffinityAdvantage('Melee', 'Ranged')).toBe(false);
      expect(CombatMath.hasAffinityAdvantage('Melee', 'Melee')).toBe(false);
      expect(CombatMath.hasAffinityAdvantage('Magic', 'Melee')).toBe(false);
    });

    it('should apply +40% affinity damage bonus when attacker has advantage', () => {
      let rollIndex = 0;
      const rolls = [0.1, 0.9]; // accuracy=0.1 (hit), variance=0.9 (no +1 bonus)
      const mockRng: RandomProvider = {
        nextFloat: () => rolls[rollIndex++ % rolls.length],
      };

      const attacker: CombatantComponent = {
        archetype: 'Ranged', // Advantage over Melee
        tier: 'Normal',
        health: 10,
        maxHealth: 10,
        attackCooldown: 1,
        attackInterval: 3,
        hitProbability: 0.9,
        baseDamage: 5,
        defenseBlock: 0,
        stunDuration: 0,
        isHostile: false,
      };

      const defender: CombatantComponent = {
        archetype: 'Melee',
        tier: 'Normal',
        health: 10,
        maxHealth: 10,
        attackCooldown: 1,
        attackInterval: 3,
        hitProbability: 0.7,
        baseDamage: 3,
        defenseBlock: 0,
        stunDuration: 0,
        isHostile: true,
      };

      const strike = CombatMath.resolveStrike(attacker, defender, mockRng);
      expect(strike.isHit).toBe(true);
      expect(strike.hasAffinity).toBe(true);
      // Base 5 * 1.4 = 7
      expect(strike.finalDamage).toBe(7);
    });
  });

  describe('Damage Pipeline: Variance, Mitigation & Scratch Check', () => {
    it('should result in a miss if accuracy roll fails', () => {
      const mockRng: RandomProvider = {
        nextFloat: () => 0.99, // Fails 0.7 hit prob
      };

      const attacker: CombatantComponent = {
        archetype: 'Melee',
        tier: 'Normal',
        health: 10,
        maxHealth: 10,
        attackCooldown: 0,
        attackInterval: 3,
        hitProbability: 0.7,
        baseDamage: 4,
        defenseBlock: 0,
        stunDuration: 0,
        isHostile: false,
      };

      const defender: CombatantComponent = {
        archetype: 'Melee',
        tier: 'Normal',
        health: 10,
        maxHealth: 10,
        attackCooldown: 0,
        attackInterval: 3,
        hitProbability: 0.7,
        baseDamage: 3,
        defenseBlock: 0,
        stunDuration: 0,
        isHostile: true,
      };

      const strike = CombatMath.resolveStrike(attacker, defender, mockRng);
      expect(strike.isHit).toBe(false);
      expect(strike.finalDamage).toBe(0);
    });

    it('should award 1 scratch damage when armor completely blocks gross damage and scratch roll succeeds', () => {
      let rollIndex = 0;
      const rolls = [0.1, 0.9, 0.2]; // accuracy=0.1 (hit), variance=0.9 (no +1), scratch=0.2 (<0.5 -> scratch hit!)
      const mockRng: RandomProvider = {
        nextFloat: () => rolls[rollIndex++ % rolls.length],
      };

      const attacker: CombatantComponent = {
        archetype: 'Melee',
        tier: 'Weak',
        health: 5,
        maxHealth: 5,
        attackCooldown: 0,
        attackInterval: 4,
        hitProbability: 0.8,
        baseDamage: 2,
        defenseBlock: 0,
        stunDuration: 0,
        isHostile: false,
      };

      const highArmorDefender: CombatantComponent = {
        archetype: 'Melee',
        tier: 'Extremely Strong',
        health: 10,
        maxHealth: 10,
        attackCooldown: 0,
        attackInterval: 2,
        hitProbability: 0.8,
        baseDamage: 5,
        defenseBlock: 4, // 2 - 4 <= 0
        stunDuration: 0,
        isHostile: true,
      };

      const strike = CombatMath.resolveStrike(attacker, highArmorDefender, mockRng);
      expect(strike.isHit).toBe(true);
      expect(strike.isScratch).toBe(true);
      expect(strike.finalDamage).toBe(1);
    });

    it('should double damage upon Critical Hit', () => {
      const mockRng: RandomProvider = {
        nextFloat: () => 0.1, // hit, variance +1
      };

      const attacker: CombatantComponent = {
        archetype: 'Melee',
        tier: 'Normal',
        health: 10,
        maxHealth: 10,
        attackCooldown: 0,
        attackInterval: 3,
        hitProbability: 0.8,
        baseDamage: 4,
        defenseBlock: 0,
        stunDuration: 0,
        specialEffect: 'Crit',
        isHostile: false,
      };

      const defender: CombatantComponent = {
        archetype: 'Melee',
        tier: 'Normal',
        health: 20,
        maxHealth: 20,
        attackCooldown: 0,
        attackInterval: 3,
        hitProbability: 0.8,
        baseDamage: 2,
        defenseBlock: 1,
        stunDuration: 0,
        isHostile: true,
      };

      const strike = CombatMath.resolveStrike(attacker, defender, mockRng);
      expect(strike.isCrit).toBe(true);
      // gross: 4 + 1 = 5, net: 5 - 1 = 4, crit doubled: 4 * 2 = 8
      expect(strike.finalDamage).toBe(8);
    });
  });

  describe('Combat Skirmishes & Concurrency Throttle', () => {
    it('should detect skirmish when hostile and friendly cards are stacked together', () => {
      const villager = CardFactory.createCard(world, {
        defId: 'villager',
        nameTerm: 'Villager',
        type: 'Worker',
        x: 0,
        y: 0,
      });

      const goblin = CardFactory.createCard(world, {
        defId: 'goblin',
        nameTerm: 'Goblin',
        type: 'Mob',
        x: 0,
        y: 0,
      });

      StackTopology.attachSubStack(world, villager, goblin);

      const skirmishes = combatSystem.findCombatStacks();
      expect(skirmishes.length).toBe(1);
      expect(skirmishes[0].rootId).toBe(villager);
    });

    it('should enforce global attack lock preventing simultaneous attacks in the same frame', () => {
      const villager = CardFactory.createCard(world, {
        defId: 'villager',
        nameTerm: 'Villager',
        type: 'Worker',
        x: 0,
        y: 0,
      });

      const goblin = CardFactory.createCard(world, {
        defId: 'goblin',
        nameTerm: 'Goblin',
        type: 'Mob',
        x: 0,
        y: 0,
      });

      StackTopology.attachSubStack(world, villager, goblin);

      // Force both units to have zero cooldown (both ready to attack) and ample health
      const cVillager = world.getComponent(villager, 'combatant')!;
      const cGoblin = world.getComponent(goblin, 'combatant')!;
      cVillager.health = 20;
      cVillager.maxHealth = 20;
      cGoblin.health = 20;
      cGoblin.maxHealth = 20;
      cVillager.attackCooldown = 0;
      cGoblin.attackCooldown = 0;

      // Update frame
      combatSystem.update(0.016);

      // One unit attacked, setting global attack lock
      expect(combatSystem.getGlobalAttackLock()).toBeGreaterThan(0);

      // The second unit should be waiting in queue
      expect(combatSystem.getAttackQueueLength()).toBe(1);

      // Ticking immediately while lock > 0 does NOT execute the queued attack
      combatSystem.update(0.016);
      expect(combatSystem.getAttackQueueLength()).toBe(1);

      // Advance time past the throttle duration (0.3s)
      combatSystem.update(0.35);

      // Now the queued attack executes
      expect(combatSystem.getAttackQueueLength()).toBe(0);
    });

    it('should destroy defeated enemy and spawn loot drops', () => {
      const villager = CardFactory.createCard(world, {
        defId: 'villager',
        nameTerm: 'Villager',
        type: 'Worker',
        x: 100,
        y: 100,
      });

      const goblin = CardFactory.createCard(world, {
        defId: 'goblin',
        nameTerm: 'Goblin',
        type: 'Mob',
        x: 100,
        y: 100,
      });

      StackTopology.attachSubStack(world, villager, goblin);

      const cVillager = world.getComponent(villager, 'combatant')!;
      const cGoblin = world.getComponent(goblin, 'combatant')!;

      // Give villager overwhelming damage and goblin 1 HP
      cVillager.baseDamage = 20;
      cVillager.hitProbability = 1.0;
      cGoblin.health = 1;
      cGoblin.lootTable = ['coin'];

      combatSystem.executeAttack(villager);

      // Goblin should be destroyed
      expect(world.hasComponent(goblin, 'combatant')).toBe(false);

      // Coin loot should have spawned
      const coins = world.query('cardData').filter(
        (id) => world.getComponent(id, 'cardData')?.id === 'coin'
      );
      expect(coins.length).toBe(1);
    });
  });
});
