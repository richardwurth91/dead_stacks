import { CardDefinition, BlueprintDefinition, PackDefinition } from './types.js';

export class CardRegistry {
  private cards: Map<string, CardDefinition> = new Map();
  private tagIndex: Map<string, Set<string>> = new Map(); // tag -> Set of cardDefIds
  private blueprints: Map<string, BlueprintDefinition> = new Map();
  private packs: Map<string, PackDefinition> = new Map();

  registerCard(def: CardDefinition): void {
    this.cards.set(def.id, def);

    // Auto-index type as an implicit tag: e.g. tag:worker, tag:food
    const implicitTypeTag = `tag:${def.type.toLowerCase()}`;
    this.addToTagIndex(implicitTypeTag, def.id);

    // Index explicit tags
    if (def.tags) {
      for (const tag of def.tags) {
        this.addToTagIndex(tag, def.id);
      }
    }
  }

  private addToTagIndex(tag: string, cardId: string): void {
    const normalized = tag.toLowerCase();
    if (!this.tagIndex.has(normalized)) {
      this.tagIndex.set(normalized, new Set());
    }
    this.tagIndex.get(normalized)!.add(cardId);
  }

  getCard(id: string): CardDefinition | undefined {
    return this.cards.get(id);
  }

  hasCard(id: string): boolean {
    return this.cards.has(id);
  }

  getAllCards(): CardDefinition[] {
    return Array.from(this.cards.values());
  }

  getCardsByTag(tag: string): CardDefinition[] {
    const cardIds = this.tagIndex.get(tag.toLowerCase());
    if (!cardIds) return [];
    const result: CardDefinition[] = [];
    for (const id of cardIds) {
      const card = this.cards.get(id);
      if (card) result.push(card);
    }
    return result;
  }

  matchesRequirement(cardDef: CardDefinition, requirement: string): boolean {
    if (requirement.startsWith('tag:')) {
      const normalizedReq = requirement.toLowerCase();
      // Check explicit tags
      if (cardDef.tags && cardDef.tags.some((t) => t.toLowerCase() === normalizedReq)) {
        return true;
      }
      // Check implicit type tag
      if (`tag:${cardDef.type.toLowerCase()}` === normalizedReq) {
        return true;
      }
      return false;
    }
    return cardDef.id === requirement;
  }

  registerBlueprint(def: BlueprintDefinition): void {
    this.blueprints.set(def.id, def);
  }

  getBlueprint(id: string): BlueprintDefinition | undefined {
    return this.blueprints.get(id);
  }

  getAllBlueprints(): BlueprintDefinition[] {
    return Array.from(this.blueprints.values());
  }

  registerPack(def: PackDefinition): void {
    this.packs.set(def.id, def);
  }

  getPack(id: string): PackDefinition | undefined {
    return this.packs.get(id);
  }

  getAllPacks(): PackDefinition[] {
    return Array.from(this.packs.values());
  }

  updateCard(id: string, updates: Partial<CardDefinition>): CardDefinition | undefined {
    const existing = this.cards.get(id);
    if (!existing) return undefined;

    // Clean up old tag indices
    const oldTypeTag = `tag:${existing.type.toLowerCase()}`;
    this.tagIndex.get(oldTypeTag)?.delete(id);
    if (existing.tags) {
      for (const tag of existing.tags) {
        this.tagIndex.get(tag.toLowerCase())?.delete(id);
      }
    }

    const updated: CardDefinition = {
      ...existing,
      ...updates,
      visualOverrides: updates.visualOverrides
        ? { ...existing.visualOverrides, ...updates.visualOverrides }
        : existing.visualOverrides,
      dynamicProperties: updates.dynamicProperties
        ? { ...existing.dynamicProperties, ...updates.dynamicProperties }
        : existing.dynamicProperties,
    };

    this.registerCard(updated);
    return updated;
  }

  removeBlueprint(id: string): boolean {
    return this.blueprints.delete(id);
  }

  getBlueprintsProducingCard(cardDefId: string): BlueprintDefinition[] {
    return Array.from(this.blueprints.values()).filter((bp) =>
      bp.subprints.some((sp) => sp.resultCards.some((rc) => rc.id === cardDefId))
    );
  }

  clear(): void {
    this.cards.clear();
    this.tagIndex.clear();
    this.blueprints.clear();
    this.packs.clear();
  }
}

export const globalCardRegistry = new CardRegistry();
