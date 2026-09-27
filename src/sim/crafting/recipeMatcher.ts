import { World } from '../ecs/world.js';
import { CardRegistry, globalCardRegistry } from '../../mods/cardRegistry.js';
import { BlueprintDefinition, Subprint } from '../../mods/types.js';
import { StackTopology } from '../kinematics/stackTopology.js';

export interface MatchResult {
  blueprint: BlueprintDefinition;
  subprint: Subprint;
  subprintIndex: number;
  matchedEntityIds: number[]; // Maps 1-to-1 with subprint.requiredCards
  specificity: number;
  priority: number;
  scale: number;
}

export class RecipeMatcher {
  private registry: CardRegistry;

  constructor(registry: CardRegistry = globalCardRegistry) {
    this.registry = registry;
  }

  /**
   * Evaluates a card stack against all registered recipes and returns the best matching recipe
   * according to the deterministic conflict resolution hierarchy:
   * 1. Priority Tier (highest priority)
   * 2. Ingredient Specificity (more concrete IDs vs tags)
   * 3. Input Scale (larger number of required cards)
   * 4. Lexicographical Fallback (alphanumeric ID)
   */
  findBestRecipeForStack(world: World, stackRootId: number): MatchResult | null {
    const stackEntityIds = StackTopology.getStackArray(world, stackRootId);
    if (stackEntityIds.length === 0) return null;

    const stackCards = stackEntityIds
      .map((id) => ({
        id,
        cardData: world.getComponent(id, 'cardData'),
      }))
      .filter((entry): entry is { id: number; cardData: NonNullable<typeof entry.cardData> } => entry.cardData !== undefined);

    if (stackCards.length === 0) return null;

    const allBlueprints = this.registry.getAllBlueprints();
    const candidateMatches: MatchResult[] = [];

    for (const bp of allBlueprints) {
      for (let sIdx = 0; sIdx < bp.subprints.length; sIdx++) {
        const subprint = bp.subprints[sIdx];
        const match = this.tryMatchSubprint(subprint, stackCards);
        if (match) {
          const specificity = subprint.requiredCards.filter((req) => !req.startsWith('tag:')).length;
          const priority = subprint.priority ?? 0;
          const scale = subprint.requiredCards.length;

          candidateMatches.push({
            blueprint: bp,
            subprint,
            subprintIndex: sIdx,
            matchedEntityIds: match,
            specificity,
            priority,
            scale,
          });
        }
      }
    }

    if (candidateMatches.length === 0) return null;

    // Apply Deterministic Conflict Resolution Hierarchy
    candidateMatches.sort((a, b) => {
      // 1. Priority Tier
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      // 2. Ingredient Specificity
      if (b.specificity !== a.specificity) {
        return b.specificity - a.specificity;
      }
      // 3. Input Scale
      if (b.scale !== a.scale) {
        return b.scale - a.scale;
      }
      // 4. Lexicographical Fallback
      return a.blueprint.id.localeCompare(b.blueprint.id);
    });

    return candidateMatches[0];
  }

  /**
   * Checks if a subprint's requiredCards can be satisfied by a subset of stack cards.
   * Uses backtracking to find a valid 1-to-1 matching.
   */
  private tryMatchSubprint(
    subprint: Subprint,
    stackCards: Array<{ id: number; cardData: any }>
  ): number[] | null {
    if (subprint.requiredCards.length > stackCards.length) {
      return null;
    }

    // Sort requirements: concrete IDs first, broad tags second (optimizes matching speed)
    const indexedRequirements = subprint.requiredCards.map((req, index) => ({ req, index }));
    indexedRequirements.sort((a, b) => {
      const aIsTag = a.req.startsWith('tag:');
      const bIsTag = b.req.startsWith('tag:');
      if (aIsTag && !bIsTag) return 1;
      if (!aIsTag && bIsTag) return -1;
      return 0;
    });

    const usedEntities = new Set<number>();
    const matchedMap = new Map<number, number>(); // original requirement index -> entityId

    const backtrack = (reqIndex: number): boolean => {
      if (reqIndex >= indexedRequirements.length) {
        return true;
      }

      const { req, index: origIndex } = indexedRequirements[reqIndex];

      for (const card of stackCards) {
        if (usedEntities.has(card.id)) continue;

        const cardDef = this.registry.getCard(card.cardData.id);
        const matches = cardDef
          ? this.registry.matchesRequirement(cardDef, req)
          : this.registry.matchesRequirement(
              {
                id: card.cardData.id,
                nameTerm: card.cardData.nameTerm,
                type: card.cardData.type,
                tags: card.cardData.tags,
              },
              req
            );

        if (matches) {
          usedEntities.add(card.id);
          matchedMap.set(origIndex, card.id);

          if (backtrack(reqIndex + 1)) {
            return true;
          }

          usedEntities.delete(card.id);
          matchedMap.delete(origIndex);
        }
      }

      return false;
    };

    if (backtrack(0)) {
      // Reconstruct matched entity IDs in original subprint.requiredCards order
      const result: number[] = [];
      for (let i = 0; i < subprint.requiredCards.length; i++) {
        result.push(matchedMap.get(i)!);
      }
      return result;
    }

    return null;
  }
}

export const globalRecipeMatcher = new RecipeMatcher();
