import * as Phaser from 'phaser';
import {
  AGENT_SPRITES,
  AGENT_STYLE,
  AVATARS,
  AVATAR_TYPES,
  FACINGS,
  MINIMAP_RECT,
  facingFor,
  type AgentKind,
  type AvatarType,
  type Facing,
} from './assets';

export interface PlayerData {
  identityHex: string;
  username: string;
  cashBalance: number; // in cents
  x: number; // backend grid x: 0..19
  y: number; // backend grid y: 0..10
  direction: string;
  kind: AgentKind;
  avatarType: AvatarType;
}

/** A market pit spawned on the floor. (x, y) is the top-left of its 2x2 carpet. */
export interface PitData {
  id: string;
  x: number;
  y: number;
  title: string;
  price: number;
}

/** Id reported for the big pit in the middle of the hall. */
export const MAIN_PIT = 'main';

export interface TradingPitSceneConfig {
  onPlayerMove?: (x: number, y: number, direction: string) => void;
  onTogglePitOverlay?: (open?: boolean) => void;
  /** Called with the pit the player is standing at (MAIN_PIT or a market id), or null. */
  onProximityChange?: (pitId: string | null) => void;
  myIdentityHex?: string;
}

interface Pit {
  data: PitData;
  objects: Phaser.GameObjects.GameObject[];
  label: Phaser.GameObjects.GameObject[];
}

interface Avatar {
  identityHex: string;
  kind: AgentKind;
  avatarType: AvatarType;
  body: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  overhead: Phaser.GameObjects.Container;
  nameText: Phaser.GameObjects.Text;
  marker: Phaser.GameObjects.Rectangle;
  bubble: Phaser.GameObjects.Container | null;
  bubbleTimer: Phaser.Time.TimerEvent | null;
  facing: Facing;
  gridX: number;
  gridY: number;
  moveTween: Phaser.Tweens.Tween | null;
}

// --- World layout ------------------------------------------------------------
// The backend owns a 20x11 grid (x 0..19, y 0..10). It sits inside a larger
// decorative map so the camera can fill any screen without showing an edge.
const T = 32;
const MAP_W = 40;
const MAP_H = 26;
const FX = 10; // world tile column of backend x=0
const FY = 8; // world tile row of backend y=0
const COLS = 20;
const ROWS = 11;

const PIT = { minX: 8, maxX: 11, minY: 4, maxY: 7 };
const PROX = { minX: 7, maxX: 12, minY: 3, maxY: 8 };

// Backend tiles occupied by furniture (local movement only).
const BLOCKED = new Set<string>([
  // trading desks along the north wall
  '1,0', '2,0', '4,0', '5,0', '14,0', '15,0', '17,0', '18,0',
  // corner plants
  '0,0', '19,0', '0,10', '19,10',
  // central trading post
  '9,5', '10,5', '9,6', '10,6',
]);

const STEP_MS = 170;
const FONT = '"Press Start 2P", monospace';
const INK = '#1d1b2a';

const PROPS = ['desk', 'plant', 'post', 'bull', 'lamp', 'bench', 'tree', 'booth'] as const;
type PropKey = (typeof PROPS)[number];

const wx = (bx: number) => (FX + bx) * T + T / 2;
const wy = (by: number) => (FY + by) * T + T / 2;

// Deterministic hash so decorative scatter is identical for every client.
function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export class TradingPitScene extends Phaser.Scene {
  private callbacks: TradingPitSceneConfig = {};
  private myIdentityHex = '';

  private avatars = new Map<string, Avatar>();
  private local!: Avatar;
  private localReady = false;
  private isMoving = false;
  private currentPit: string | null = null;
  private pits = new Map<string, Pit>();
  private baseTicker = '';
  private alertMessage = '';
  private inputEnabled = true;

  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys?: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

  private minimap?: Phaser.Cameras.Scene2D.Camera;
  private minimapVisible = true;
  private virtualDirection: string | null = null;

  private tickerText!: Phaser.GameObjects.Text;
  private tickerMessage = '';
  private tickerOffset = 0;
  private tickerWidthChars = 60;
  private yesPriceText!: Phaser.GameObjects.Text;
  private noPriceText!: Phaser.GameObjects.Text;
  private pitHint!: Phaser.GameObjects.Container;

  private missing = new Set<string>();
  private walkAnims = new Set<string>(); // `${avatar}-${facing}`

  constructor() {
    super({ key: 'TradingPitScene' });
  }

  public setCallbacks(callbacks: TradingPitSceneConfig) {
    this.callbacks = { ...this.callbacks, ...callbacks };
    if (callbacks.myIdentityHex) this.myIdentityHex = callbacks.myIdentityHex;
  }

  public setInputEnabled(enabled: boolean) {
    this.inputEnabled = enabled;
    if (!enabled) this.input.keyboard?.resetKeys();
  }

  public setMinimapVisible(visible: boolean) {
    this.minimapVisible = visible;
    this.layout();
  }

  /** On-screen D-pad input ("up" | "down" | "left" | "right" | null). */
  public setVirtualDirection(direction: string | null) {
    this.virtualDirection = direction;
  }

  // --- Loading ---------------------------------------------------------------

  public preload() {
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.missing.add(file.key);
    });

    for (const avatar of AVATAR_TYPES) {
      const base = AVATARS[avatar].dir;
      for (const dir of FACINGS) {
        this.load.image(`${avatar}-${dir}`, `${base}/idle/${dir}.png`);
        for (let i = 0; i < 4; i++) {
          this.load.image(`${avatar}-walk-${dir}-${i}`, `${base}/walk/${dir}_${i}.png`);
        }
      }
    }

    for (const [kind, cfg] of Object.entries(AGENT_SPRITES)) {
      if (!cfg) continue;
      for (const dir of FACINGS) this.load.image(`${kind}-${dir}`, cfg[dir]);
    }

    this.load.spritesheet('floor', '/assets/tiles/floor_pit.png', { frameWidth: T, frameHeight: T });
    this.load.json('floor-wang', '/assets/tiles/floor_pit.wang.json');
    this.load.spritesheet('plaza', '/assets/tiles/plaza.png', { frameWidth: T, frameHeight: T });
    this.load.json('plaza-wang', '/assets/tiles/plaza.wang.json');

    for (const key of PROPS) this.load.image(`prop-${key}`, `/assets/props/${key}.png`);
  }

  private has(key: string) {
    return this.textures.exists(key) && !this.missing.has(key);
  }

  // --- Scene setup -------------------------------------------------------------

  public create() {
    this.buildProceduralTextures();
    this.buildWalkAnimations();

    this.cameras.main.setBounds(0, 0, MAP_W * T, MAP_H * T);
    this.cameras.main.setBackgroundColor('#3d6b35');
    this.createMinimap();

    this.drawExterior();
    this.drawHallFloor();
    this.drawWalls();
    this.drawBoards();
    this.drawPitRailing();
    this.placeFurniture();
    this.createPitHint();

    this.local = this.createAvatar(this.myIdentityHex || 'local', 'You', 'human', 'trader', 3, 5, 'south');
    this.setName(this.local, 'You', '#ffe066');
    this.cameras.main.startFollow(this.local.body, true, 0.15, 0.15);

    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      // Don't capture letter keys, so React inputs can still receive W/A/S/D/E.
      this.keys = {
        W: this.input.keyboard.addKey('W', false),
        A: this.input.keyboard.addKey('A', false),
        S: this.input.keyboard.addKey('S', false),
        D: this.input.keyboard.addKey('D', false),
      };
      this.input.keyboard.addKey('E', false).on('down', () => {
        if (this.inputEnabled && this.currentPit && !this.isTyping()) {
          this.callbacks.onTogglePitOverlay?.(true);
        }
      });
    }

    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.layout();
  }

  private layout() {
    if (!this.cameras?.main) return;
    const w = this.scale.width;
    const h = this.scale.height;
    // Show roughly 21x12 tiles; snap to whole zoom levels when large enough
    // so pixels stay square.
    const raw = Math.max(w / (21 * T), h / (12 * T));
    const zoom = raw >= 2 ? Math.round(raw) : Math.max(1, Math.round(raw * 2) / 2);
    this.cameras.main.setZoom(zoom);

    if (this.minimap) {
      const { left, bottom, width, height } = MINIMAP_RECT;
      this.minimap.setViewport(left, h - bottom - height, width, height);
      // The HUD frame is hidden below 640px wide (Tailwind's sm breakpoint).
      this.minimap.setVisible(this.minimapVisible && w >= 640);
    }
  }

  private isTyping() {
    const el = document.activeElement;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
  }

  // --- Textures ----------------------------------------------------------------

  private buildProceduralTextures() {
    const make = (key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) => {
      if (this.textures.exists(key)) return;
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      draw(g);
      g.generateTexture(key, w, h);
      g.destroy();
    };

    // Wall cap seen from above: warm sandstone with a darker rim.
    make('wall-cap', T, T, g => {
      g.fillStyle(0x8c7556).fillRect(0, 0, T, T);
      g.fillStyle(0xc9ae84).fillRect(0, 2, T, T - 5);
      g.fillStyle(0xd9c29b).fillRect(0, 3, T, 4);
      g.fillStyle(0xb39770).fillRect(0, T - 6, T, 2);
      g.fillStyle(0x5e4d38).fillRect(0, T - 3, T, 3);
    });

    // Side wall cap: same stone running north-south.
    make('wall-cap-v', T, T, g => {
      g.fillStyle(0x8c7556).fillRect(0, 0, T, T);
      g.fillStyle(0xc9ae84).fillRect(3, 0, T - 6, T);
      g.fillStyle(0xd9c29b).fillRect(5, 0, 4, T);
      g.fillStyle(0xb39770).fillRect(T - 9, 0, 2, T);
      g.fillStyle(0xbfa57c).fillRect(3, T - 1, T - 6, 1);
      g.fillStyle(0x5e4d38).fillRect(0, 0, 2, T).fillRect(T - 2, 0, 2, T);
    });

    // North wall face: cream stone blocks over a dark skirting board.
    make('wall-face', T, T * 2, g => {
      g.fillStyle(0xe6d6b5).fillRect(0, 0, T, T * 2);
      g.fillStyle(0xd3c09b);
      for (let row = 0; row < 7; row++) {
        const y = 4 + row * 8;
        g.fillRect(0, y, T, 1);
        const off = row % 2 === 0 ? 0 : 16;
        g.fillRect(off + 7, y - 7, 1, 7);
        g.fillRect((off + 23) % T, y - 7, 1, 7);
      }
      g.fillStyle(0xf3e7cf).fillRect(0, 0, T, 2);
      g.fillStyle(0x7a6448).fillRect(0, T * 2 - 10, T, 2);
      g.fillStyle(0x4a3c2c).fillRect(0, T * 2 - 8, T, 8);
      g.fillStyle(0x5e4d38).fillRect(0, T * 2 - 8, T, 1);
    });

    // Pilaster that breaks up the long wall face.
    make('wall-pilaster', 12, T * 2, g => {
      g.fillStyle(0xb39770).fillRect(0, 0, 12, T * 2);
      g.fillStyle(0xf5ead4).fillRect(1, 0, 9, T * 2 - 8);
      g.fillStyle(0xd9c7a3).fillRect(8, 0, 2, T * 2 - 8);
      g.fillStyle(0xfff7e6).fillRect(1, 0, 10, 4);
      g.fillStyle(0x4a3c2c).fillRect(0, T * 2 - 8, 12, 8);
    });

    // Small flower clusters for the lawn.
    make('flowers', 16, 16, g => {
      const dots: [number, number, number][] = [
        [3, 4, 0xffe066], [9, 2, 0xff6b8a], [12, 9, 0xffffff],
        [5, 11, 0xff6b8a], [2, 8, 0xffffff], [10, 13, 0xffe066],
      ];
      for (const [x, y, c] of dots) {
        g.fillStyle(c).fillRect(x, y, 2, 2);
        g.fillStyle(0x2f5d2a).fillRect(x, y + 2, 1, 1);
      }
    });

    // Fallback floors in case the generated tilesets are unavailable.
    make('fallback-stone', T, T, g => {
      g.fillStyle(0x6f7385).fillRect(0, 0, T, T);
      g.fillStyle(0x7d8193).fillRect(1, 1, 14, 14).fillRect(17, 17, 14, 14);
      g.fillStyle(0x777b8d).fillRect(17, 1, 14, 14).fillRect(1, 17, 14, 14);
    });
    make('fallback-carpet', T, T, g => {
      g.fillStyle(0x0f3d23).fillRect(0, 0, T, T);
      g.fillStyle(0x15502f).fillRect(2, 2, T - 4, T - 4);
      g.fillStyle(0xc9a227).fillRect(15, 12, 2, 8).fillRect(12, 15, 8, 2);
    });
    make('fallback-grass', T, T, g => {
      g.fillStyle(0x4f8a3c).fillRect(0, 0, T, T);
      for (let i = 0; i < 14; i++) {
        g.fillStyle(i % 2 ? 0x5e9c47 : 0x427a33).fillRect((i * 13) % 30, (i * 7) % 30, 2, 2);
      }
    });
    make('fallback-pavement', T, T, g => {
      g.fillStyle(0xbab3a8).fillRect(0, 0, T, T);
      g.fillStyle(0xa39c91).fillRect(0, 15, T, 1).fillRect(15, 0, 1, T);
    });
  }

  private buildWalkAnimations() {
    for (const avatar of AVATAR_TYPES) {
      for (const dir of FACINGS) {
        const frames = [0, 1, 2, 3].map(i => `${avatar}-walk-${dir}-${i}`);
        if (!frames.every(k => this.has(k))) continue;
        const key = `walk-${avatar}-${dir}`;
        if (!this.anims.exists(key)) {
          this.anims.create({ key, frames: frames.map(f => ({ key: f })), frameRate: 10, repeat: -1 });
        }
        this.walkAnims.add(`${avatar}-${dir}`);
      }
    }
  }

  // --- Terrain -----------------------------------------------------------------

  /** Paint a region with a Wang tileset, given which map vertices are "upper". */
  private paintWang(
    sheet: string,
    lookupKey: string,
    tiles: Iterable<[number, number]>,
    isUpper: (vx: number, vy: number) => boolean,
    depth: number,
  ) {
    const lookup = this.cache.json.get(lookupKey) as Record<string, number> | undefined;
    if (!lookup) return null;
    const ch = (b: boolean) => (b ? 'u' : 'l');
    const images: Phaser.GameObjects.Image[] = [];
    for (const [c, r] of tiles) {
      const key = ch(isUpper(c, r)) + ch(isUpper(c + 1, r)) + ch(isUpper(c, r + 1)) + ch(isUpper(c + 1, r + 1));
      const frame = lookup[key] ?? lookup.llll;
      images.push(this.add.image(c * T + T / 2, r * T + T / 2, sheet, frame).setDepth(depth));
    }
    return images;
  }

  private drawHallFloor() {
    const tiles: [number, number][] = [];
    for (let r = FY; r < FY + ROWS; r++) for (let c = FX; c < FX + COLS; c++) tiles.push([c, r]);

    // Carpet covers the pit (backend 8..11 x 4..7) using vertex corners.
    const pitUpper = (vx: number, vy: number) =>
      vx >= FX + PIT.minX && vx <= FX + PIT.maxX + 1 && vy >= FY + PIT.minY && vy <= FY + PIT.maxY + 1;

    const ok =
      this.has('floor') && !!this.paintWang('floor', 'floor-wang', tiles, pitUpper, -1000);
    if (!ok) {
      for (const [c, r] of tiles) {
        const inPit = c - FX >= PIT.minX && c - FX <= PIT.maxX && r - FY >= PIT.minY && r - FY <= PIT.maxY;
        this.add.image(c * T + T / 2, r * T + T / 2, inPit ? 'fallback-carpet' : 'fallback-stone').setDepth(-1000);
      }
    }

    // Soft shadow cast by the north wall onto the floor.
    const shadow = this.add.graphics().setDepth(-990);
    shadow.fillStyle(0x000000, 0.28).fillRect(FX * T, FY * T, COLS * T, 6);
    shadow.fillStyle(0x000000, 0.12).fillRect(FX * T, FY * T + 6, COLS * T, 6);
  }

  private drawExterior() {
    // Pavement ring around the building, a walkway south, and side paths.
    const pavement = (vx: number, vy: number) =>
      (vx >= FX - 3 && vx <= FX + COLS + 3 && vy >= FY - 5 && vy <= FY + ROWS + 4) ||
      (vx >= 17 && vx <= 23 && vy >= FY + ROWS + 4) ||
      (vy >= 12 && vy <= 14 && (vx <= FX - 3 || vx >= FX + COLS + 3));

    const tiles: [number, number][] = [];
    for (let r = 0; r < MAP_H; r++) for (let c = 0; c < MAP_W; c++) tiles.push([c, r]);

    const ok = this.has('plaza') && !!this.paintWang('plaza', 'plaza-wang', tiles, pavement, -1100);
    if (!ok) {
      for (const [c, r] of tiles) {
        const paved = pavement(c, r) && pavement(c + 1, r + 1);
        this.add.image(c * T + T / 2, r * T + T / 2, paved ? 'fallback-pavement' : 'fallback-grass').setDepth(-1100);
      }
    }

    // Scatter flowers on the lawn.
    for (let r = 0; r < MAP_H; r++) {
      for (let c = 0; c < MAP_W; c++) {
        const lawn = !pavement(c, r) && !pavement(c + 1, r) && !pavement(c, r + 1) && !pavement(c + 1, r + 1);
        if (lawn && hash(c, r) > 0.82) {
          this.add.image(c * T + 8 + hash(r, c) * 16, r * T + 8 + hash(c + 7, r) * 16, 'flowers').setDepth(-1050);
        }
      }
    }

    // Trees on the lawn, lamps and benches on the pavement, the bull out front.
    const trees: [number, number][] = [
      [2, 2], [5, 5], [2, 9], [4, 17], [2, 21], [6, 24], [11, 1], [29, 1],
      [35, 2], [38, 6], [36, 10], [38, 17], [35, 21], [33, 24], [14, 25], [26, 25],
      [1, 15], [38, 14],
    ];
    for (const [c, r] of trees) this.placeProp('tree', c * T + T / 2, r * T + T, 1);

    const lamps: [number, number][] = [
      [FX - 2, FY - 4], [FX + COLS + 1, FY - 4], [FX - 2, FY + ROWS + 2], [FX + COLS + 1, FY + ROWS + 2],
      [16, FY + ROWS + 4], [24, FY + ROWS + 4], [FX - 2, FY + 4], [FX + COLS + 1, FY + 4],
    ];
    for (const [c, r] of lamps) this.placeProp('lamp', c * T + T / 2, r * T + T, 1);

    const benches: [number, number][] = [
      [12, FY + ROWS + 2], [27, FY + ROWS + 2], [12, FY - 4], [27, FY - 4],
    ];
    for (const [c, r] of benches) this.placeProp('bench', c * T + T, r * T + T, 1);

    this.placeProp('bull', 20 * T, (FY + ROWS + 3) * T + 8, 1);
  }

  private drawWalls() {
    const top = FY - 3; // wall cap row
    for (let c = FX - 1; c <= FX + COLS; c++) {
      this.add.image(c * T + T / 2, top * T + T / 2, 'wall-cap').setDepth(-900);
    }
    for (let c = FX; c < FX + COLS; c++) {
      this.add.image(c * T + T / 2, (top + 1) * T, 'wall-face').setOrigin(0.5, 0).setDepth(-900);
    }
    for (let c = FX; c <= FX + COLS; c += 5) {
      this.add.image(c * T, (top + 1) * T, 'wall-pilaster').setOrigin(0.5, 0).setDepth(-899);
    }
    for (let r = top + 1; r <= FY + ROWS; r++) {
      this.add.image((FX - 1) * T + T / 2, r * T + T / 2, 'wall-cap-v').setDepth(-900);
      this.add.image((FX + COLS) * T + T / 2, r * T + T / 2, 'wall-cap-v').setDepth(-900);
    }
    // South wall sits in front of players standing on the bottom row.
    const southY = (FY + ROWS) * T + T / 2;
    for (let c = FX - 1; c <= FX + COLS; c++) {
      this.add.image(c * T + T / 2, southY, 'wall-cap').setDepth(southY + T);
    }
    // Ground shadow along the outside of the building.
    const g = this.add.graphics().setDepth(-1040);
    g.fillStyle(0x000000, 0.18);
    g.fillRect((FX - 1) * T, (FY + ROWS + 1) * T, (COLS + 2) * T, 8);
    g.fillRect((FX + COLS + 1) * T, top * T + 8, 8, (ROWS + 4) * T);
  }

  // --- Wall boards -------------------------------------------------------------

  private panel(x: number, y: number, w: number, h: number) {
    const g = this.add.graphics().setDepth(-880);
    g.fillStyle(0x2a2633).fillRect(x - 2, y - 2, w + 4, h + 4);
    g.fillStyle(0x8d8a99).fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle(0x0b0d14).fillRect(x, y, w, h);
    // LED dot grid
    g.fillStyle(0x16202a);
    for (let px = x + 2; px < x + w - 1; px += 3) {
      for (let py = y + 2; py < y + h - 1; py += 3) g.fillRect(px, py, 1, 1);
    }
    // mounting bolts
    g.fillStyle(0xcfd2dc).fillRect(x - 1, y - 1, 2, 2).fillRect(x + w - 1, y - 1, 2, 2);
    return g;
  }

  private text(x: number, y: number, value: string, size: number, color: string) {
    // Render text at 4x and scale down with linear filtering so it stays
    // smooth at any camera zoom.
    const t = this.add.text(x, y, value, {
      fontFamily: FONT,
      fontSize: `${size * 4}px`,
      color,
    });
    t.setScale(0.25);
    t.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    return t;
  }

  private drawBoards() {
    const faceTop = (FY - 2) * T;

    // Scrolling ticker across the middle of the wall.
    const tx = (FX + 3) * T + 6;
    const tw = (COLS - 6) * T - 12;
    this.panel(tx, faceTop + 14, tw, 18);
    this.tickerWidthChars = Math.floor((tw - 8) / 6);
    this.tickerText = this.text(tx + 4, faceTop + 20, '', 6, '#45f08a').setDepth(-870);
    this.setTicker('SERIOUS TRADING EXCHANGE * WALK INTO THE PIT AND PRESS [E] TO TRADE * 1 YES + 1 NO = $1.00');
    this.time.addEvent({
      delay: 140,
      loop: true,
      callback: () => {
        if (!this.tickerMessage) return;
        this.tickerOffset = (this.tickerOffset + 1) % this.tickerMessage.length;
        const doubled = this.tickerMessage + this.tickerMessage;
        this.tickerText.setText(doubled.slice(this.tickerOffset, this.tickerOffset + this.tickerWidthChars));
      },
    });

    // YES / NO price boards either side.
    const bw = 2 * T + 8;
    const leftX = FX * T + 14;
    const rightX = (FX + COLS) * T - 14 - bw;
    this.panel(leftX, faceTop + 6, bw, 34);
    this.panel(rightX, faceTop + 6, bw, 34);
    this.text(leftX + 4, faceTop + 10, 'YES', 5, '#45f08a').setDepth(-870);
    this.text(rightX + 4, faceTop + 10, 'NO', 5, '#ff6b6b').setDepth(-870);
    this.yesPriceText = this.text(leftX + bw - 4, faceTop + 21, '50¢', 8, '#45f08a').setOrigin(1, 0).setDepth(-870);
    this.noPriceText = this.text(rightX + bw - 4, faceTop + 21, '50¢', 8, '#ff6b6b').setOrigin(1, 0).setDepth(-870);
  }

  /** Breaking news from the instructor leads the LED ticker until cleared. */
  public setAlert(message: string) {
    this.alertMessage = message;
    this.refreshTicker();
  }

  private refreshTicker() {
    if (!this.baseTicker) return;
    this.setTicker(this.alertMessage ? `BREAKING: ${this.alertMessage.toUpperCase()} * ${this.baseTicker}` : this.baseTicker);
  }

  private setTicker(message: string) {
    this.tickerMessage = `${message}   ***   `;
    this.tickerOffset = 0;
  }

  public updateMarketTicker(question: string, lastPrice: number, volume: number) {
    if (!this.tickerText) return;
    this.baseTicker = `${question.toUpperCase()} * LAST ${lastPrice}¢ * YES ${lastPrice}% / NO ${100 - lastPrice}% * VOL ${volume} * PRESS [E] IN THE PIT TO TRADE`;
    this.refreshTicker();
    this.yesPriceText.setText(`${lastPrice}¢`);
    this.noPriceText.setText(`${100 - lastPrice}¢`);
  }

  // --- Pit & furniture -----------------------------------------------------------

  private drawPitRailing() {
    const x0 = (FX + PIT.minX) * T - 4;
    const x1 = (FX + PIT.maxX + 1) * T + 4;
    const y0 = (FY + PIT.minY) * T - 4;
    const y1 = (FY + PIT.maxY + 1) * T + 4;
    const gapA = (FX + PIT.minX + 1) * T + 8;
    const gapB = (FX + PIT.maxX) * T - 8;
    const gapTop = (FY + PIT.minY + 1) * T + 8;
    const gapBot = (FY + PIT.maxY) * T - 8;

    const rope = (g: Phaser.GameObjects.Graphics, ax: number, ay: number, bx: number, by: number) => {
      g.fillStyle(0x6b1020).fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax) || 2, Math.abs(by - ay) || 2);
      g.fillStyle(0xb8243b).fillRect(Math.min(ax, bx), Math.min(ay, by) - 1, Math.abs(bx - ax) || 1, Math.abs(by - ay) || 1);
    };
    const post = (g: Phaser.GameObjects.Graphics, x: number, y: number) => {
      g.fillStyle(0x000000, 0.25).fillEllipse(x, y + 1, 10, 4);
      g.fillStyle(0x7a5a12).fillRect(x - 2, y - 12, 4, 12);
      g.fillStyle(0xe8c252).fillRect(x - 1, y - 12, 2, 11);
      g.fillStyle(0xffe58a).fillCircle(x, y - 13, 2.5);
    };

    // Side ropes lie flat at floor level; top/bottom are y-sorted.
    const sides = this.add.graphics().setDepth(-980);
    rope(sides, x0, y0 - 8, x0, gapTop - 8);
    rope(sides, x0, gapBot - 8, x0, y1 - 8);
    rope(sides, x1, y0 - 8, x1, gapTop - 8);
    rope(sides, x1, gapBot - 8, x1, y1 - 8);

    const topRail = this.add.graphics().setDepth(y0);
    rope(topRail, x0, y0 - 8, gapA, y0 - 8);
    rope(topRail, gapB, y0 - 8, x1, y0 - 8);
    [x0, gapA, gapB, x1].forEach(x => post(topRail, x, y0));
    post(topRail, x0, gapTop);
    post(topRail, x1, gapTop);

    const botRail = this.add.graphics().setDepth(y1);
    rope(botRail, x0, y1 - 8, gapA, y1 - 8);
    rope(botRail, gapB, y1 - 8, x1, y1 - 8);
    [x0, gapA, gapB, x1].forEach(x => post(botRail, x, y1));
    post(botRail, x0, gapBot);
    post(botRail, x1, gapBot);
  }

  private placeProp(key: PropKey, x: number, y: number, originY: number) {
    const tex = `prop-${key}`;
    if (this.has(tex)) {
      return this.add.image(x, y, tex).setOrigin(0.5, originY).setDepth(y);
    }
    // Simple stand-in so the layout still reads if an asset is missing.
    const g = this.add.graphics().setDepth(y);
    const colors: Record<PropKey, number> = {
      desk: 0x6b4a2f, plant: 0x2f7a3a, post: 0x2a2633, bull: 0x8a5a2b, lamp: 0x3a3a48, bench: 0x9a6b3c, tree: 0x2f6b2a,
      booth: 0x5a3a22,
    };
    const size: Record<PropKey, [number, number]> = {
      desk: [56, 30], plant: [18, 28], post: [52, 52], bull: [48, 30], lamp: [6, 48], bench: [52, 14], tree: [44, 56],
      booth: [20, 30],
    };
    const [w, h] = size[key];
    g.fillStyle(colors[key]).fillRect(x - w / 2, y - h, w, h);
    return g;
  }

  private placeFurniture() {
    const deskXs = [1, 4, 14, 17];
    for (const bx of deskXs) this.placeProp('desk', (FX + bx + 1) * T, (FY + 1) * T - 2, 1);

    const plants: [number, number][] = [[0, 0], [19, 0], [0, 10], [19, 10]];
    for (const [bx, by] of plants) this.placeProp('plant', wx(bx), (FY + by + 1) * T - 2, 1);

    // Trading post in the middle of the pit.
    this.placeProp('post', (FX + 10) * T, (FY + 7) * T - 2, 1);
  }

  // --- Market booths -----------------------------------------------------------------

  /** Spawn, update or remove the 2x2 booths for markets placed on the floor. */
  public syncPits(pits: PitData[]) {
    if (!this.local) return;
    const seen = new Set<string>();
    for (const data of pits) {
      seen.add(data.id);
      const existing = this.pits.get(data.id);
      if (existing && existing.data.x === data.x && existing.data.y === data.y) {
        if (existing.data.title !== data.title || existing.data.price !== data.price) {
          existing.label.forEach(o => o.destroy());
          existing.label = this.boothLabel(data);
          existing.data = data;
        }
        continue;
      }
      if (existing) this.destroyPit(existing);
      this.pits.set(data.id, this.buildBooth(data));
    }
    for (const [id, pit] of this.pits) {
      if (!seen.has(id)) {
        this.destroyPit(pit);
        this.pits.delete(id);
      }
    }
    this.checkPitProximity();
  }

  private destroyPit(pit: Pit) {
    pit.objects.forEach(o => o.destroy());
    pit.label.forEach(o => o.destroy());
  }

  private buildBooth(data: PitData): Pit {
    const objects: Phaser.GameObjects.GameObject[] = [];
    const cx = FX + data.x;
    const cy = FY + data.y;

    // Carpet: vertices of the 2x2 block are "upper", painted over the base floor.
    const tiles: [number, number][] = [];
    for (let r = cy - 1; r <= cy + 2; r++) for (let c = cx - 1; c <= cx + 2; c++) tiles.push([c, r]);
    const upper = (vx: number, vy: number) => vx >= cx && vx <= cx + 2 && vy >= cy && vy <= cy + 2;
    const carpet = this.has('floor') ? this.paintWang('floor', 'floor-wang', tiles, upper, -999) : null;
    if (carpet) objects.push(...carpet);
    else objects.push(this.add.rectangle(cx * T, cy * T, 2 * T, 2 * T, 0x0f3d23).setOrigin(0).setDepth(-999));

    // Podium at the back of the carpet.
    objects.push(this.placeProp('booth', (cx + 1) * T, (cy + 1) * T, 1));

    // Arrival puff so a freshly deployed pit is noticeable.
    const ring = this.add.circle((cx + 1) * T, (cy + 1) * T, 8, 0xffe066, 0.6).setDepth(100001);
    this.ignoreOnMinimap(ring);
    this.tweens.add({ targets: ring, radius: 48, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });

    // Minimap marker
    const marker = this.add.rectangle((cx + 1) * T, (cy + 1) * T, 40, 40, 0x45f08a).setStrokeStyle(4, 0x0b0d14).setDepth(199999);
    this.cameras.main.ignore(marker);
    objects.push(marker);

    return { data, objects, label: this.boothLabel(data) };
  }

  /** Small LED sign floating over a booth: short question + YES price. */
  private boothLabel(data: PitData) {
    const cx = (FX + data.x + 1) * T;
    const top = (FY + data.y + 1) * T - 48 - 26; // above the 48px podium
    const title = data.title.length > 18 ? `${data.title.slice(0, 17)}…` : data.title;
    const t1 = this.text(cx, top + 3, title.toUpperCase(), 4, '#45f08a').setOrigin(0.5, 0);
    const t2 = this.text(cx, top + 10, `YES ${data.price}¢`, 4, '#ffe066').setOrigin(0.5, 0);
    const w = Math.ceil(Math.max(t1.displayWidth, t2.displayWidth)) + 8;
    const g = this.add.graphics();
    g.fillStyle(0x2a2633).fillRect(cx - w / 2 - 2, top - 2, w + 4, 21);
    g.fillStyle(0x0b0d14).fillRect(cx - w / 2, top, w, 17);
    g.fillStyle(0x2a2633).fillRect(cx - 1, top + 19, 2, 6);
    g.setDepth(99989);
    t1.setDepth(99990);
    t2.setDepth(99990);
    const objs = [g, t1, t2];
    objs.forEach(o => this.ignoreOnMinimap(o));
    return objs;
  }

  private pitAt(x: number, y: number): string | null {
    if (x >= PROX.minX && x <= PROX.maxX && y >= PROX.minY && y <= PROX.maxY) return MAIN_PIT;
    for (const [id, pit] of this.pits) {
      const { x: px, y: py } = pit.data;
      if (x >= px - 1 && x <= px + 2 && y >= py - 1 && y <= py + 2) return id;
    }
    return null;
  }

  private placePitHint(pitId: string) {
    this.tweens.killTweensOf(this.pitHint);
    let x = (FX + 10) * T;
    let y = (FY + PIT.minY) * T - 10;
    const pit = this.pits.get(pitId);
    if (pit) {
      x = (FX + pit.data.x + 1) * T;
      y = (FY + pit.data.y + 1) * T - 48 - 30;
    }
    this.pitHint.setPosition(x, y);
    this.tweens.add({ targets: this.pitHint, y: y - 3, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  private createPitHint() {
    this.pitHint = this.makeBubble('Press E to trade!', '#1d1b2a');
    this.pitHint.setDepth(100000).setVisible(false);
    this.ignoreOnMinimap(this.pitHint);
  }

  // --- Speech bubbles ------------------------------------------------------------

  private makeBubble(message: string, color: string) {
    const label = this.text(0, 0, message, 6, color).setOrigin(0.5, 1);
    const padX = 5;
    const padY = 4;
    const w = Math.ceil(label.displayWidth) + padX * 2;
    const h = Math.ceil(label.displayHeight) + padY * 2;
    label.setPosition(0, -6 - padY + 1);

    const g = this.add.graphics();
    const left = -Math.round(w / 2);
    const topY = -6 - h;
    g.fillStyle(0x000000, 0.25).fillRect(left + 2, topY + 2, w, h);
    g.fillStyle(0x1d1b2a).fillRect(left - 1, topY - 1, w + 2, h + 2);
    g.fillStyle(0xffffff).fillRect(left, topY, w, h);
    // pointer
    g.fillStyle(0x1d1b2a).fillTriangle(-5, -7, 5, -7, 0, -1);
    g.fillStyle(0xffffff).fillTriangle(-3, -7, 3, -7, 0, -3);

    return this.add.container(0, 0, [g, label]);
  }

  public say(identityHex: string, message: string, color = INK, durationMs = 2600) {
    const avatar = identityHex === this.myIdentityHex ? this.local : this.avatars.get(identityHex);
    if (!avatar) return;
    avatar.bubbleTimer?.remove();
    avatar.bubble?.destroy();
    const bubble = this.makeBubble(message, color);
    bubble.setPosition(0, -29);
    avatar.overhead.add(bubble);
    avatar.bubble = bubble;
    bubble.setScale(0.6);
    this.tweens.add({ targets: bubble, scale: 1, duration: 140, ease: 'Back.easeOut' });
    avatar.bubbleTimer = this.time.delayedCall(durationMs, () => {
      this.tweens.add({
        targets: bubble,
        alpha: 0,
        duration: 250,
        onComplete: () => {
          bubble.destroy();
          if (avatar.bubble === bubble) avatar.bubble = null;
        },
      });
    });
  }

  /** Floating "+10 YES @ 52¢" style text over the trading post. */
  public triggerTradeExecutionEffect(price: number, qty: number) {
    const t = this.text((FX + 10) * T, (FY + 5) * T, `${qty} @ ${price}¢`, 6, '#ffe066')
      .setOrigin(0.5)
      .setDepth(100001)
      .setStroke('#1d1b2a', 12);
    this.ignoreOnMinimap(t);
    this.tweens.add({ targets: t, y: t.y - 24, alpha: 0, duration: 1400, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  // --- Minimap -------------------------------------------------------------------

  private createMinimap() {
    const { width, height } = MINIMAP_RECT;
    const zoom = Math.min(width / (MAP_W * T), height / (MAP_H * T));
    this.minimap = this.cameras
      .add(0, 0, width, height, false, 'minimap')
      .setZoom(zoom)
      .setBackgroundColor('#1b2a1b')
      .centerOn((MAP_W * T) / 2, (MAP_H * T) / 2);
  }

  private ignoreOnMinimap(obj: Phaser.GameObjects.GameObject) {
    this.minimap?.ignore(obj);
  }

  // --- Avatars -------------------------------------------------------------------

  private textureFor(a: { kind: AgentKind; avatarType: AvatarType }, facing: Facing) {
    if (a.kind !== 'human' && this.has(`${a.kind}-${facing}`)) return `${a.kind}-${facing}`;
    for (const avatar of [a.avatarType, 'trader'] as AvatarType[]) {
      if (this.has(`${avatar}-${facing}`)) return `${avatar}-${facing}`;
    }
    return 'trader-south';
  }

  private usesOwnSprite(kind: AgentKind) {
    return kind !== 'human' && this.has(`${kind}-south`);
  }

  private createAvatar(
    id: string,
    name: string,
    kind: AgentKind,
    avatarType: AvatarType,
    gx: number,
    gy: number,
    facing: Facing,
  ): Avatar {
    const body = this.add.container(wx(gx), wy(gy));
    const shadow = this.add.ellipse(0, 14, 18, 6, 0x000000, 0.3);
    const sprite = this.add.sprite(0, 16, this.textureFor({ kind, avatarType }, facing)).setOrigin(0.5, 1);
    const style = AGENT_STYLE[kind];
    if (style.tint !== null && !this.usesOwnSprite(kind)) sprite.setTint(style.tint);
    body.add([shadow, sprite]);
    body.setDepth(body.y + 16);

    const overhead = this.add.container(body.x, body.y).setDepth(100000);
    const label = style.tag ? `${name} [${style.tag}]` : name;
    const nameText = this.nameLabel(label, style.nameColor);
    overhead.add(nameText);
    this.ignoreOnMinimap(overhead);

    const markerColor = kind === 'human' ? 0xff3b3b : kind === 'claude' ? 0xff9a5c : 0x4fc3ff;
    const marker = this.add.rectangle(body.x, body.y, 26, 26, markerColor).setStrokeStyle(4, 0xffffff).setDepth(200000);
    this.cameras.main.ignore(marker);

    return {
      identityHex: id,
      kind,
      avatarType,
      body,
      sprite,
      overhead,
      nameText,
      marker,
      bubble: null,
      bubbleTimer: null,
      facing,
      gridX: gx,
      gridY: gy,
      moveTween: null,
    };
  }

  private nameLabel(label: string, color: string) {
    return this.text(0, -20, label, 5, color).setOrigin(0.5, 1).setStroke(INK, 10);
  }

  /** Swap an avatar's name label; text objects are rebuilt rather than resized. */
  private setName(a: Avatar, label: string, color: string) {
    if (a.nameText.text === label && a.nameText.style.color === color) return;
    a.nameText.destroy();
    a.nameText = this.nameLabel(label, color);
    a.overhead.addAt(a.nameText, 0);
  }

  private destroyAvatar(a: Avatar) {
    a.moveTween?.stop();
    a.bubbleTimer?.remove();
    a.body.destroy();
    a.overhead.destroy();
    a.marker.destroy();
  }

  private face(a: Avatar, facing: Facing) {
    a.facing = facing;
    if (!a.sprite.anims.isPlaying) a.sprite.setTexture(this.textureFor(a, facing));
  }

  private startWalk(a: Avatar) {
    if (!this.usesOwnSprite(a.kind) && this.walkAnims.has(`${a.avatarType}-${a.facing}`)) {
      a.sprite.play(`walk-${a.avatarType}-${a.facing}`, true);
    }
  }

  private stopWalk(a: Avatar) {
    a.sprite.anims.stop();
    a.sprite.setTexture(this.textureFor(a, a.facing));
  }

  private moveAvatarTo(a: Avatar, gx: number, gy: number, duration: number, onComplete?: () => void) {
    a.gridX = gx;
    a.gridY = gy;
    a.moveTween?.stop();
    this.startWalk(a);
    a.moveTween = this.tweens.add({
      targets: a.body,
      x: wx(gx),
      y: wy(gy),
      duration,
      ease: 'Linear',
      onComplete: () => {
        a.moveTween = null;
        onComplete?.();
      },
    });
  }

  /** Sync the roster from SpacetimeDB. */
  public syncPlayers(players: PlayerData[], myIdentityHex: string) {
    this.myIdentityHex = myIdentityHex;
    if (!this.local) return;
    const seen = new Set<string>();

    for (const p of players) {
      if (p.identityHex === myIdentityHex) {
        this.local.identityHex = p.identityHex;
        this.setName(this.local, `${p.username} (you)`, '#ffe066');
        if (this.local.avatarType !== p.avatarType) {
          this.local.avatarType = p.avatarType;
          this.stopWalk(this.local);
        }
        if (!this.localReady || (!this.isMoving && (p.x !== this.local.gridX || p.y !== this.local.gridY))) {
          if (!this.isMoving) {
            this.local.gridX = p.x;
            this.local.gridY = p.y;
            this.local.body.setPosition(wx(p.x), wy(p.y));
            this.face(this.local, facingFor(p.direction));
            this.checkPitProximity();
          }
        }
        if (!this.localReady) {
          this.localReady = true;
          this.cameras.main.centerOn(this.local.body.x, this.local.body.y);
          this.time.delayedCall(400, () => this.say(myIdentityHex, 'Welcome to the trading floor!', INK, 3600));
        }
        continue;
      }

      seen.add(p.identityHex);
      let a = this.avatars.get(p.identityHex);
      if (!a || a.kind !== p.kind || a.avatarType !== p.avatarType) {
        if (a) this.destroyAvatar(a);
        a = this.createAvatar(p.identityHex, p.username, p.kind, p.avatarType, p.x, p.y, facingFor(p.direction));
        this.avatars.set(p.identityHex, a);
      }

      const style = AGENT_STYLE[p.kind];
      this.setName(a, style.tag ? `${p.username} [${style.tag}]` : p.username, style.nameColor);

      if (p.x !== a.gridX || p.y !== a.gridY) {
        const dist = Math.abs(p.x - a.gridX) + Math.abs(p.y - a.gridY);
        this.face(a, facingFor(p.direction));
        const avatar = a;
        this.moveAvatarTo(a, p.x, p.y, Math.min(600, STEP_MS * dist), () => this.stopWalk(avatar));
      } else {
        this.face(a, facingFor(p.direction));
      }
    }

    for (const [id, a] of this.avatars) {
      if (!seen.has(id)) {
        this.destroyAvatar(a);
        this.avatars.delete(id);
      }
    }
  }

  // --- Game loop -------------------------------------------------------------------

  public override update() {
    const all = [this.local, ...this.avatars.values()];
    for (const a of all) {
      if (!a) continue;
      a.body.setDepth(a.body.y + 16);
      a.overhead.setPosition(a.body.x, a.body.y);
      a.marker.setPosition(a.body.x, a.body.y);
    }
    if (this.local) this.local.marker.setFillStyle(0xffe066);

    if (this.isMoving || !this.inputEnabled || this.isTyping()) return;

    const k = this.keys;
    const c = this.cursors;
    let dx = 0;
    let dy = 0;
    let direction = '';
    if (c?.up.isDown || k?.W.isDown) [dy, direction] = [-1, 'up'];
    else if (c?.down.isDown || k?.S.isDown) [dy, direction] = [1, 'down'];
    else if (c?.left.isDown || k?.A.isDown) [dx, direction] = [-1, 'left'];
    else if (c?.right.isDown || k?.D.isDown) [dx, direction] = [1, 'right'];
    else if (this.virtualDirection) {
      direction = this.virtualDirection;
      dx = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
      dy = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
    }

    if (direction) this.attemptMove(dx, dy, direction);
    else if (this.local.sprite.anims.isPlaying) this.stopWalk(this.local);
  }

  private attemptMove(dx: number, dy: number, direction: string) {
    const tx = this.local.gridX + dx;
    const ty = this.local.gridY + dy;
    const facing = facingFor(direction);

    if (this.local.facing !== facing) {
      this.local.facing = facing;
      this.local.sprite.anims.stop();
      this.local.sprite.setTexture(this.textureFor(this.local, facing));
    }

    if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS || BLOCKED.has(`${tx},${ty}`)) {
      if (this.local.sprite.anims.isPlaying) this.stopWalk(this.local);
      return;
    }

    this.isMoving = true;
    this.moveAvatarTo(this.local, tx, ty, STEP_MS, () => {
      this.isMoving = false;
      this.callbacks.onPlayerMove?.(tx, ty, direction);
      this.checkPitProximity();
    });
  }

  private checkPitProximity() {
    if (!this.local || !this.pitHint) return;
    const pit = this.pitAt(this.local.gridX, this.local.gridY);
    if (pit !== this.currentPit) {
      this.currentPit = pit;
      if (pit) this.placePitHint(pit);
      this.pitHint.setVisible(!!pit);
      this.callbacks.onProximityChange?.(pit);
    }
  }
}
