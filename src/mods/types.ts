import { CardType } from '../sim/ecs/components.js';

export interface VisualOverrides {
  background?: string;
  border?: string;
  typography?: string;
}

export interface CardDefinition {
  id: string;
  nameTerm: string;
  descriptionTerm?: string;
  type: CardType;
  script?: string;
  icon?: string;
  value?: number;
  cardLimitCost?: number;
  tags?: string[];
  dynamicProperties?: Record<string, any>;
  visualOverrides?: VisualOverrides;
}

export interface OutputEntry {
  id: string;
  chance: number;
  amount: number;
}

export interface Subprint {
  requiredCards: string[]; // e.g. ['iron_ore', 'wood', 'tag:worker']
  resultCards: OutputEntry[];
  consumedInputs: boolean[];
  time: number;
  statusTerm: string;
  priority?: number;
}

export interface BlueprintDefinition {
  id: string;
  nameTerm: string;
  group: string;
  subprints: Subprint[];
}

export interface DropPoolEntry {
  id: string;
  weight: number;
  condition?: string;
}

export interface GuaranteeRule {
  cardId: string;
  afterPacks: number;
}

export interface PackDefinition {
  id: string;
  nameTerm?: string;
  cost: number;
  cardsPerPack: number;
  dropPool: DropPoolEntry[];
  guaranteeRules?: GuaranteeRule[];
}

export interface ModManifest {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  priority?: number;
  dependencies?: string[];
}
