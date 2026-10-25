// Asset manifest for the trading floor.
//
// Bots and the Claude agent get their own sprites once the art is ready.
// Drop four facing PNGs (32x32, same style as the player) into
// public/assets/agents/<kind>/ and point the config at them, e.g.
//
//   whale: {
//     south: '/assets/agents/whale/south.png',
//     north: '/assets/agents/whale/north.png',
//     east:  '/assets/agents/whale/east.png',
//     west:  '/assets/agents/whale/west.png',
//   },
//
// Until then they reuse the player sprite with a colour tint so they are
// still easy to tell apart on the floor.

export type AgentKind = 'human' | 'bot' | 'whale' | 'claude';
export type Facing = 'south' | 'north' | 'east' | 'west';

export type AgentSpriteConfig = Record<Facing, string>;

export const AGENT_SPRITES: Record<Exclude<AgentKind, 'human'>, AgentSpriteConfig | null> = {
  bot: null,
  whale: null,
  claude: null,
};

export const AGENT_STYLE: Record<AgentKind, { tint: number | null; nameColor: string; tag: string }> = {
  human: { tint: null, nameColor: '#ffffff', tag: '' },
  bot: { tint: 0x8fd3ff, nameColor: '#8fd3ff', tag: 'BOT' },
  whale: { tint: 0xffd166, nameColor: '#facc15', tag: 'AI' },
  claude: { tint: 0xffa47a, nameColor: '#ffb38f', tag: 'AI' },
};

export const FACINGS: Facing[] = ['south', 'north', 'east', 'west'];

// Avatars. Each folder holds idle/<facing>.png and walk/<facing>_<0-3>.png,
// feet on the bottom edge. Robots are drawn for the server's bot traders and the
// whale for the AI sidecar (scripts/whale_bot.ts); neither is offered at login.
export type AvatarType = 'trader' | 'businesswoman' | 'robot' | 'whale';

// `canvas` is the frame size in pixels (used to preview both at the same scale).
// `robotic` avatars are drawn in their own colours, never tinted.
export const AVATARS: Record<AvatarType, { label: string; dir: string; canvas: number; selectable: boolean; robotic: boolean }> = {
  trader: { label: 'Serious Trader #1', dir: '/assets/player', canvas: 32, selectable: true, robotic: false },
  businesswoman: { label: 'Serious Trader #2', dir: '/assets/businesswoman', canvas: 40, selectable: true, robotic: false },
  robot: { label: 'Market Maker Bot', dir: '/assets/robot', canvas: 32, selectable: false, robotic: true },
  whale: { label: 'Whale AI', dir: '/assets/whale', canvas: 32, selectable: false, robotic: true },
};

export const AVATAR_TYPES = Object.keys(AVATARS) as AvatarType[];
export const SELECTABLE_AVATARS = AVATAR_TYPES.filter(type => AVATARS[type].selectable);

export function avatarTypeFor(value: string): AvatarType {
  return value in AVATARS ? (value as AvatarType) : 'trader';
}

export function agentKindFor(username: string, avatarType = ''): AgentKind {
  if (avatarType === 'whale') return 'whale';
  const name = username.toLowerCase();
  if (name.includes('claude')) return 'claude';
  if (name.includes('whale')) return 'whale';
  if (name.includes('bot')) return 'bot';
  return 'human';
}

/** Name shown above an avatar; names that already carry a [TAG] keep it as is. */
export function agentLabel(name: string, kind: AgentKind) {
  const tag = AGENT_STYLE[kind].tag;
  return tag && !name.includes('[') ? `${name} [${tag}]` : name;
}

// Backend directions ("up" | "down" | "left" | "right") to sprite facings.
export function facingFor(direction: string): Facing {
  switch (direction) {
    case 'up':
      return 'north';
    case 'left':
      return 'west';
    case 'right':
      return 'east';
    default:
      return 'south';
  }
}

// Screen-space rectangle of the minimap screen, shared by the React frame
// and the Phaser minimap camera so they line up exactly.
export const MINIMAP_RECT = { left: 34, bottom: 34, width: 208, height: 136 };
