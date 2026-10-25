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

export type AgentKind = 'human' | 'whale' | 'claude';
export type Facing = 'south' | 'north' | 'east' | 'west';

export type AgentSpriteConfig = Record<Facing, string>;

export const AGENT_SPRITES: Record<Exclude<AgentKind, 'human'>, AgentSpriteConfig | null> = {
  whale: null,
  claude: null,
};

export const AGENT_STYLE: Record<AgentKind, { tint: number | null; nameColor: string; tag: string }> = {
  human: { tint: null, nameColor: '#ffffff', tag: '' },
  whale: { tint: 0x8fd3ff, nameColor: '#8fd3ff', tag: 'BOT' },
  claude: { tint: 0xffa47a, nameColor: '#ffb38f', tag: 'AI' },
};

export const FACINGS: Facing[] = ['south', 'north', 'east', 'west'];

// Playable avatars chosen on the login screen. Each folder holds
// idle/<facing>.png and walk/<facing>_<0-3>.png, feet on the bottom edge.
export type AvatarType = 'trader' | 'businesswoman' | 'robot' | 'whale';

// `canvas` is the frame size in pixels (used to preview both at the same scale).
export const AVATARS: Record<AvatarType, { label: string; dir: string; canvas: number }> = {
  trader: { label: 'Serious Trader #1', dir: '/assets/player', canvas: 32 },
  businesswoman: { label: 'Serious Trader #2', dir: '/assets/businesswoman', canvas: 40 },
  robot: { label: 'Market Maker Bot', dir: '/assets/robot', canvas: 32 },
  whale: { label: 'The Whale [AI]', dir: '/assets/whale', canvas: 32 },
};

export const AVATAR_TYPES = Object.keys(AVATARS) as AvatarType[];

export function avatarTypeFor(value: string): AvatarType {
  return value in AVATARS ? (value as AvatarType) : 'trader';
}

export function agentKindFor(username: string): AgentKind {
  const name = username.toLowerCase();
  if (name.includes('claude')) return 'claude';
  if (name.includes('whale') || name.includes('bot')) return 'whale';
  return 'human';
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
