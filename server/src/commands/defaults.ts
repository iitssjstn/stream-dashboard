import type { CommandStyle } from '../db/schema.js';

export const defaultStyle = (overrides: Partial<CommandStyle> = {}): CommandStyle => ({
  fontFamily: 'Fredoka',
  fontSize: 44,
  textColor: '#ffffff',
  accentColor: '#a855f7',
  x: 50,
  y: 62,
  scale: 1,
  effect: 'pop',
  particles: 'hearts',
  textShadow: true,
  ...overrides,
});

export const DEFAULT_COMMANDS = [
  {
    name: 'knuffel',
    animation: 'hug',
    text: '{user} geeft {target} een knuffel!',
    style: defaultStyle({ particles: 'hearts', accentColor: '#ec4899' }),
  },
  {
    name: 'hug',
    animation: 'hug',
    text: '{user} gives {target} a big hug!',
    targetFallback: 'the streamer',
    style: defaultStyle({ particles: 'hearts', accentColor: '#ec4899' }),
  },
  {
    name: 'highfive',
    animation: 'highfive',
    text: '{user} geeft {target} een high five!',
    style: defaultStyle({ particles: 'stars', accentColor: '#3b82f6', effect: 'bounce' }),
  },
  {
    name: 'love',
    animation: 'love',
    text: '{user} stuurt liefde naar {target}!',
    style: defaultStyle({ particles: 'hearts', accentColor: '#f43f5e', effect: 'zoom' }),
  },
  {
    name: 'dance',
    animation: 'dance',
    text: '{user} gaat los op de dansvloer!',
    style: defaultStyle({ particles: 'confetti', accentColor: '#8b5cf6', effect: 'slide-up' }),
  },
];

export const ANIMATIONS = ['hug', 'highfive', 'love', 'dance', 'wave', 'image'] as const;
export const PERMISSIONS = ['everyone', 'subscriber', 'vip', 'moderator', 'broadcaster'] as const;
export const EFFECTS = ['pop', 'slide-up', 'slide-left', 'fade', 'bounce', 'zoom', 'spin'] as const;
export const TARGET_MODES = ['optional', 'required', 'none'] as const;
export const PARTICLES = ['none', 'hearts', 'stars', 'confetti', 'sparkles'] as const;
