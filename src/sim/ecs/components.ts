export type CardType = 
  | 'Worker' 
  | 'Food' 
  | 'Resource' 
  | 'Structure' 
  | 'Mob' 
  | 'Blueprint' 
  | 'Pack' 
  | 'Equipment' 
  | 'Coin' 
  | 'Corpse';

export interface TransformComponent {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX?: number;
  targetY?: number;
  elevation: number;
  zIndex: number;
}

export interface CardDataComponent {
  id: string; // Definition ID (e.g., 'villager', 'berry_bush')
  instanceGuid: string;
  nameTerm: string;
  descriptionTerm: string;
  type: CardType;
  script?: string;
  icon?: string;
  value: number;
  cardLimitCost: number;
  dynamicProperties: Record<string, any>;
  visualOverrides?: {
    background?: string;
    border?: string;
    typography?: string;
  };
}

export interface StackNodeComponent {
  parentId: number | null; // Card directly underneath
  childId: number | null;  // Card directly on top
  stackRootId: number;     // Bottom-most card entity ID
  stackIndex: number;      // 0 for root, 1 for first child, etc.
}

export interface DraggableComponent {
  isDragging: boolean;
  dragStartX: number;
  dragStartY: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
}

export interface PhysicalComponent {
  width: number;
  height: number;
  mass: number;
  clearanceRadius: number;
  isPinned: boolean;
}

export interface CraftingComponent {
  recipeId: string;
  subprintIndex: number;
  progress: number;
  duration: number;
  statusTerm: string;
  inputEntityIds: number[];
  consumedMap: boolean[];
}

export interface PackStateComponent {
  packDefId: string;
  cost: number;
  depositedCoins: number;
}

export type CombatArchetype = 'Melee' | 'Ranged' | 'Magic';
export type CombatTier = 'Very Weak' | 'Weak' | 'Normal' | 'Strong' | 'Very Strong' | 'Extremely Strong';
export type SpecialCombatEffect = 'Stun' | 'Lifesteal' | 'Crit' | 'AOE';

export interface CombatantComponent {
  archetype: CombatArchetype;
  tier: CombatTier;
  health: number;
  maxHealth: number;
  attackCooldown: number;
  attackInterval: number;
  hitProbability: number;
  baseDamage: number;
  defenseBlock: number;
  stunDuration: number;
  specialEffect?: SpecialCombatEffect;
  isHostile: boolean;
  lootTable?: string[];
}

export interface ComponentMap {
  transform: TransformComponent;
  cardData: CardDataComponent;
  stackNode: StackNodeComponent;
  draggable: DraggableComponent;
  physical: PhysicalComponent;
  crafting: CraftingComponent;
  packState: PackStateComponent;
  combatant: CombatantComponent;
}

export type ComponentName = keyof ComponentMap;


