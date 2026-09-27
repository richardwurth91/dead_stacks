import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { CardDataComponent, TransformComponent } from '../../sim/ecs/components.js';
import { globalLocalization } from '../../mods/localization.js';

const TYPE_COLORS: Record<string, { bg: number; border: number; text: string }> = {
  Worker: { bg: 0x2e7d32, border: 0x81c784, text: '#ffffff' },
  Food: { bg: 0xe65100, border: 0xffb74d, text: '#ffffff' },
  Resource: { bg: 0x4e342e, border: 0xa1887f, text: '#ffffff' },
  Structure: { bg: 0x1565c0, border: 0x64b5f6, text: '#ffffff' },
  Mob: { bg: 0xb71c1c, border: 0xe57373, text: '#ffffff' },
  Blueprint: { bg: 0x00838f, border: 0x4dd0e1, text: '#ffffff' },
  Pack: { bg: 0x6a1b9a, border: 0xba68c8, text: '#ffffff' },
  Coin: { bg: 0xf57f17, border: 0xfff176, text: '#000000' },
  Equipment: { bg: 0x37474f, border: 0x90a4ae, text: '#ffffff' },
  Corpse: { bg: 0x212121, border: 0x757575, text: '#bdbdbd' },
};

export class PixiCardView {
  public container: Container;
  public entityId: number;
  private shadowGraphics: Graphics;
  private cardGraphics: Graphics;
  private titleText: Text;
  private typeText: Text;
  private width: number = 80;
  private height: number = 110;

  constructor(entityId: number, cardData: CardDataComponent) {
    this.entityId = entityId;
    this.container = new Container();
    this.container.label = `Card_${entityId}_${cardData.id}`;

    // Procedural drop shadow
    this.shadowGraphics = new Graphics();
    this.container.addChild(this.shadowGraphics);

    // Card face
    this.cardGraphics = new Graphics();
    this.container.addChild(this.cardGraphics);

    let bgHex = TYPE_COLORS[cardData.type]?.bg ?? 0x424242;
    let borderHex = TYPE_COLORS[cardData.type]?.border ?? 0x9e9e9e;
    let textColor = TYPE_COLORS[cardData.type]?.text ?? '#ffffff';

    if (cardData.visualOverrides) {
      if (cardData.visualOverrides.background) {
        bgHex = parseInt(cardData.visualOverrides.background.replace('#', '0x'), 16);
      }
      if (cardData.visualOverrides.border) {
        borderHex = parseInt(cardData.visualOverrides.border.replace('#', '0x'), 16);
      }
      if (cardData.visualOverrides.typography) {
        textColor = cardData.visualOverrides.typography;
      }
    }

    const localizedTitle = globalLocalization.t(cardData.nameTerm, cardData.nameTerm);

    // Card Title Text
    this.titleText = new Text({
      text: localizedTitle,
      style: new TextStyle({
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 11,
        fontWeight: 'bold',
        fill: textColor,
        wordWrap: true,
        wordWrapWidth: 70,
        align: 'center',
      }),
    });
    this.titleText.anchor.set(0.5, 0);
    this.titleText.position.set(0, -this.height / 2 + 8);
    this.container.addChild(this.titleText);

    // Card Type Badge
    this.typeText = new Text({
      text: cardData.type.toUpperCase(),
      style: new TextStyle({
        fontFamily: 'monospace',
        fontSize: 8,
        fontWeight: '600',
        fill: textColor,
        letterSpacing: 0.5,
      }),
    });
    this.typeText.anchor.set(0.5, 1);
    this.typeText.position.set(0, this.height / 2 - 6);
    this.container.addChild(this.typeText);

    // Crafting Progress Bar UI
    this.progressBarContainer = new Container();
    this.progressBarContainer.visible = false;
    this.progressBarContainer.position.set(0, -this.height / 2 - 18);

    this.progressBgGraphics = new Graphics();
    this.progressBarContainer.addChild(this.progressBgGraphics);

    this.progressFillGraphics = new Graphics();
    this.progressBarContainer.addChild(this.progressFillGraphics);

    this.progressStatusText = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 9,
        fontWeight: 'bold',
        fill: '#ffffff',
        align: 'center',
      }),
    });
    this.progressStatusText.anchor.set(0.5, 1);
    this.progressStatusText.position.set(0, -6);
    this.progressBarContainer.addChild(this.progressStatusText);

    this.container.addChild(this.progressBarContainer);

    // Health Bar UI
    this.healthBarContainer = new Container();
    this.healthBarContainer.visible = false;
    this.healthBarContainer.position.set(0, this.height / 2 - 20);

    this.healthBgGraphics = new Graphics();
    this.healthBarContainer.addChild(this.healthBgGraphics);

    this.healthFillGraphics = new Graphics();
    this.healthBarContainer.addChild(this.healthFillGraphics);

    this.healthText = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: 'monospace',
        fontSize: 7,
        fontWeight: 'bold',
        fill: '#ffffff',
      }),
    });
    this.healthText.anchor.set(0.5, 0.5);
    this.healthBarContainer.addChild(this.healthText);

    this.container.addChild(this.healthBarContainer);

    this.renderCardGraphics(bgHex, borderHex);
    this.updateShadow(0, false);
  }

  private progressBarContainer: Container;
  private progressBgGraphics: Graphics;
  private progressFillGraphics: Graphics;
  private progressStatusText: Text;

  private healthBarContainer: Container;
  private healthBgGraphics: Graphics;
  private healthFillGraphics: Graphics;
  private healthText: Text;

  public setHealth(currentHp: number, maxHp: number): void {
    this.healthBarContainer.visible = true;
    const ratio = Math.max(0, Math.min(1.0, currentHp / maxHp));
    const barWidth = 64;
    const barHeight = 8;
    const halfW = barWidth / 2;

    this.healthBgGraphics.clear();
    this.healthBgGraphics.roundRect(-halfW, -barHeight / 2, barWidth, barHeight, 3);
    this.healthBgGraphics.fill({ color: 0x3e2723, alpha: 0.9 });
    this.healthBgGraphics.stroke({ color: 0x212121, width: 1 });

    this.healthFillGraphics.clear();
    const fillW = Math.max(2, barWidth * ratio);
    this.healthFillGraphics.roundRect(-halfW, -barHeight / 2, fillW, barHeight, 3);
    const healthColor = ratio > 0.5 ? 0x4caf50 : ratio > 0.25 ? 0xff9800 : 0xf44336;
    this.healthFillGraphics.fill({ color: healthColor });

    this.healthText.text = `HP ${currentHp}/${maxHp}`;
  }

  public flashDamage(): void {
    this.container.tint = 0xff5252;
    setTimeout(() => {
      this.container.tint = 0xffffff;
    }, 150);
  }

  public setCraftingProgress(progress: number, duration: number, statusText?: string): void {
    if (progress <= 0 || duration <= 0 || progress >= duration) {
      this.progressBarContainer.visible = false;
      return;
    }

    this.progressBarContainer.visible = true;
    const ratio = Math.min(1.0, Math.max(0.0, progress / duration));
    const barWidth = 74;
    const barHeight = 7;
    const halfW = barWidth / 2;

    // Draw background
    this.progressBgGraphics.clear();
    this.progressBgGraphics.roundRect(-halfW, -barHeight / 2, barWidth, barHeight, 3);
    this.progressBgGraphics.fill({ color: 0x141419, alpha: 0.9 });
    this.progressBgGraphics.stroke({ color: 0x4a4a5a, width: 1 });

    // Draw fill
    this.progressFillGraphics.clear();
    const fillW = Math.max(4, barWidth * ratio);
    this.progressFillGraphics.roundRect(-halfW, -barHeight / 2, fillW, barHeight, 3);
    this.progressFillGraphics.fill({ color: 0x4caf50 });

    if (statusText) {
      this.progressStatusText.text = statusText;
    }
  }

  private renderCardGraphics(bgColor: number, borderColor: number): void {
    const halfW = this.width / 2;
    const halfH = this.height / 2;
    const radius = 8;

    this.cardGraphics.clear();
    // Border
    this.cardGraphics.roundRect(-halfW, -halfH, this.width, this.height, radius);
    this.cardGraphics.fill({ color: bgColor });
    this.cardGraphics.stroke({ color: borderColor, width: 2 });

    // Inner subtle card header separator
    this.cardGraphics.moveTo(-halfW + 6, -halfH + 26);
    this.cardGraphics.lineTo(halfW - 6, -halfH + 26);
    this.cardGraphics.stroke({ color: borderColor, width: 1, alpha: 0.5 });
  }

  public updateShadow(elevation: number, isDragging: boolean): void {
    const halfW = this.width / 2;
    const halfH = this.height / 2;
    const radius = 8;

    const shadowOffset = isDragging ? 12 : 2 + elevation * 1.5;
    const shadowAlpha = isDragging ? 0.35 : 0.2 + elevation * 0.05;

    this.shadowGraphics.clear();
    this.shadowGraphics.roundRect(-halfW, -halfH + shadowOffset, this.width, this.height, radius);
    this.shadowGraphics.fill({ color: 0x000000, alpha: shadowAlpha });
  }

  public syncTransform(transform: TransformComponent, isDragging: boolean): void {
    this.container.x = transform.x;
    this.container.y = transform.y;
    this.container.zIndex = isDragging ? 1000 + transform.elevation : transform.zIndex;

    const targetScale = isDragging ? 1.05 : 1.0;
    this.container.scale.set(targetScale);

    this.updateShadow(transform.elevation, isDragging);
  }

  public updateCardData(cardData: CardDataComponent): void {
    let bgHex = TYPE_COLORS[cardData.type]?.bg ?? 0x424242;
    let borderHex = TYPE_COLORS[cardData.type]?.border ?? 0x9e9e9e;
    let textColor = TYPE_COLORS[cardData.type]?.text ?? '#ffffff';

    if (cardData.visualOverrides) {
      if (cardData.visualOverrides.background) {
        bgHex = parseInt(cardData.visualOverrides.background.replace('#', '0x'), 16);
      }
      if (cardData.visualOverrides.border) {
        borderHex = parseInt(cardData.visualOverrides.border.replace('#', '0x'), 16);
      }
      if (cardData.visualOverrides.typography) {
        textColor = cardData.visualOverrides.typography;
      }
    }

    const localizedTitle = globalLocalization.t(cardData.nameTerm, cardData.nameTerm);
    this.titleText.text = localizedTitle;
    this.titleText.style.fill = textColor;

    this.typeText.text = cardData.type.toUpperCase();
    this.typeText.style.fill = textColor;

    this.renderCardGraphics(bgHex, borderHex);
  }
}
