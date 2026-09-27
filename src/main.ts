import { Application } from 'pixi.js';
import { World } from './sim/ecs/world.js';
import { SimLoop, TimeScaleMode } from './sim/loop/simLoop.js';
import { CardFactory } from './sim/cardFactory.js';
import { PixiCardView } from './render/cards/pixiCard.js';
import { DragManager } from './render/input/dragManager.js';
import { globalEventBus } from './sim/events.js';
import { getArchimedeanSpiralOffsets } from './sim/kinematics/repulsion.js';
import { ModLoader } from './mods/modLoader.js';
import { globalCardRegistry } from './mods/cardRegistry.js';
import { globalLocalization } from './mods/localization.js';
import { PackManager } from './sim/economy/packManager.js';
import { SellSystem } from './sim/economy/sellSystem.js';
import { DevOverlay } from './tools/devOverlay.js';
import { findUnoccupiedPosition } from './sim/kinematics/placement.js';

async function bootstrap() {
  const container = document.getElementById('canvas-wrapper')!;
  const cardCounter = document.getElementById('card-counter')!;
  const moonTimer = document.getElementById('moon-timer')!;
  const foodStatus = document.getElementById('food-status')!;
  const langToggleBtn = document.getElementById('lang-toggle')!;
  const sellZoneElem = document.getElementById('sell-zone')!;
  const btnHudDev = document.getElementById('btn-hud-dev');
  const btnHudSave = document.getElementById('btn-hud-save');
  const btnHudLoad = document.getElementById('btn-hud-load');

  // 1. Ingest External Mods from /Mods directory
  const modResult = await ModLoader.loadAllViteMods();
  if (modResult.errors.length > 0) {
    console.warn('[ModLoader] Warnings during mod ingestion:', modResult.errors);
  }

  // 2. Initialize Pixi.js Application
  const app = new Application();
  await app.init({
    resizeTo: container,
    backgroundColor: 0x1b1c22,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  container.appendChild(app.canvas);
  app.stage.sortableChildren = true;

  // 3. Initialize Simulation Engine
  const world = new World();
  const simLoop = new SimLoop(world);
  const dragManager = new DragManager(world);
  const packManager = new PackManager(world, globalCardRegistry);
  const devOverlay = new DevOverlay(world, simLoop, packManager, globalCardRegistry);

  const cardViews = new Map<number, PixiCardView>();

  // 4. Entity-to-View Synchronization Hooks
  globalEventBus.on('OnCardSpawned', ({ entityId }) => {
    const cardData = world.getComponent(entityId, 'cardData');
    if (!cardData) return;

    const cardView = new PixiCardView(entityId, cardData);
    cardView.container.eventMode = 'static';
    cardView.container.cursor = 'grab';

    cardView.container.on('pointerdown', (event) => {
      const pos = event.getLocalPosition(app.stage);
      devOverlay.setSelectedCard(entityId);
      dragManager.startDrag(entityId, pos.x, pos.y);
      cardView.container.cursor = 'grabbing';
    });

    app.stage.addChild(cardView.container);
    cardViews.set(entityId, cardView);
    updateStatsHUD();
  });

  globalEventBus.on('OnCardDestroyed', ({ entityId }) => {
    const view = cardViews.get(entityId);
    if (view) {
      app.stage.removeChild(view.container);
      view.container.destroy({ children: true });
      cardViews.delete(entityId);
    }
    updateStatsHUD();
  });

  // Card Definition Live-Update Visual Hook
  globalEventBus.on('OnCardDefinitionUpdated', ({ defId }) => {
    for (const [entityId, view] of cardViews.entries()) {
      const cardData = world.getComponent(entityId, 'cardData');
      if (cardData && cardData.id === defId) {
        view.updateCardData(cardData);
      }
    }
    updateStatsHUD();
  });

  // Crafting Progress Visual Hook
  globalEventBus.on('OnRecipeProgress', ({ stackRootId, progress, duration }) => {
    const view = cardViews.get(stackRootId);
    if (view) {
      const craft = world.getComponent(stackRootId, 'crafting');
      const statusText = craft ? globalLocalization.t(craft.statusTerm, craft.statusTerm) : '';
      view.setCraftingProgress(progress, duration, statusText);
    }
  });

  globalEventBus.on('OnRecipeCompleted', ({ stackRootId }) => {
    const view = cardViews.get(stackRootId);
    if (view) {
      view.setCraftingProgress(0, 0);
    }
    updateStatsHUD();
  });

  // Moon Phase & Sustenance HUD Hook
  globalEventBus.on('OnMoonPhaseChanged', ({ moonNumber, timeRemaining, isFeeding }) => {
    const mins = Math.floor(timeRemaining / 60);
    const secs = Math.floor(timeRemaining % 60);
    const timeFormatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

    if (moonTimer) {
      moonTimer.textContent = isFeeding
        ? `🌕 Moon ${moonNumber} (Feeding!)`
        : `🌙 Moon ${moonNumber} (${timeFormatted})`;
    }
    updateStatsHUD();
  });

  // Combat Skirmish Round Hook
  globalEventBus.on('OnCombatRoundResolved', ({ targetId, damage, isCrit }) => {
    const targetView = cardViews.get(targetId);
    if (targetView) {
      targetView.flashDamage();
      const combat = world.getComponent(targetId, 'combatant');
      if (combat) {
        targetView.setHealth(combat.health, combat.maxHealth);
      }
    }
    console.log(`[Skirmish] Target ${targetId} took ${damage} damage (Critical: ${isCrit})`);
    updateStatsHUD();
  });

  function updateStatsHUD() {
    // Card Capacity
    const totalCards = simLoop.moonSystem.getTotalCardCount();
    const maxCards = simLoop.moonSystem.getMaxCards();
    const isOver = totalCards > maxCards;

    if (cardCounter) {
      cardCounter.textContent = `Cards: ${totalCards} / ${maxCards}`;
      cardCounter.style.color = isOver ? '#ef5350' : '#a0a0b2';
      cardCounter.style.fontWeight = isOver ? 'bold' : 'normal';
    }

    // Food demand vs available
    const cards = world.query('cardData');
    let foodDemand = 0;
    let foodAvailable = 0;

    for (const id of cards) {
      const card = world.getComponent(id, 'cardData')!;
      if (card.type === 'Worker') {
        foodDemand += card.dynamicProperties._FoodDemand ?? 1;
      } else if (card.type === 'Food') {
        foodAvailable += card.dynamicProperties._FoodValue ?? 1;
      }
    }

    if (foodStatus) {
      foodStatus.textContent = `🥗 Food: ${foodAvailable} / ${foodDemand}`;
      foodStatus.style.color = foodAvailable < foodDemand ? '#ffb74d' : '#81c784';
    }
  }

  // 5. Global Pointer Drag-and-Drop Handling
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;

  app.stage.on('pointermove', (event) => {
    if (dragManager.isDragging()) {
      const pos = event.getLocalPosition(app.stage);
      dragManager.onPointerMove(pos.x, pos.y);
    }
  });

  const handlePointerUp = () => {
    if (dragManager.isDragging()) {
      const draggedSubtree = dragManager.getDraggedSubtree();
      const draggedRoot = draggedSubtree[0];

      for (const id of draggedSubtree) {
        const view = cardViews.get(id);
        if (view) view.container.cursor = 'grab';
      }

      // Check if dropped into the Sell Zone
      if (draggedRoot && sellZoneElem) {
        const rootTransform = world.getComponent(draggedRoot, 'transform');
        if (rootTransform) {
          const sellRect = sellZoneElem.getBoundingClientRect();
          if (
            rootTransform.x >= sellRect.left &&
            rootTransform.x <= sellRect.right &&
            rootTransform.y >= sellRect.top &&
            rootTransform.y <= sellRect.bottom
          ) {
            if (SellSystem.canSell(world, draggedRoot)) {
              SellSystem.sellCard(world, draggedRoot, rootTransform.x, rootTransform.y);
              dragManager.endDrag();
              return;
            }
          }
        }
      }

      const dropResult = dragManager.endDrag();

      // Check if dropped on a Pack or if Pack can open
      if (dropResult.attached && dropResult.targetId !== null) {
        const node = world.getComponent(dropResult.targetId, 'stackNode');
        const packRootId = node ? node.stackRootId : dropResult.targetId;
        if (packManager.canOpenPack(packRootId)) {
          // Open pack automatically with a slight delay for tactile feel
          setTimeout(() => {
            if (world.hasComponent(packRootId, 'cardData')) {
              packManager.openPack(packRootId);
            }
          }, 200);
        }
      }
    }
  };

  app.stage.on('pointerup', handlePointerUp);
  app.stage.on('pointerupoutside', handlePointerUp);

  // 6. Spawn Helper Function (Uses Card Registry from loaded mods)
  function spawnCard(defId: string, x?: number, y?: number) {
    const screenCenter = {
      x: app.screen.width / 2 + (Math.random() * 80 - 40),
      y: app.screen.height / 2 + (Math.random() * 80 - 40),
    };
    const preferredX = x ?? screenCenter.x;
    const preferredY = y ?? screenCenter.y;
    const pos = findUnoccupiedPosition(world, preferredX, preferredY);

    if (globalCardRegistry.hasCard(defId)) {
      return CardFactory.createFromRegistry(world, defId, pos.x, pos.y);
    } else {
      return CardFactory.createCard(world, {
        defId,
        nameTerm: defId,
        type: 'Resource',
        x: pos.x,
        y: pos.y,
      });
    }
  }

  // 7. Spawn Initial Starting Cards from the Core Mod
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;

  spawnCard('villager', centerX - 180, centerY - 60);
  spawnCard('berry_bush', centerX - 60, centerY - 60);
  spawnCard('wood', centerX + 60, centerY - 60);
  spawnCard('wood', centerX + 180, centerY - 60);
  spawnCard('rock', centerX - 120, centerY + 80);
  spawnCard('coin', centerX, centerY + 80);
  spawnCard('coin', centerX + 40, centerY + 80);
  spawnCard('pack_humble_beginnings', centerX + 160, centerY + 80);

  // 8. HUD Button Listeners
  btnHudDev?.addEventListener('click', () => {
    devOverlay.toggleOverlay();
  });

  btnHudSave?.addEventListener('click', () => {
    devOverlay.quickSave();
  });

  btnHudLoad?.addEventListener('click', () => {
    devOverlay.quickLoad();
  });

  document.getElementById('spawn-worker')?.addEventListener('click', () => {
    spawnCard('villager');
  });

  document.getElementById('spawn-mob')?.addEventListener('click', () => {
    spawnCard('goblin');
  });

  document.getElementById('spawn-bush')?.addEventListener('click', () => {
    spawnCard('berry_bush');
  });

  document.getElementById('spawn-resource')?.addEventListener('click', () => {
    spawnCard('wood');
  });

  document.getElementById('spawn-food')?.addEventListener('click', () => {
    spawnCard('berry');
  });

  document.getElementById('spawn-pack')?.addEventListener('click', () => {
    spawnCard('pack_humble_beginnings');
  });

  document.getElementById('spawn-spiral')?.addEventListener('click', () => {
    const allDefs = globalCardRegistry.getAllCards();
    const count = 8;
    const offsets = getArchimedeanSpiralOffsets(count, 85, 20);
    const originX = app.screen.width / 2;
    const originY = app.screen.height / 2;

    for (let i = 0; i < count; i++) {
      const def = allDefs[i % allDefs.length];
      spawnCard(def.id, originX + offsets[i].x, originY + offsets[i].y);
    }
  });

  // Language Switcher
  if (langToggleBtn) {
    langToggleBtn.addEventListener('click', () => {
      const currentLang = globalLocalization.getLanguage();
      const newLang = currentLang === 'en' ? 'es' : 'en';
      globalLocalization.setLanguage(newLang);
      langToggleBtn.textContent = `🌐 ${newLang.toUpperCase()}`;

      // Refresh card views with new language
      for (const [entityId, view] of cardViews.entries()) {
        const cardData = world.getComponent(entityId, 'cardData');
        if (cardData) {
          app.stage.removeChild(view.container);
          view.container.destroy({ children: true });
          const newView = new PixiCardView(entityId, cardData);
          newView.container.eventMode = 'static';
          newView.container.cursor = 'grab';
          newView.container.on('pointerdown', (event) => {
            const pos = event.getLocalPosition(app.stage);
            dragManager.startDrag(entityId, pos.x, pos.y);
            newView.container.cursor = 'grabbing';
          });
          app.stage.addChild(newView.container);
          cardViews.set(entityId, newView);
        }
      }
    });
  }

  // Time Scale Buttons
  const timeButtons = document.querySelectorAll('#time-controls .btn');
  timeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      timeButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const speed = parseInt(btn.getAttribute('data-speed') || '1', 10) as TimeScaleMode;
      simLoop.setTimeScale(speed);
    });
  });

  // 9. Main Render & Simulation Update Loop
  app.ticker.add((ticker) => {
    const deltaSeconds = ticker.deltaTime / 60;
    simLoop.update(deltaSeconds);

    const draggedSubtree = new Set(dragManager.getDraggedSubtree());

    for (const [entityId, view] of cardViews.entries()) {
      const transform = world.getComponent(entityId, 'transform');
      if (transform) {
        const isDragging = draggedSubtree.has(entityId);
        view.syncTransform(transform, isDragging);
      }
      const combat = world.getComponent(entityId, 'combatant');
      if (combat) {
        view.setHealth(combat.health, combat.maxHealth);
      }
    }
  });
}

bootstrap().catch(console.error);
