import { CombatArchetype, CombatTier, CombatantComponent } from '../ecs/components.js';

export interface TierStats {
  attackInterval: number; // seconds
  hitProbability: number; // 0..1
  baseDamage: number;
  defenseBlock: number;
}

export const TIER_STATS_TABLE: Record<CombatTier, TierStats> = {
  'Very Weak': { attackInterval: 6.0, hitProbability: 0.50, baseDamage: 1, defenseBlock: 0 },
  'Weak': { attackInterval: 4.5, hitProbability: 0.60, baseDamage: 2, defenseBlock: 0 },
  'Normal': { attackInterval: 3.5, hitProbability: 0.70, baseDamage: 3, defenseBlock: 1 },
  'Strong': { attackInterval: 2.5, hitProbability: 0.80, baseDamage: 4, defenseBlock: 2 },
  'Very Strong': { attackInterval: 1.8, hitProbability: 0.90, baseDamage: 6, defenseBlock: 3 },
  'Extremely Strong': { attackInterval: 1.0, hitProbability: 0.95, baseDamage: 8, defenseBlock: 4 },
};

export interface StrikeResolution {
  isHit: boolean;
  isCrit: boolean;
  isStun: boolean;
  isLifesteal: boolean;
  isAOE: boolean;
  isScratch: boolean;
  hasAffinity: boolean;
  varianceBonus: number;
  grossDamage: number;
  mitigatedDamage: number;
  finalDamage: number;
  healthRestored: number;
}

export interface RandomProvider {
  nextFloat(): number; // Returns float in [0, 1)
}

export const defaultRandomProvider: RandomProvider = {
  nextFloat: () => Math.random(),
};

export class CombatMath {
  /**
   * Tactical Combat Triad Advantage:
   * Ranged beats Melee (+40%)
   * Melee beats Magic (+40%)
   * Magic beats Ranged (+40%)
   */
  static hasAffinityAdvantage(attacker: CombatArchetype, defender: CombatArchetype): boolean {
    return (
      (attacker === 'Ranged' && defender === 'Melee') ||
      (attacker === 'Melee' && defender === 'Magic') ||
      (attacker === 'Magic' && defender === 'Ranged')
    );
  }

  /**
   * Resolves the full mathematical damage pipeline for a single attack.
   */
  static resolveStrike(
    attacker: CombatantComponent,
    defender: CombatantComponent,
    rng: RandomProvider = defaultRandomProvider
  ): StrikeResolution {
    // 1. Accuracy Verification
    const accuracyRoll = rng.nextFloat();
    if (accuracyRoll > attacker.hitProbability) {
      return {
        isHit: false,
        isCrit: false,
        isStun: false,
        isLifesteal: false,
        isAOE: false,
        isScratch: false,
        hasAffinity: false,
        varianceBonus: 0,
        grossDamage: 0,
        mitigatedDamage: 0,
        finalDamage: 0,
        healthRestored: 0,
      };
    }

    // 2. Special Hit Check (Mutually Exclusive: Stun, Lifesteal, Crit, AOE)
    let isStun = false;
    let isLifesteal = false;
    let isCrit = false;
    let isAOE = false;

    if (attacker.specialEffect) {
      switch (attacker.specialEffect) {
        case 'Stun':
          isStun = true;
          break;
        case 'Lifesteal':
          isLifesteal = true;
          break;
        case 'Crit':
          isCrit = true;
          break;
        case 'AOE':
          isAOE = true;
          break;
      }
    }

    // 3. Variance Roll (50% Chance of +1 Base Damage)
    const varianceBonus = rng.nextFloat() < 0.5 ? 1 : 0;
    const grossDamage = attacker.baseDamage + varianceBonus;

    // 4. Defense Mitigation (Gross Damage - Defense Block; 50% Scratch Check if Zero)
    let netDamage = Math.max(0, grossDamage - defender.defenseBlock);
    let isScratch = false;

    if (netDamage === 0) {
      const scratchRoll = rng.nextFloat();
      if (scratchRoll < 0.5) {
        netDamage = 1;
        isScratch = true;
      }
    }

    // 5. Affinity Check (Apply +40% Bonus if Attacker Holds Type Advantage)
    const hasAffinity = this.hasAffinityAdvantage(attacker.archetype, defender.archetype);
    let damageAfterAffinity = netDamage;
    if (hasAffinity) {
      damageAfterAffinity = netDamage * 1.4;
    }

    // 6. Final Integer Rounding & Critical Doubling
    let finalDamage: number;
    if (isCrit) {
      finalDamage = Math.floor(damageAfterAffinity * 2);
    } else {
      finalDamage = Math.floor(damageAfterAffinity);
    }

    // Lifesteal restores health proportional to final damage
    const healthRestored = isLifesteal ? finalDamage : 0;

    return {
      isHit: true,
      isCrit,
      isStun,
      isLifesteal,
      isAOE,
      isScratch,
      hasAffinity,
      varianceBonus,
      grossDamage,
      mitigatedDamage: grossDamage - netDamage,
      finalDamage,
      healthRestored,
    };
  }
}
