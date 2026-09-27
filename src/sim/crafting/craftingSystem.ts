import { World } from '../ecs/world.js';
import { CraftingComponent } from '../ecs/components.js';
import { RecipeMatcher, globalRecipeMatcher } from './recipeMatcher.js';
import { CardRegistry, globalCardRegistry } from '../../mods/cardRegistry.js';
import { globalEventBus, StackMutationEvent } from '../events.js';
import { CardFactory } from '../cardFactory.js';
import { StackTopology } from '../kinematics/stackTopology.js';
import { getArchimedeanSpiralOffsets } from '../kinematics/repulsion.js';

export class CraftingSystem {
  private world: World;
  private matcher: RecipeMatcher;
  private registry: CardRegistry;

  constructor(
    world: World,
    matcher: RecipeMatcher = globalRecipeMatcher,
    registry: CardRegistry = globalCardRegistry
  ) {
    this.world = world;
    this.matcher = matcher;
    this.registry = registry;

    // Listen to stack mutations to initiate or cancel crafting
    globalEventBus.on('OnStackMutated', (event: StackMutationEvent) => {
      this.handleStackMutation(event);
    });
  }

  private handleStackMutation(event: StackMutationEvent): void {
    // If a stack was attached or extracted, evaluate both potential stack roots
    const entityToCheck = event.type === 'attached' ? event.parentEntityId : event.childEntityId;
    if (entityToCheck !== null) {
      const node = this.world.getComponent(entityToCheck, 'stackNode');
      if (node) {
        this.evaluateStack(node.stackRootId);
      }
    }

    // Also check the extracted child root if extracted
    if (event.type === 'extracted') {
      this.evaluateStack(event.childEntityId);
      // And the previous parent's root if it exists
      if (event.parentEntityId !== null) {
        const parentNode = this.world.getComponent(event.parentEntityId, 'stackNode');
        if (parentNode) {
          this.evaluateStack(parentNode.stackRootId);
        }
      }
    }
  }

  /**
   * Re-evaluates all root stacks across the tabletop. Useful when recipes change dynamically.
   */
  evaluateAllStacks(): void {
    const cardEntities = this.world.query('stackNode');
    for (const id of cardEntities) {
      const node = this.world.getComponent(id, 'stackNode');
      if (node && node.parentId === null) {
        this.evaluateStack(id);
      }
    }
  }

  /**
   * Re-evaluates a stack to start, resume, or abort crafting.
   */
  evaluateStack(stackRootId: number): void {
    const existingCraft = this.world.getComponent(stackRootId, 'crafting');
    const bestMatch = this.matcher.findBestRecipeForStack(this.world, stackRootId);

    if (!bestMatch) {
      // No recipe matches this stack: abort any active craft
      if (existingCraft) {
        this.world.removeComponent(stackRootId, 'crafting');
        globalEventBus.emit('OnRecipeProgress', {
          stackRootId,
          progress: 0,
          duration: existingCraft.duration,
        });
      }
      return;
    }

    // If already crafting this exact recipe with same inputs, keep running
    if (
      existingCraft &&
      existingCraft.recipeId === bestMatch.blueprint.id &&
      existingCraft.subprintIndex === bestMatch.subprintIndex
    ) {
      // Validate that all required input entity IDs are still present in stack
      const currentStack = new Set(StackTopology.getStackArray(this.world, stackRootId));
      const allPresent = existingCraft.inputEntityIds.every((id) => currentStack.has(id));
      if (allPresent) {
        return; // Valid and intact, continue progress
      }
    }

    // Start new crafting state machine
    const newCraft: CraftingComponent = {
      recipeId: bestMatch.blueprint.id,
      subprintIndex: bestMatch.subprintIndex,
      progress: 0,
      duration: bestMatch.subprint.time,
      statusTerm: bestMatch.subprint.statusTerm,
      inputEntityIds: bestMatch.matchedEntityIds,
      consumedMap: bestMatch.subprint.consumedInputs,
    };

    this.world.addComponent(stackRootId, 'crafting', newCraft);
    globalEventBus.emit('OnRecipeProgress', {
      stackRootId,
      progress: 0,
      duration: newCraft.duration,
    });
  }

  /**
   * Updates all active crafting timers by delta time dt.
   */
  update(dt: number): void {
    const craftingEntities = this.world.query('crafting', 'transform', 'stackNode');

    for (const rootId of craftingEntities) {
      const craft = this.world.getComponent(rootId, 'crafting')!;
      craft.progress += dt;

      globalEventBus.emit('OnRecipeProgress', {
        stackRootId: rootId,
        progress: craft.progress,
        duration: craft.duration,
      });

      if (craft.progress >= craft.duration) {
        this.completeCraft(rootId, craft);
      }
    }
  }

  private completeCraft(rootId: number, craft: CraftingComponent): void {
    const rootTransform = this.world.getComponent(rootId, 'transform');
    const spawnOriginX = rootTransform ? rootTransform.x + 95 : 200;
    const spawnOriginY = rootTransform ? rootTransform.y : 200;

    const bp = this.matcher['registry'].getBlueprint(craft.recipeId);
    if (!bp) {
      this.world.removeComponent(rootId, 'crafting');
      return;
    }
    const subprint = bp.subprints[craft.subprintIndex];

    // 1. Consume marked ingredients
    for (let i = 0; i < craft.inputEntityIds.length; i++) {
      const isConsumed = craft.consumedMap[i];
      if (isConsumed) {
        const entityToDestroy = craft.inputEntityIds[i];
        // Cleanly extract from stack before destruction
        StackTopology.extractSubStack(this.world, entityToDestroy);
        this.world.destroyEntity(entityToDestroy);
        globalEventBus.emit('OnCardDestroyed', {
          entityId: entityToDestroy,
          cardDefId: '',
        });
      }
    }

    // 2. Spawn output results
    const spawnedResults: string[] = [];
    for (const result of subprint.resultCards) {
      if (Math.random() <= result.chance) {
        for (let a = 0; a < result.amount; a++) {
          spawnedResults.push(result.id);
        }
      }
    }

    // Apply Archimedean spiral dispersal if multiple items spawn
    const spiralOffsets = getArchimedeanSpiralOffsets(spawnedResults.length, 60, 15);
    for (let i = 0; i < spawnedResults.length; i++) {
      const resultDefId = spawnedResults[i];
      const offset = spiralOffsets[i] || { x: 0, y: 0 };
      CardFactory.createFromRegistry(
        this.world,
        resultDefId,
        spawnOriginX + offset.x,
        spawnOriginY + offset.y,
        this.registry
      );
    }

    // 3. Clear crafting component
    this.world.removeComponent(rootId, 'crafting');

    globalEventBus.emit('OnRecipeCompleted', {
      stackRootId: rootId,
      recipeId: craft.recipeId,
    });

    // 4. Re-evaluate remaining stack (e.g. Worker still on Bush continues harvesting)
    if (this.world.hasComponent(rootId, 'stackNode')) {
      const node = this.world.getComponent(rootId, 'stackNode');
      if (node) {
        this.evaluateStack(node.stackRootId);
      }
    }
  }
}
