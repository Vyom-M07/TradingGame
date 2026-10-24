import * as Phaser from 'phaser';

export interface PlayerData {
  identityHex: string;
  username: string;
  cashBalance: number; // in cents
  x: number; // grid x: 0..19
  y: number; // grid y: 0..10
  direction: string;
  isBot?: boolean;
}

export interface TradingPitSceneConfig {
  onPlayerMove?: (x: number, y: number, direction: string) => void;
  onTogglePitOverlay?: (open?: boolean) => void;
  onProximityChange?: (inPit: boolean) => void;
  myIdentityHex?: string;
}

export class TradingPitScene extends Phaser.Scene {
  // Tile dimensions (32x32 px grid, 20x11 room = 640x352, centered in 640x360)
  public static readonly TILE_SIZE = 32;
  public static readonly COLS = 20;
  public static readonly ROWS = 11;
  public static readonly OFFSET_Y = 4; // center 352px height vertically in 360px

  // Trading Pit 4x4 area in the center: cols 8..11, rows 4..7
  public static readonly PIT_MIN_X = 8;
  public static readonly PIT_MAX_X = 11;
  public static readonly PIT_MIN_Y = 4;
  public static readonly PIT_MAX_Y = 7;

  // Proximity zone: cols 7..12, rows 3..8
  public static readonly PROX_MIN_X = 7;
  public static readonly PROX_MAX_X = 12;
  public static readonly PROX_MIN_Y = 3;
  public static readonly PROX_MAX_Y = 8;

  // Configuration callbacks
  private configCallbacks: TradingPitSceneConfig = {};

  // Local player state
  private localGridX = 3;
  private localGridY = 5;
  private localDirection = 'right';
  private isMoving = false;
  private isInsidePitProximity = false;
  private myIdentityHex = '';

  // Input keys
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
    E: Phaser.Input.Keyboard.Key;
    ESC: Phaser.Input.Keyboard.Key;
  };

  // Sprites & Containers
  private playerContainers: Map<string, Phaser.GameObjects.Container> = new Map();
  private localPlayerContainer!: Phaser.GameObjects.Container;
  private pitPromptContainer!: Phaser.GameObjects.Container;
  private tickerText!: Phaser.GameObjects.Text;
  private tickerBanner!: string;

  constructor() {
    super({ key: 'TradingPitScene' });
  }

  public init(data: TradingPitSceneConfig) {
    this.configCallbacks = data || {};
    if (data?.myIdentityHex) {
      this.myIdentityHex = data.myIdentityHex;
    }
  }

  public setCallbacks(callbacks: TradingPitSceneConfig) {
    this.configCallbacks = { ...this.configCallbacks, ...callbacks };
    if (callbacks.myIdentityHex) {
      this.myIdentityHex = callbacks.myIdentityHex;
    }
  }

  public preload() {
    // Generate all procedural retro 32x32 pixel textures in memory
    this.generatePixelTextures();
  }

  public create() {
    // 1. Draw floor and room architecture
    this.createRoomGeometry();

    // 2. Draw 4x4 Trading Pit
    this.createTradingPit();

    // 3. Create Wall Street electronic ticker board on top row
    this.createTickerBoard();

    // 4. Setup keyboard controls
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = {
        W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        E: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
        ESC: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
      };

      // Listen for 'E' key press to toggle Trading Pit overlay
      this.wasd.E.on('down', () => {
        if (this.isInsidePitProximity) {
          this.configCallbacks.onTogglePitOverlay?.();
        }
      });
    }

    // 5. Create Pit interaction prompt (floats over pit center)
    this.createPitPrompt();

    // 6. Create local player container
    this.createLocalPlayerSprite();
  }

  /**
   * Procedural Pixel Art Generator:
   * Generates crisp 32x32 textures using Phaser's dynamic canvas graphics.
   */
  private generatePixelTextures() {
    // 1. Floor tile (32x32 rich charcoal slate with grid seam)
    if (!this.textures.exists('tex_floor')) {
      const g = this.make.graphics({ x: 0, y: 0 });
      g.fillStyle(0x0f172a, 1);
      g.fillRect(0, 0, 32, 32);
      g.lineStyle(1, 0x1e293b, 0.8);
      g.strokeRect(0, 0, 32, 32);
      // Small retro speckle
      g.fillStyle(0x334155, 0.5);
      g.fillRect(8, 8, 2, 2);
      g.fillRect(24, 24, 2, 2);
      g.generateTexture('tex_floor', 32, 32);
      g.destroy();
    }

    // 2. Wall tile (32x32 dark steel with brass rivets)
    if (!this.textures.exists('tex_wall')) {
      const g = this.make.graphics({ x: 0, y: 0 });
      g.fillStyle(0x090d16, 1);
      g.fillRect(0, 0, 32, 32);
      g.fillStyle(0x1e293b, 1);
      g.fillRect(0, 26, 32, 6);
      g.lineStyle(1, 0x3b82f6, 0.3);
      g.strokeRect(0, 0, 32, 26);
      // Brass rivet
      g.fillStyle(0xf59e0b, 0.8);
      g.fillCircle(4, 4, 1.5);
      g.fillCircle(28, 4, 1.5);
      g.generateTexture('tex_wall', 32, 32);
      g.destroy();
    }

    // 3. Trading Pit floor tile (32x32 neon emerald carpet)
    if (!this.textures.exists('tex_pit_floor')) {
      const g = this.make.graphics({ x: 0, y: 0 });
      g.fillStyle(0x064e3b, 1); // Dark emerald
      g.fillRect(0, 0, 32, 32);
      g.fillStyle(0x059669, 0.4);
      g.fillRect(4, 4, 24, 24);
      g.lineStyle(1, 0x10b981, 0.8);
      g.strokeRect(2, 2, 28, 28);
      // Center gold cross
      g.fillStyle(0xf59e0b, 0.6);
      g.fillRect(15, 13, 2, 6);
      g.fillRect(13, 15, 6, 2);
      g.generateTexture('tex_pit_floor', 32, 32);
      g.destroy();
    }

    // 4. Human Trader Pixel Sprite (32x32 retro financial trader in suit)
    if (!this.textures.exists('tex_trader')) {
      const g = this.make.graphics({ x: 0, y: 0 });
      // Hair (dark brown)
      g.fillStyle(0x451a03, 1);
      g.fillRect(11, 4, 10, 4);
      // Face (skin tone)
      g.fillStyle(0xfcd34d, 1);
      g.fillRect(11, 8, 10, 6);
      // Sunglasses / eyes
      g.fillStyle(0x0f172a, 1);
      g.fillRect(13, 9, 2, 2);
      g.fillRect(17, 9, 2, 2);
      // Navy Suit jacket
      g.fillStyle(0x1e3a8a, 1);
      g.fillRect(9, 14, 14, 10);
      // White shirt collar & red tie
      g.fillStyle(0xffffff, 1);
      g.fillRect(14, 14, 4, 4);
      g.fillStyle(0xef4444, 1); // Red power tie
      g.fillRect(15, 16, 2, 6);
      // Briefcase in right hand
      g.fillStyle(0x78350f, 1);
      g.fillRect(23, 18, 5, 4);
      g.fillStyle(0xf59e0b, 1);
      g.fillRect(24, 17, 3, 1);
      // Trousers (charcoal)
      g.fillStyle(0x1e293b, 1);
      g.fillRect(11, 24, 4, 6);
      g.fillRect(17, 24, 4, 6);
      // Black shoes
      g.fillStyle(0x020617, 1);
      g.fillRect(10, 30, 5, 2);
      g.fillRect(17, 30, 5, 2);
      g.generateTexture('tex_trader', 32, 32);
      g.destroy();
    }

    // 5. The Whale AI Bot Sprite (32x32 gold / cyber cyborg trader)
    if (!this.textures.exists('tex_whale_bot')) {
      const g = this.make.graphics({ x: 0, y: 0 });
      // Cyber Crown / Antenna
      g.fillStyle(0x8b5cf6, 1);
      g.fillRect(14, 2, 4, 4);
      // Golden Whale Head
      g.fillStyle(0xf59e0b, 1);
      g.fillRect(8, 6, 16, 10);
      // Cyber neon visor (cyan glowing)
      g.fillStyle(0x06b6d4, 1);
      g.fillRect(10, 9, 12, 3);
      // Purple velvet suit
      g.fillStyle(0x581c87, 1);
      g.fillRect(8, 16, 16, 9);
      // Diamond medallion
      g.fillStyle(0x38bdf8, 1);
      g.fillRect(14, 18, 4, 4);
      // Gold cane
      g.fillStyle(0xfef08a, 1);
      g.fillRect(24, 14, 2, 14);
      g.fillCircle(25, 13, 3);
      // Cyber boots
      g.fillStyle(0xd97706, 1);
      g.fillRect(10, 25, 4, 7);
      g.fillRect(18, 25, 4, 7);
      g.generateTexture('tex_whale_bot', 32, 32);
      g.destroy();
    }
  }

  /**
   * Builds the 20x11 room floor and perimeter
   */
  private createRoomGeometry() {
    for (let r = 0; r < TradingPitScene.ROWS; r++) {
      for (let c = 0; c < TradingPitScene.COLS; c++) {
        const x = c * TradingPitScene.TILE_SIZE + 16;
        const y = r * TradingPitScene.TILE_SIZE + 16 + TradingPitScene.OFFSET_Y;

        if (r === 0) {
          // Row 0 is the north wall with LED display
          this.add.image(x, y, 'tex_wall');
        } else {
          // Regular floor
          this.add.image(x, y, 'tex_floor');
        }
      }
    }

    // Room borders (subtle neon boundary)
    const bounds = this.add.graphics();
    bounds.lineStyle(2, 0x3b82f6, 0.4);
    bounds.strokeRect(
      1,
      TradingPitScene.TILE_SIZE + TradingPitScene.OFFSET_Y,
      TradingPitScene.COLS * TradingPitScene.TILE_SIZE - 2,
      (TradingPitScene.ROWS - 1) * TradingPitScene.TILE_SIZE - 2
    );
  }

  /**
   * Builds the 4x4 Trading Pit in the center (cols 8..11, rows 4..7)
   */
  private createTradingPit() {
    const startX = TradingPitScene.PIT_MIN_X * TradingPitScene.TILE_SIZE;
    const startY = TradingPitScene.PIT_MIN_Y * TradingPitScene.TILE_SIZE + TradingPitScene.OFFSET_Y;
    const width = 4 * TradingPitScene.TILE_SIZE;
    const height = 4 * TradingPitScene.TILE_SIZE;

    // Pit carpet tiles
    for (let r = TradingPitScene.PIT_MIN_Y; r <= TradingPitScene.PIT_MAX_Y; r++) {
      for (let c = TradingPitScene.PIT_MIN_X; c <= TradingPitScene.PIT_MAX_X; c++) {
        const x = c * TradingPitScene.TILE_SIZE + 16;
        const y = r * TradingPitScene.TILE_SIZE + 16 + TradingPitScene.OFFSET_Y;
        this.add.image(x, y, 'tex_pit_floor');
      }
    }

    // Pit Brass / Neon Railing
    const railing = this.add.graphics();
    railing.lineStyle(3, 0xf59e0b, 0.9); // Gold brass railing
    railing.strokeRect(startX + 2, startY + 2, width - 4, height - 4);

    // Glowing inner neon outline
    railing.lineStyle(1, 0x10b981, 0.7);
    railing.strokeRect(startX + 6, startY + 6, width - 12, height - 12);

    // Corner brass posts
    const corners = [
      { x: startX + 3, y: startY + 3 },
      { x: startX + width - 3, y: startY + 3 },
      { x: startX + 3, y: startY + height - 3 },
      { x: startX + width - 3, y: startY + height - 3 },
    ];
    corners.forEach(cp => {
      railing.fillStyle(0xf59e0b, 1);
      railing.fillCircle(cp.x, cp.y, 4);
      railing.fillStyle(0x10b981, 1);
      railing.fillCircle(cp.x, cp.y, 2);
    });

    // Central Pit Emblem Text
    const pitCenterText = this.add.text(
      startX + width / 2,
      startY + height / 2 - 8,
      'TRADING PIT\nCLOB',
      {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '9px',
        color: '#10b981',
        align: 'center',
      }
    );
    pitCenterText.setOrigin(0.5);
    pitCenterText.setAlpha(0.65);
  }

  /**
   * Creates the Wall Street LED Ticker Board on Row 0
   */
  private createTickerBoard() {
    const bg = this.add.graphics();
    bg.fillStyle(0x020617, 0.95);
    bg.fillRect(8, 4, 640 - 16, 24);
    bg.lineStyle(1, 0x10b981, 0.8);
    bg.strokeRect(8, 4, 640 - 16, 24);

    this.tickerBanner = '★ CAL HACKS 13.0 FLOOR OPEN ★ WALK INTO PIT & PRESS [E] TO TRADE ★ 1 YES + 1 NO = $1.00 ★';
    this.tickerText = this.add.text(640, 9, this.tickerBanner, {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '8px',
      color: '#34d399',
    });

    // Animate ticker scrolling from right to left
    this.tweens.add({
      targets: this.tickerText,
      x: -800,
      duration: 16000,
      repeat: -1,
      ease: 'Linear',
    });
  }

  /**
   * Updates ticker text from active market state
   */
  public updateMarketTicker(question: string, lastPrice: number, volume: number) {
    if (!this.tickerText) return;
    this.tickerBanner = `★ ${question.toUpperCase()} ★ LAST: ${lastPrice}¢ (YES ${lastPrice}% | NO ${100 - lastPrice}%) ★ VOL: ${volume} ★ PRESS [E] IN PIT TO TRADE ★`;
    this.tickerText.setText(this.tickerBanner);
  }

  /**
   * Creates floating retro "[PRESS E TO ENTER PIT]" prompt
   */
  private createPitPrompt() {
    this.pitPromptContainer = this.add.container(
      (TradingPitScene.PIT_MIN_X + 2) * TradingPitScene.TILE_SIZE,
      TradingPitScene.PIT_MIN_Y * TradingPitScene.TILE_SIZE - 6 + TradingPitScene.OFFSET_Y
    );

    const bg = this.add.graphics();
    bg.fillStyle(0x0f172a, 0.92);
    bg.fillRoundedRect(-95, -12, 190, 24, 6);
    bg.lineStyle(1.5, 0xfacc15, 1);
    bg.strokeRoundedRect(-95, -12, 190, 24, 6);

    const txt = this.add.text(0, 0, 'PRESS [E] TO TRADE', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '8px',
      color: '#facc15',
    });
    txt.setOrigin(0.5);

    this.pitPromptContainer.add([bg, txt]);
    this.pitPromptContainer.setVisible(false);
    this.pitPromptContainer.setDepth(100);

    // Floating bob animation
    this.tweens.add({
      targets: this.pitPromptContainer,
      y: this.pitPromptContainer.y - 4,
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /**
   * Creates the local player sprite & container
   */
  private createLocalPlayerSprite() {
    const x = this.localGridX * TradingPitScene.TILE_SIZE + 16;
    const y = this.localGridY * TradingPitScene.TILE_SIZE + 16 + TradingPitScene.OFFSET_Y;

    this.localPlayerContainer = this.add.container(x, y);
    this.localPlayerContainer.setDepth(50);

    // Glowing halo under local player feet
    const halo = this.add.graphics();
    halo.fillStyle(0x38bdf8, 0.35);
    halo.fillCircle(0, 14, 12);
    halo.lineStyle(1, 0x38bdf8, 0.8);
    halo.strokeCircle(0, 14, 12);

    const sprite = this.add.sprite(0, 0, 'tex_trader');

    // Local player nameplate
    const nameText = this.add.text(0, -22, 'YOU (Trader)', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '7px',
      color: '#38bdf8',
      align: 'center',
    });
    nameText.setOrigin(0.5);
    nameText.setStroke('#020617', 2);

    this.localPlayerContainer.add([halo, sprite, nameText]);
  }

  /**
   * Syncs players list from SpacetimeDB
   */
  public syncPlayers(players: PlayerData[], myIdentityHex: string) {
    this.myIdentityHex = myIdentityHex;
    const currentKeys = new Set<string>();

    players.forEach(p => {
      currentKeys.add(p.identityHex);
      const isLocal = p.identityHex === this.myIdentityHex;

      if (isLocal) {
        // If local player moved remotely or initial sync
        if (!this.isMoving && (p.x !== this.localGridX || p.y !== this.localGridY)) {
          this.localGridX = p.x;
          this.localGridY = p.y;
          const targetPxX = p.x * TradingPitScene.TILE_SIZE + 16;
          const targetPxY = p.y * TradingPitScene.TILE_SIZE + 16 + TradingPitScene.OFFSET_Y;
          this.localPlayerContainer.setPosition(targetPxX, targetPxY);
          this.checkPitProximity(this.localGridX, this.localGridY);
        }
        return;
      }

      // Remote player or Bot
      let container = this.playerContainers.get(p.identityHex);
      const targetPxX = p.x * TradingPitScene.TILE_SIZE + 16;
      const targetPxY = p.y * TradingPitScene.TILE_SIZE + 16 + TradingPitScene.OFFSET_Y;

      if (!container) {
        // Instantiate remote player
        container = this.add.container(targetPxX, targetPxY);
        container.setDepth(45);

        const isWhale = p.isBot || p.username.toLowerCase().includes('whale') || p.username.toLowerCase().includes('bot');
        const spriteKey = isWhale ? 'tex_whale_bot' : 'tex_trader';
        const sprite = this.add.sprite(0, 0, spriteKey);

        const tagColor = isWhale ? '#f59e0b' : '#94a3b8';
        const displayName = p.username || (isWhale ? 'THE WHALE' : `Trader_${p.identityHex.slice(0, 4)}`);

        const nameText = this.add.text(0, -22, displayName, {
          fontFamily: '"Press Start 2P", monospace',
          fontSize: '6px',
          color: tagColor,
          align: 'center',
        });
        nameText.setOrigin(0.5);
        nameText.setStroke('#020617', 2);

        container.add([sprite, nameText]);
        this.playerContainers.set(p.identityHex, container);
      } else {
        // Tween to new position smoothly
        if (Math.abs(container.x - targetPxX) > 2 || Math.abs(container.y - targetPxY) > 2) {
          this.tweens.add({
            targets: container,
            x: targetPxX,
            y: targetPxY,
            duration: 130,
            ease: 'Linear',
          });
        }
      }
    });

    // Remove disconnected players
    this.playerContainers.forEach((container, id) => {
      if (!currentKeys.has(id)) {
        container.destroy();
        this.playerContainers.delete(id);
      }
    });
  }

  /**
   * Game loop: checks player movement inputs
   */
  public override update() {
    if (this.isMoving) return;

    let dx = 0;
    let dy = 0;
    let direction = this.localDirection;

    // Up
    if (this.cursors.up.isDown || this.wasd?.W.isDown) {
      dy = -1;
      direction = 'up';
    }
    // Down
    else if (this.cursors.down.isDown || this.wasd?.S.isDown) {
      dy = 1;
      direction = 'down';
    }
    // Left
    else if (this.cursors.left.isDown || this.wasd?.A.isDown) {
      dx = -1;
      direction = 'left';
    }
    // Right
    else if (this.cursors.right.isDown || this.wasd?.D.isDown) {
      dx = 1;
      direction = 'right';
    }

    if (dx !== 0 || dy !== 0) {
      this.attemptMove(dx, dy, direction);
    }
  }

  /**
   * Attempts grid-aligned 1-tile movement with smooth tweening
   */
  private attemptMove(dx: number, dy: number, direction: string) {
    const targetX = this.localGridX + dx;
    const targetY = this.localGridY + dy;

    // Bounds checking:
    // x: 0 .. 19
    // y: 1 .. 10 (row 0 is wall/ticker board)
    if (targetX < 0 || targetX >= TradingPitScene.COLS || targetY < 1 || targetY >= TradingPitScene.ROWS) {
      return;
    }

    this.isMoving = true;
    this.localGridX = targetX;
    this.localGridY = targetY;
    this.localDirection = direction;

    const targetPxX = targetX * TradingPitScene.TILE_SIZE + 16;
    const targetPxY = targetY * TradingPitScene.TILE_SIZE + 16 + TradingPitScene.OFFSET_Y;

    // Flip sprite horizontally if moving left/right
    const sprite = this.localPlayerContainer.list.find(c => c instanceof Phaser.GameObjects.Sprite) as Phaser.GameObjects.Sprite;
    if (sprite) {
      if (direction === 'left') sprite.setFlipX(true);
      else if (direction === 'right') sprite.setFlipX(false);
    }

    // Tween to target tile over 120ms
    this.tweens.add({
      targets: this.localPlayerContainer,
      x: targetPxX,
      y: targetPxY,
      duration: 120,
      ease: 'Linear',
      onComplete: () => {
        this.isMoving = false;
        // Broadcast move to SpacetimeDB
        this.configCallbacks.onPlayerMove?.(targetX, targetY, direction);
        // Check pit proximity
        this.checkPitProximity(targetX, targetY);
      },
    });
  }

  /**
   * Evaluates if player is within or adjacent to the Trading Pit
   */
  private checkPitProximity(x: number, y: number) {
    const inside =
      x >= TradingPitScene.PROX_MIN_X &&
      x <= TradingPitScene.PROX_MAX_X &&
      y >= TradingPitScene.PROX_MIN_Y &&
      y <= TradingPitScene.PROX_MAX_Y;

    if (inside !== this.isInsidePitProximity) {
      this.isInsidePitProximity = inside;
      this.pitPromptContainer.setVisible(inside);
      this.configCallbacks.onProximityChange?.(inside);
    }
  }

  /**
   * Spawns coin sparkle particles when a trade is executed in the pit
   */
  public triggerTradeExecutionEffect(price: number, qty: number) {
    const pitCenterX = (TradingPitScene.PIT_MIN_X + 2) * TradingPitScene.TILE_SIZE;
    const pitCenterY = (TradingPitScene.PIT_MIN_Y + 2) * TradingPitScene.TILE_SIZE + TradingPitScene.OFFSET_Y;

    const burst = this.add.text(pitCenterX, pitCenterY, `⚡ FILLED: ${qty}x @ ${price}¢`, {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '8px',
      color: '#34d399',
    });
    burst.setOrigin(0.5);
    burst.setDepth(150);

    this.tweens.add({
      targets: burst,
      y: burst.y - 32,
      alpha: 0,
      duration: 1200,
      ease: 'Power1',
      onComplete: () => burst.destroy(),
    });
  }
}
