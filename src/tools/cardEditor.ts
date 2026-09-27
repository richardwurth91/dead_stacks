import { World } from '../sim/ecs/world.js';
import { CardRegistry, globalCardRegistry } from '../mods/cardRegistry.js';
import { CardDefinition, BlueprintDefinition, Subprint } from '../mods/types.js';
import { CardDataComponent, CardType, CombatantComponent } from '../sim/ecs/components.js';
import { CraftingSystem } from '../sim/crafting/craftingSystem.js';
import { globalEventBus } from '../sim/events.js';
import { globalLocalization } from '../mods/localization.js';

export interface CardModificationOptions {
  nameTerm?: string;
  type?: CardType;
  value?: number;
  cardLimitCost?: number;
  visualOverrides?: {
    background?: string;
    border?: string;
    typography?: string;
  };
  dynamicProperties?: Record<string, any>;
}

export interface CustomRecipeOptions {
  resultCardId: string;
  ingredientCardIds: string[];
  durationSeconds: number;
  statusTerm?: string;
  consumedInputs?: boolean[];
  recipeId?: string;
}

export class CardEditor {
  private static activeModal: HTMLElement | null = null;

  /**
   * Applies modifications to a card definition in the registry and updates
   * ALL active entity instances of that card on the tabletop board.
   */
  static applyCardModifications(
    world: World,
    registry: CardRegistry,
    defId: string,
    updates: CardModificationOptions
  ): CardDefinition | undefined {
    // 1. Update definition in the CardRegistry
    const updatedDef = registry.updateCard(defId, updates);
    if (!updatedDef) return undefined;

    // 2. Query and update all existing card entities on the board matching this defId
    const allCardEntities = world.query('cardData');
    for (const entityId of allCardEntities) {
      const cardData = world.getComponent(entityId, 'cardData') as CardDataComponent;
      if (cardData.id === defId) {
        if (updates.nameTerm !== undefined) cardData.nameTerm = updates.nameTerm;
        if (updates.type !== undefined) cardData.type = updates.type;
        if (updates.value !== undefined) cardData.value = updates.value;
        if (updates.cardLimitCost !== undefined) cardData.cardLimitCost = updates.cardLimitCost;

        if (updates.visualOverrides) {
          cardData.visualOverrides = {
            ...cardData.visualOverrides,
            ...updates.visualOverrides,
          };
        }

        if (updates.dynamicProperties) {
          cardData.dynamicProperties = {
            ...cardData.dynamicProperties,
            ...updates.dynamicProperties,
          };
        }

        // If combatant attributes are present, update combatant component
        if (world.hasComponent(entityId, 'combatant')) {
          const combat = world.getComponent(entityId, 'combatant') as CombatantComponent;
          if (updates.dynamicProperties?._Health !== undefined) {
            combat.maxHealth = updates.dynamicProperties._Health;
            combat.health = Math.min(combat.health, combat.maxHealth);
          }
          if (updates.dynamicProperties?._BaseDamage !== undefined) {
            combat.baseDamage = updates.dynamicProperties._BaseDamage;
          }
          if (updates.dynamicProperties?._CombatTier !== undefined) {
            combat.tier = updates.dynamicProperties._CombatTier;
          }
        }
      }
    }

    // 3. Emit notification on globalEventBus so views update visually
    globalEventBus.emit('OnCardDefinitionUpdated', {
      defId,
      updatedDef,
    });

    return updatedDef;
  }

  /**
   * Defines a recipe combining ingredients into a target result card.
   * Registers the blueprint in CardRegistry and re-evaluates all stacks on the board.
   */
  static addOrUpdateRecipe(
    registry: CardRegistry,
    craftingSystem: CraftingSystem | undefined,
    options: CustomRecipeOptions
  ): BlueprintDefinition {
    const id =
      options.recipeId ||
      `bp_${options.ingredientCardIds.join('_')}_to_${options.resultCardId}`;

    const consumed =
      options.consumedInputs || options.ingredientCardIds.map(() => false);

    const subprint: Subprint = {
      requiredCards: [...options.ingredientCardIds],
      time: options.durationSeconds,
      statusTerm: options.statusTerm || `Crafting ${options.resultCardId}...`,
      consumedInputs: consumed,
      resultCards: [{ id: options.resultCardId, chance: 1, amount: 1 }],
      priority: 10,
    };

    const blueprint: BlueprintDefinition = {
      id,
      nameTerm: `Craft ${options.resultCardId}`,
      group: 'Custom Recipes',
      subprints: [subprint],
    };

    registry.registerBlueprint(blueprint);
    globalEventBus.emit('OnBlueprintRegistered', { blueprint });

    // Trigger immediate stack evaluation so existing stacks on board start crafting!
    if (craftingSystem) {
      craftingSystem.evaluateAllStacks();
    }

    return blueprint;
  }

  /**
   * Opens the interactive in-game Card Definition & Recipe Editor modal dialog.
   */
  static openEditor(
    defId: string,
    world: World,
    registry: CardRegistry = globalCardRegistry,
    craftingSystem?: CraftingSystem
  ): void {
    if (typeof document === 'undefined') return;

    this.closeEditor();

    const cardDef = registry.getCard(defId);
    if (!cardDef) {
      console.error(`[CardEditor] Cannot find card definition for '${defId}'`);
      return;
    }

    const allCards = registry.getAllCards();
    const existingBlueprints = registry.getBlueprintsProducingCard(defId);

    // Initial state
    let curBg = cardDef.visualOverrides?.background || '#2e7d32';
    let curBorder = cardDef.visualOverrides?.border || '#81c784';
    let curText = cardDef.visualOverrides?.typography || '#ffffff';
    let curName = cardDef.nameTerm;
    let curType = cardDef.type;
    let curValue = cardDef.value ?? 1;
    let curFoodDemand = cardDef.dynamicProperties?._FoodDemand ?? (curType === 'Worker' ? 1 : 0);
    let curFoodValue = cardDef.dynamicProperties?._FoodValue ?? (curType === 'Food' ? 1 : 0);

    const modal = document.createElement('div');
    modal.id = 'card-editor-modal';
    modal.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 640px;
      max-width: 95vw;
      max-height: 90vh;
      background: rgba(18, 18, 26, 0.98);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 14px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
      z-index: 3000;
      display: flex;
      flex-direction: column;
      color: #f1f5f9;
      font-family: system-ui, -apple-system, sans-serif;
      overflow: hidden;
    `;

    modal.innerHTML = `
      <div style="padding: 14px 20px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); display: flex; align-items: center; justify-content: space-between; background: rgba(255, 255, 255, 0.03);">
        <div style="font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 8px;">
          🎨 Card Type & Recipe Editor: <span style="color: #38bdf8;">${defId}</span>
        </div>
        <button id="editor-close-btn" style="background: none; border: none; color: #94a3b8; font-size: 20px; cursor: pointer;">✕</button>
      </div>

      <div style="display: flex; flex: 1; overflow-y: auto; padding: 20px; gap: 20px;">
        <!-- Left: Form Controls -->
        <div style="flex: 1; display: flex; flex-direction: column; gap: 14px;">
          <!-- Visible: Name & Type -->
          <div style="display: flex; gap: 10px;">
            <div style="flex: 2;">
              <label style="font-size: 11px; font-weight: 600; color: #94a3b8; display: block; margin-bottom: 4px;">Display Name / Term</label>
              <input id="edit-card-name" type="text" value="${curName}" style="width: 100%; background: #23232f; border: 1px solid #3e3e50; border-radius: 6px; padding: 6px 10px; color: #ffffff; font-size: 13px;" />
            </div>
            <div style="flex: 1;">
              <label style="font-size: 11px; font-weight: 600; color: #94a3b8; display: block; margin-bottom: 4px;">Card Type</label>
              <select id="edit-card-type" style="width: 100%; background: #23232f; border: 1px solid #3e3e50; border-radius: 6px; padding: 6px 8px; color: #ffffff; font-size: 12px;">
                <option value="Worker" ${curType === 'Worker' ? 'selected' : ''}>Worker</option>
                <option value="Food" ${curType === 'Food' ? 'selected' : ''}>Food</option>
                <option value="Resource" ${curType === 'Resource' ? 'selected' : ''}>Resource</option>
                <option value="Structure" ${curType === 'Structure' ? 'selected' : ''}>Structure</option>
                <option value="Mob" ${curType === 'Mob' ? 'selected' : ''}>Mob</option>
                <option value="Coin" ${curType === 'Coin' ? 'selected' : ''}>Coin</option>
                <option value="Pack" ${curType === 'Pack' ? 'selected' : ''}>Pack</option>
                <option value="Corpse" ${curType === 'Corpse' ? 'selected' : ''}>Corpse</option>
              </select>
            </div>
          </div>

          <!-- Visible: Color Overrides -->
          <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 12px;">
            <div style="font-size: 12px; font-weight: 700; margin-bottom: 8px; color: #e2e8f0;">🎨 Visual Color Overrides</div>
            <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 10px;">
              <div style="flex: 1;">
                <label style="font-size: 10px; color: #94a3b8; display: block; margin-bottom: 2px;">Card Background</label>
                <div style="display: flex; gap: 6px; align-items: center;">
                  <input id="color-bg-picker" type="color" value="${curBg.startsWith('#') ? curBg : '#' + curBg}" style="border: none; width: 28px; height: 28px; border-radius: 4px; cursor: pointer; background: transparent;" />
                  <input id="color-bg-text" type="text" value="${curBg}" style="width: 70px; background: #1c1c24; border: 1px solid #333344; color: #fff; font-size: 11px; padding: 4px; border-radius: 4px; font-family: monospace;" />
                </div>
              </div>
              <div style="flex: 1;">
                <label style="font-size: 10px; color: #94a3b8; display: block; margin-bottom: 2px;">Card Border</label>
                <div style="display: flex; gap: 6px; align-items: center;">
                  <input id="color-border-picker" type="color" value="${curBorder.startsWith('#') ? curBorder : '#' + curBorder}" style="border: none; width: 28px; height: 28px; border-radius: 4px; cursor: pointer; background: transparent;" />
                  <input id="color-border-text" type="text" value="${curBorder}" style="width: 70px; background: #1c1c24; border: 1px solid #333344; color: #fff; font-size: 11px; padding: 4px; border-radius: 4px; font-family: monospace;" />
                </div>
              </div>
              <div style="flex: 1;">
                <label style="font-size: 10px; color: #94a3b8; display: block; margin-bottom: 2px;">Text Color</label>
                <div style="display: flex; gap: 6px; align-items: center;">
                  <input id="color-text-picker" type="color" value="${curText.startsWith('#') ? curText : '#' + curText}" style="border: none; width: 28px; height: 28px; border-radius: 4px; cursor: pointer; background: transparent;" />
                  <input id="color-text-text" type="text" value="${curText}" style="width: 70px; background: #1c1c24; border: 1px solid #333344; color: #fff; font-size: 11px; padding: 4px; border-radius: 4px; font-family: monospace;" />
                </div>
              </div>
            </div>

            <!-- Color Swatches / Presets -->
            <div style="display: flex; gap: 6px; align-items: center;">
              <span style="font-size: 10px; color: #64748b;">Presets:</span>
              <button class="swatch-btn" data-bg="#ffffff" data-border="#cbd5e1" data-text="#0f172a" style="background: #ffffff; color: #000; border: 1px solid #94a3b8; font-size: 9px; padding: 2px 6px; border-radius: 3px; cursor: pointer;">White</button>
              <button class="swatch-btn" data-bg="#2e7d32" data-border="#81c784" data-text="#ffffff" style="background: #2e7d32; color: #fff; border: 1px solid #81c784; font-size: 9px; padding: 2px 6px; border-radius: 3px; cursor: pointer;">Emerald</button>
              <button class="swatch-btn" data-bg="#e65100" data-border="#ffb74d" data-text="#ffffff" style="background: #e65100; color: #fff; border: 1px solid #ffb74d; font-size: 9px; padding: 2px 6px; border-radius: 3px; cursor: pointer;">Orange</button>
              <button class="swatch-btn" data-bg="#1565c0" data-border="#64b5f6" data-text="#ffffff" style="background: #1565c0; color: #fff; border: 1px solid #64b5f6; font-size: 9px; padding: 2px 6px; border-radius: 3px; cursor: pointer;">Royal Blue</button>
              <button class="swatch-btn" data-bg="#b71c1c" data-border="#e57373" data-text="#ffffff" style="background: #b71c1c; color: #fff; border: 1px solid #e57373; font-size: 9px; padding: 2px 6px; border-radius: 3px; cursor: pointer;">Crimson</button>
              <button class="swatch-btn" data-bg="#f57f17" data-border="#fff176" data-text="#000000" style="background: #f57f17; color: #000; border: 1px solid #fff176; font-size: 9px; padding: 2px 6px; border-radius: 3px; cursor: pointer;">Gold</button>
            </div>
          </div>

          <!-- Invisible Attributes: Crafting Recipe Builder -->
          <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 12px;">
            <div style="font-size: 12px; font-weight: 700; margin-bottom: 4px; color: #e2e8f0; display: flex; align-items: center; justify-content: space-between;">
              <span>📜 Invisible: Crafting Combination Recipe</span>
              <span style="font-size: 10px; color: #38bdf8;">Stacks -> ${defId}</span>
            </div>
            <div style="font-size: 10px; color: #94a3b8; margin-bottom: 8px;">
              When two or more cards are stacked together on the tabletop, combine them into this card!
            </div>

            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
              <div style="flex: 1;">
                <label style="font-size: 10px; color: #94a3b8; display: block; margin-bottom: 2px;">Ingredient 1</label>
                <select id="recipe-ing-1" style="width: 100%; background: #1c1c24; border: 1px solid #333344; color: #fff; font-size: 11px; padding: 4px; border-radius: 4px;">
                  <option value="">(None)</option>
                  ${allCards.map((c) => `<option value="${c.id}">${c.id} (${c.type})</option>`).join('')}
                </select>
              </div>
              <span style="color: #64748b; font-weight: bold; margin-top: 14px;">+</span>
              <div style="flex: 1;">
                <label style="font-size: 10px; color: #94a3b8; display: block; margin-bottom: 2px;">Ingredient 2</label>
                <select id="recipe-ing-2" style="width: 100%; background: #1c1c24; border: 1px solid #333344; color: #fff; font-size: 11px; padding: 4px; border-radius: 4px;">
                  <option value="">(None)</option>
                  ${allCards.map((c) => `<option value="${c.id}">${c.id} (${c.type})</option>`).join('')}
                </select>
              </div>
              <span style="color: #64748b; font-weight: bold; margin-top: 14px;">➔</span>
              <div style="width: 70px;">
                <label style="font-size: 10px; color: #94a3b8; display: block; margin-bottom: 2px;">Time (sec)</label>
                <input id="recipe-duration" type="number" value="2.0" step="0.5" min="0.5" style="width: 100%; background: #1c1c24; border: 1px solid #333344; color: #fff; font-size: 11px; padding: 4px; border-radius: 4px;" />
              </div>
            </div>

            <div style="display: flex; gap: 14px; align-items: center; font-size: 11px;">
              <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                <input id="recipe-consume-1" type="checkbox" /> Consume Ing 1
              </label>
              <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                <input id="recipe-consume-2" type="checkbox" /> Consume Ing 2
              </label>
            </div>

            ${
              existingBlueprints.length > 0
                ? `<div style="margin-top: 8px; font-size: 10px; color: #64748b;">
                    Existing recipes producing this card: ${existingBlueprints.map((b) => b.id).join(', ')}
                   </div>`
                : ''
            }
          </div>

          <!-- Economics & Game Balance -->
          <div style="display: flex; gap: 10px;">
            <div style="flex: 1;">
              <label style="font-size: 11px; font-weight: 600; color: #94a3b8; display: block; margin-bottom: 4px;">Sell Value (Coins)</label>
              <input id="edit-card-value" type="number" min="0" value="${curValue}" style="width: 100%; background: #23232f; border: 1px solid #3e3e50; border-radius: 6px; padding: 6px 10px; color: #ffffff; font-size: 12px;" />
            </div>
            <div style="flex: 1;">
              <label style="font-size: 11px; font-weight: 600; color: #94a3b8; display: block; margin-bottom: 4px;">Food Demand / Val</label>
              <input id="edit-card-food" type="number" min="0" value="${curType === 'Worker' ? curFoodDemand : curFoodValue}" style="width: 100%; background: #23232f; border: 1px solid #3e3e50; border-radius: 6px; padding: 6px 10px; color: #ffffff; font-size: 12px;" />
            </div>
          </div>
        </div>

        <!-- Right: Live Card Preview -->
        <div style="width: 140px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.3); border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.05); padding: 12px;">
          <div style="font-size: 10px; color: #94a3b8; margin-bottom: 12px; font-weight: bold; text-transform: uppercase;">Live Preview</div>
          <div id="preview-card" style="
            width: 80px;
            height: 110px;
            border-radius: 8px;
            background: ${curBg};
            border: 2px solid ${curBorder};
            color: ${curText};
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            align-items: center;
            padding: 8px 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            transition: all 0.15s ease;
          ">
            <div id="preview-title" style="font-weight: bold; font-size: 11px; text-align: center; word-break: break-word; line-height: 1.1;">
              ${globalLocalization.t(curName, curName)}
            </div>
            <div id="preview-type" style="font-size: 8px; font-family: monospace; font-weight: 600; letter-spacing: 0.5px;">
              ${curType.toUpperCase()}
            </div>
          </div>
        </div>
      </div>

      <div style="padding: 14px 20px; border-top: 1px solid rgba(255, 255, 255, 0.1); display: flex; align-items: center; justify-content: space-between; background: rgba(0, 0, 0, 0.3);">
        <div style="font-size: 11px; color: #94a3b8;">
          ⚡ Applies instantly to all <strong style="color: #fff;">${defId}</strong> cards on board & future spawns.
        </div>
        <div style="display: flex; gap: 8px;">
          <button id="editor-cancel-btn" style="background: #2a2a36; border: 1px solid #3d3d4e; color: #cbd5e1; padding: 6px 14px; font-size: 12px; border-radius: 6px; cursor: pointer;">Cancel</button>
          <button id="editor-save-btn" style="background: #2563eb; border: 1px solid #3b82f6; color: #ffffff; padding: 6px 16px; font-size: 12px; font-weight: 600; border-radius: 6px; cursor: pointer;">💾 Apply Changes to All</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this.activeModal = modal;

    // Elements
    const nameInput = document.getElementById('edit-card-name') as HTMLInputElement;
    const typeSelect = document.getElementById('edit-card-type') as HTMLSelectElement;
    const bgPicker = document.getElementById('color-bg-picker') as HTMLInputElement;
    const bgText = document.getElementById('color-bg-text') as HTMLInputElement;
    const borderPicker = document.getElementById('color-border-picker') as HTMLInputElement;
    const borderText = document.getElementById('color-border-text') as HTMLInputElement;
    const textPicker = document.getElementById('color-text-picker') as HTMLInputElement;
    const textText = document.getElementById('color-text-text') as HTMLInputElement;
    const previewCard = document.getElementById('preview-card')!;
    const previewTitle = document.getElementById('preview-title')!;
    const previewType = document.getElementById('preview-type')!;

    const updatePreview = () => {
      previewCard.style.background = bgText.value;
      previewCard.style.borderColor = borderText.value;
      previewCard.style.color = textText.value;
      previewTitle.textContent = globalLocalization.t(nameInput.value, nameInput.value);
      previewType.textContent = typeSelect.value.toUpperCase();
    };

    // Color pickers sync
    bgPicker.addEventListener('input', () => {
      bgText.value = bgPicker.value;
      updatePreview();
    });
    bgText.addEventListener('input', () => {
      if (/^#[0-9a-fA-F]{6}$/.test(bgText.value)) bgPicker.value = bgText.value;
      updatePreview();
    });

    borderPicker.addEventListener('input', () => {
      borderText.value = borderPicker.value;
      updatePreview();
    });
    borderText.addEventListener('input', () => {
      if (/^#[0-9a-fA-F]{6}$/.test(borderText.value)) borderPicker.value = borderText.value;
      updatePreview();
    });

    textPicker.addEventListener('input', () => {
      textText.value = textPicker.value;
      updatePreview();
    });
    textText.addEventListener('input', () => {
      if (/^#[0-9a-fA-F]{6}$/.test(textText.value)) textPicker.value = textText.value;
      updatePreview();
    });

    nameInput.addEventListener('input', updatePreview);
    typeSelect.addEventListener('change', updatePreview);

    // Swatches
    modal.querySelectorAll('.swatch-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const bg = btn.getAttribute('data-bg')!;
        const border = btn.getAttribute('data-border')!;
        const text = btn.getAttribute('data-text')!;
        bgText.value = bg;
        bgPicker.value = bg;
        borderText.value = border;
        borderPicker.value = border;
        textText.value = text;
        textPicker.value = text;
        updatePreview();
      });
    });

    // Close handlers
    document.getElementById('editor-close-btn')?.addEventListener('click', () => this.closeEditor());
    document.getElementById('editor-cancel-btn')?.addEventListener('click', () => this.closeEditor());

    // Save & Apply
    document.getElementById('editor-save-btn')?.addEventListener('click', () => {
      const newName = nameInput.value.trim();
      const newType = typeSelect.value as CardType;
      const newBg = bgText.value.trim();
      const newBorder = borderText.value.trim();
      const newText = textText.value.trim();
      const newValue = parseInt((document.getElementById('edit-card-value') as HTMLInputElement).value, 10) || 1;
      const foodVal = parseInt((document.getElementById('edit-card-food') as HTMLInputElement).value, 10) || 0;

      const dynamicProps = { ...cardDef.dynamicProperties };
      if (newType === 'Worker') {
        dynamicProps._FoodDemand = foodVal;
      } else if (newType === 'Food') {
        dynamicProps._FoodValue = foodVal;
      }

      // Apply modifications to definition and all active instances on tabletop
      this.applyCardModifications(world, registry, defId, {
        nameTerm: newName,
        type: newType,
        value: newValue,
        visualOverrides: {
          background: newBg,
          border: newBorder,
          typography: newText,
        },
        dynamicProperties: dynamicProps,
      });

      // Recipe definition
      const ing1 = (document.getElementById('recipe-ing-1') as HTMLSelectElement).value;
      const ing2 = (document.getElementById('recipe-ing-2') as HTMLSelectElement).value;
      const duration = parseFloat((document.getElementById('recipe-duration') as HTMLInputElement).value) || 2.0;
      const consume1 = (document.getElementById('recipe-consume-1') as HTMLInputElement).checked;
      const consume2 = (document.getElementById('recipe-consume-2') as HTMLInputElement).checked;

      if (ing1 && ing2) {
        this.addOrUpdateRecipe(registry, craftingSystem, {
          resultCardId: defId,
          ingredientCardIds: [ing1, ing2],
          durationSeconds: duration,
          statusTerm: `Crafting ${defId}...`,
          consumedInputs: [consume1, consume2],
        });
      }

      this.closeEditor();
    });
  }

  static closeEditor(): void {
    if (this.activeModal) {
      this.activeModal.remove();
      this.activeModal = null;
    }
  }
}
