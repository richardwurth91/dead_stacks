import { World } from '../sim/ecs/world.js';
import { SimLoop } from '../sim/loop/simLoop.js';
import { PackManager } from '../sim/economy/packManager.js';
import { CardRegistry, globalCardRegistry } from '../mods/cardRegistry.js';
import { CardFactory } from '../sim/cardFactory.js';
import { StackTopology } from '../sim/kinematics/stackTopology.js';
import { findUnoccupiedPosition } from '../sim/kinematics/placement.js';
import { SaveManager } from '../sim/serialization/saveManager.js';
import { CardEditor } from './cardEditor.js';
import { globalEventBus } from '../sim/events.js';
import cardSchema from '../../schemas/card.schema.json';
import blueprintSchema from '../../schemas/blueprint.schema.json';
import packSchema from '../../schemas/pack.schema.json';
import manifestSchema from '../../schemas/manifest.schema.json';

export class DevOverlay {
  private world: World;
  private simLoop: SimLoop;
  private packManager: PackManager;
  private registry: CardRegistry;
  private isVisible: boolean = false;
  private overlayContainer: HTMLElement | null = null;
  private selectedCardId: number | null = null;
  private activeKeys: Set<string> = new Set();

  constructor(
    world: World,
    simLoop: SimLoop,
    packManager: PackManager,
    registry: CardRegistry = globalCardRegistry
  ) {
    this.world = world;
    this.simLoop = simLoop;
    this.packManager = packManager;
    this.registry = registry;

    this.setupKeyBindings();

    globalEventBus.on('OnCardDefinitionUpdated', () => {
      if (this.isVisible) {
        const searchInput = document.getElementById('dev-search-input') as HTMLInputElement;
        this.updateCardList(searchInput ? searchInput.value.trim().toLowerCase() : '');
      }
    });
  }

  setSelectedCard(entityId: number | null): void {
    this.selectedCardId = entityId;
  }

  getSelectedCard(): number | null {
    return this.selectedCardId;
  }

  private setupKeyBindings(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e) => {
      this.activeKeys.add(e.key.toLowerCase());

      // K + O + F1 chord check or single F1 / Backquote to toggle overlay
      const hasK = this.activeKeys.has('k');
      const hasO = this.activeKeys.has('o');
      const isF1 = e.key === 'F1';

      if ((hasK && hasO && isF1) || (isF1 && !e.ctrlKey && !e.metaKey) || e.key === '`') {
        e.preventDefault();
        this.toggleOverlay();
        return;
      }

      // F2: Instant grant 5 gold coins
      if (e.key === 'F2') {
        e.preventDefault();
        this.grantCoins(5);
        return;
      }

      // F5: Quick Save
      if (e.key === 'F5') {
        e.preventDefault();
        this.quickSave();
        return;
      }

      // F6: Live JSON Schema Export
      if (e.key === 'F6') {
        e.preventDefault();
        this.exportSchemas();
        return;
      }

      // F9: Quick Load
      if (e.key === 'F9') {
        e.preventDefault();
        this.quickLoad();
        return;
      }

      // Shift + C: Duplicate currently selected card stack
      if (e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        this.duplicateSelectedStack();
        return;
      }

      // E: Open card attribute & recipe editor for selected card
      if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey && this.selectedCardId !== null) {
        const cardData = this.world.getComponent(this.selectedCardId, 'cardData');
        if (cardData) {
          e.preventDefault();
          CardEditor.openEditor(cardData.id, this.world, this.registry, this.simLoop.craftingSystem);
          return;
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.activeKeys.delete(e.key.toLowerCase());
    });
  }

  toggleOverlay(): void {
    if (typeof document === 'undefined') return;
    this.isVisible = !this.isVisible;
    if (this.isVisible) {
      this.renderOverlay();
    } else {
      this.destroyOverlay();
    }
  }

  grantCoins(count: number = 5, originX?: number, originY?: number): void {
    const cx = originX ?? (typeof window !== 'undefined' ? window.innerWidth / 2 : 400);
    const cy = originY ?? (typeof window !== 'undefined' ? window.innerHeight / 2 : 400);

    for (let i = 0; i < count; i++) {
      const pos = findUnoccupiedPosition(this.world, cx + (i * 30 - 60), cy + 40);
      CardFactory.createFromRegistry(this.world, 'coin', pos.x, pos.y, this.registry);
    }
    this.showToast(`✨ Injected ${count} Gold Coins!`);
  }

  duplicateSelectedStack(): boolean {
    if (this.selectedCardId === null || !this.world.hasComponent(this.selectedCardId, 'cardData')) {
      this.showToast('⚠️ No card selected! Click a card first, then press Shift+C.');
      return false;
    }

    const node = this.world.getComponent(this.selectedCardId, 'stackNode');
    const rootId = node ? node.stackRootId : this.selectedCardId;
    const stack = StackTopology.getStackArray(this.world, rootId);
    if (stack.length === 0) return false;

    const rootTransform = this.world.getComponent(rootId, 'transform');
    const defaultX = typeof window !== 'undefined' ? window.innerWidth / 2 : 400;
    const defaultY = typeof window !== 'undefined' ? window.innerHeight / 2 : 400;
    const startX = rootTransform ? rootTransform.x + 95 : defaultX;
    const startY = rootTransform ? rootTransform.y : defaultY;
    const targetPos = findUnoccupiedPosition(this.world, startX, startY);

    let prevNewEntity: number | null = null;

    for (let i = 0; i < stack.length; i++) {
      const sourceId = stack[i];
      const sourceCard = this.world.getComponent(sourceId, 'cardData')!;
      const yOffset = i * 28;

      const newId = CardFactory.createCard(this.world, {
        defId: sourceCard.id,
        nameTerm: sourceCard.nameTerm,
        descriptionTerm: sourceCard.descriptionTerm,
        type: sourceCard.type,
        x: targetPos.x,
        y: targetPos.y + yOffset,
        value: sourceCard.value,
        cardLimitCost: sourceCard.cardLimitCost,
        dynamicProperties: { ...sourceCard.dynamicProperties },
        visualOverrides: sourceCard.visualOverrides ? { ...sourceCard.visualOverrides } : undefined,
      });

      if (i > 0 && prevNewEntity !== null) {
        StackTopology.attachSubStack(this.world, prevNewEntity, newId);
      }
      prevNewEntity = newId;
    }

    this.showToast(`✨ Duplicated stack of ${stack.length} card(s)!`);
    return true;
  }

  exportSchemas(): void {
    const bundle = {
      card: cardSchema,
      blueprint: blueprintSchema,
      pack: packSchema,
      manifest: manifestSchema,
    };
    const jsonStr = JSON.stringify(bundle, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `village_engine_schemas_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast('📜 Exported JSON Schemas (card, blueprint, pack, manifest)!');
  }

  quickSave(): void {
    SaveManager.saveToLocalStorage(this.world, this.simLoop, this.packManager);
    this.showToast('💾 Quick Saved Board State!');
  }

  quickLoad(): void {
    const success = SaveManager.loadFromLocalStorage(this.world, this.simLoop, this.packManager, 'village_card_engine_quicksave', this.registry);
    if (success) {
      this.showToast('📂 Quick Loaded Board State!');
    } else {
      this.showToast('⚠️ No Quick Save found in storage!');
    }
  }

  private renderOverlay(): void {
    this.destroyOverlay();

    const overlay = document.createElement('div');
    overlay.id = 'dev-overlay-modal';
    overlay.style.cssText = `
      position: fixed;
      top: 60px;
      right: 20px;
      width: 420px;
      max-height: calc(100vh - 80px);
      background: rgba(18, 18, 24, 0.95);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6);
      z-index: 1000;
      display: flex;
      flex-direction: column;
      color: #e2e8f0;
      font-family: system-ui, sans-serif;
      overflow: hidden;
    `;

    overlay.innerHTML = `
      <div style="padding: 12px 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); display: flex; align-items: center; justify-content: space-between; background: rgba(255, 255, 255, 0.03);">
        <div style="font-weight: 700; font-size: 14px; display: flex; align-items: center; gap: 8px;">
          🛠️ Dev Tools & Card Spawner
          <span style="font-size: 10px; background: #6366f1; padding: 2px 6px; border-radius: 4px;">F1 / \`</span>
        </div>
        <button id="dev-close-btn" style="background: none; border: none; color: #94a3b8; font-size: 18px; cursor: pointer;">✕</button>
      </div>

      <div style="padding: 12px 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); display: flex; flex-direction: column; gap: 8px;">
        <input id="dev-search-input" type="text" placeholder="🔍 Search cards by name, ID, or tag..." style="
          width: 100%;
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 6px;
          padding: 8px 12px;
          color: #ffffff;
          font-size: 12px;
          outline: none;
        " />
        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
          <button class="dev-quick-btn" id="btn-quick-edit">🎨 Edit Card (E)</button>
          <button class="dev-quick-btn" id="btn-quick-coin">💰 +5 Coins (F2)</button>
          <button class="dev-quick-btn" id="btn-quick-dup">📑 Duplicate (Shift+C)</button>
          <button class="dev-quick-btn" id="btn-quick-skip">🌙 Advance Moon</button>
          <button class="dev-quick-btn" id="btn-quick-save">💾 Save (F5)</button>
          <button class="dev-quick-btn" id="btn-quick-load">📂 Load (F9)</button>
          <button class="dev-quick-btn" id="btn-export-schemas">📜 Schemas (F6)</button>
          <button class="dev-quick-btn" id="btn-export-save">⬇️ Export Save</button>
        </div>
      </div>

      <div id="dev-card-list" style="
        flex: 1;
        overflow-y: auto;
        padding: 8px 16px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 380px;
      ">
      </div>

      <div style="padding: 8px 16px; background: rgba(0, 0, 0, 0.3); border-top: 1px solid rgba(255, 255, 255, 0.06); font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between;">
        <span>Hotkeys: F1 (Menu) | E (Edit Card) | F2 (+5G) | Shift+C (Clone) | F5/F9 (Save/Load)</span>
      </div>
    `;

    document.body.appendChild(overlay);
    this.overlayContainer = overlay;

    // Attach event listeners
    document.getElementById('dev-close-btn')?.addEventListener('click', () => this.toggleOverlay());
    document.getElementById('btn-quick-edit')?.addEventListener('click', () => {
      let targetDefId: string | null = null;
      if (this.selectedCardId !== null) {
        const cardData = this.world.getComponent(this.selectedCardId, 'cardData');
        if (cardData) targetDefId = cardData.id;
      }
      if (!targetDefId) {
        const allCards = this.registry.getAllCards();
        if (allCards.length > 0) targetDefId = allCards[0].id;
      }
      if (targetDefId) {
        CardEditor.openEditor(targetDefId, this.world, this.registry, this.simLoop.craftingSystem);
      }
    });
    document.getElementById('btn-quick-coin')?.addEventListener('click', () => this.grantCoins(5));
    document.getElementById('btn-quick-dup')?.addEventListener('click', () => this.duplicateSelectedStack());
    document.getElementById('btn-quick-save')?.addEventListener('click', () => this.quickSave());
    document.getElementById('btn-quick-load')?.addEventListener('click', () => this.quickLoad());
    document.getElementById('btn-export-schemas')?.addEventListener('click', () => this.exportSchemas());
    document.getElementById('btn-export-save')?.addEventListener('click', () => {
      SaveManager.exportToJsonFile(this.world, this.simLoop, this.packManager);
      this.showToast('⬇️ Save JSON exported!');
    });
    document.getElementById('btn-quick-skip')?.addEventListener('click', () => {
      this.simLoop.moonSystem.update(125);
      this.showToast('🌙 Advanced Moon cycle to trigger feeding!');
    });

    const searchInput = document.getElementById('dev-search-input') as HTMLInputElement;
    searchInput?.addEventListener('input', () => {
      this.updateCardList(searchInput.value.trim().toLowerCase());
    });
    searchInput?.focus();

    // Add CSS style for buttons in dev overlay
    const styleElem = document.createElement('style');
    styleElem.id = 'dev-overlay-styles';
    styleElem.textContent = `
      .dev-quick-btn {
        background: #2a2a36;
        border: 1px solid #3d3d4e;
        color: #cbd5e1;
        padding: 4px 8px;
        font-size: 11px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .dev-quick-btn:hover {
        background: #3b82f6;
        color: #ffffff;
        border-color: #60a5fa;
      }
      .dev-card-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(255, 255, 255, 0.04);
        padding: 6px 10px;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.05);
      }
      .dev-card-row:hover {
        background: rgba(255, 255, 255, 0.08);
      }
    `;
    document.head.appendChild(styleElem);

    this.updateCardList('');
  }

  private updateCardList(filter: string): void {
    const listElem = document.getElementById('dev-card-list');
    if (!listElem) return;

    listElem.innerHTML = '';
    const cards = this.registry.getAllCards();

    const filtered = cards.filter((card) => {
      if (!filter) return true;
      if (card.id.toLowerCase().includes(filter)) return true;
      if (card.nameTerm.toLowerCase().includes(filter)) return true;
      if (card.type.toLowerCase().includes(filter)) return true;
      if (card.tags?.some((t) => t.toLowerCase().includes(filter))) return true;
      return false;
    });

    if (filtered.length === 0) {
      listElem.innerHTML = `<div style="text-align: center; color: #64748b; font-size: 12px; padding: 20px;">No cards found matching "${filter}"</div>`;
      return;
    }

    for (const card of filtered) {
      const row = document.createElement('div');
      row.className = 'dev-card-row';

      const typeColors: Record<string, string> = {
        Worker: '#3b82f6',
        Food: '#10b981',
        Resource: '#f59e0b',
        Structure: '#8b5cf6',
        Mob: '#ef4444',
        Coin: '#fbbf24',
        Pack: '#ec4899',
        Corpse: '#64748b',
      };
      const badgeColor = typeColors[card.type] || '#94a3b8';

      row.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <div style="font-weight: 600; font-size: 12px; display: flex; align-items: center; gap: 6px;">
            ${card.id}
            <span style="font-size: 9px; padding: 1px 5px; border-radius: 3px; background: ${badgeColor}; color: #ffffff;">${card.type}</span>
          </div>
          <div style="font-size: 10px; color: #94a3b8;">${card.nameTerm} • Val: ${card.value}</div>
        </div>
        <div style="display: flex; gap: 4px;">
          <button class="dev-quick-btn edit-btn" data-id="${card.id}" style="border-color: #6366f1; color: #a5b4fc;">🎨 Edit</button>
          <button class="dev-quick-btn spawn-btn" data-id="${card.id}">+ Spawn</button>
        </div>
      `;

      row.querySelector('.edit-btn')?.addEventListener('click', () => {
        CardEditor.openEditor(card.id, this.world, this.registry, this.simLoop.craftingSystem);
      });

      row.querySelector('.spawn-btn')?.addEventListener('click', () => {
        const center = findUnoccupiedPosition(this.world, window.innerWidth / 2, window.innerHeight / 2);
        CardFactory.createFromRegistry(this.world, card.id, center.x, center.y, this.registry);
        this.showToast(`✨ Spawned ${card.id}!`);
      });

      listElem.appendChild(row);
    }
  }

  private destroyOverlay(): void {
    if (this.overlayContainer) {
      this.overlayContainer.remove();
      this.overlayContainer = null;
    }
    document.getElementById('dev-overlay-styles')?.remove();
  }

  showToast(message: string, durationMs: number = 2500): void {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById('dev-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'dev-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 24px;
      background: rgba(15, 23, 42, 0.95);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.3);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      font-family: system-ui, sans-serif;
      z-index: 2000;
      pointer-events: none;
      animation: fadeInOut 2.5s ease forwards;
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, durationMs);
  }
}
