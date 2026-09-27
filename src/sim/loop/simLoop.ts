import { World } from '../ecs/world.js';
import { KinematicSystem } from '../kinematics/kinematicSystem.js';
import { CraftingSystem } from '../crafting/craftingSystem.js';
import { MoonSystem } from '../economy/moonSystem.js';
import { CombatSystem } from '../combat/combatSystem.js';

export type TimeScaleMode = 0 | 1 | 2 | 5 | 10;

export class SimLoop {
  public static readonly FIXED_DT = 1 / 60; // 60 Hz fixed tick
  private world: World;
  private timeScale: TimeScaleMode = 1;
  private accumulator: number = 0;
  private tickCount: number = 0;
  public craftingSystem: CraftingSystem;
  public moonSystem: MoonSystem;
  public combatSystem: CombatSystem;

  constructor(
    world: World,
    craftingSystem?: CraftingSystem,
    moonSystem?: MoonSystem,
    combatSystem?: CombatSystem
  ) {
    this.world = world;
    this.craftingSystem = craftingSystem ?? new CraftingSystem(world);
    this.moonSystem = moonSystem ?? new MoonSystem(world);
    this.combatSystem = combatSystem ?? new CombatSystem(world);
  }

  setTimeScale(scale: TimeScaleMode): void {
    this.timeScale = scale;
  }

  getTimeScale(): TimeScaleMode {
    return this.timeScale;
  }

  isPaused(): boolean {
    return this.timeScale === 0;
  }

  /**
   * Advances the simulation by a variable wall-clock delta time (dt in seconds).
   * Accumulates time and runs fixed-step ticks.
   */
  update(deltaSeconds: number): void {
    if (this.timeScale === 0) {
      // Even when paused, allow zero-velocity kinematic constraints (such as drag updates)
      KinematicSystem.update(this.world, 0);
      return;
    }

    // Clamp large delta jumps (e.g. tab unfocused) to avoid spiral of death
    const clampedDelta = Math.min(deltaSeconds, 0.25);
    this.accumulator += clampedDelta * this.timeScale;

    while (this.accumulator >= SimLoop.FIXED_DT) {
      this.tick(SimLoop.FIXED_DT);
      this.accumulator -= SimLoop.FIXED_DT;
    }
  }

  /**
   * Runs a single deterministic simulation tick.
   */
  tick(dt: number = SimLoop.FIXED_DT): void {
    KinematicSystem.update(this.world, dt);
    this.craftingSystem.update(dt);
    this.moonSystem.update(dt);
    this.combatSystem.update(dt);
    this.tickCount++;
  }

  /**
   * Executes N headless ticks immediately (for testing or fast-forward).
   */
  runHeadlessTicks(ticks: number): void {
    for (let i = 0; i < ticks; i++) {
      this.tick(SimLoop.FIXED_DT);
    }
  }

  getTickCount(): number {
    return this.tickCount;
  }
}
