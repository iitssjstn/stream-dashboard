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

export const ANIMATIONS = ['hug', 'highfive', 'love', 'dance', 'wave', 'image', 'none'] as const;
/** chat = chat command; the rest are alerts fed by Twitch EventSub */
export const TRIGGERS = ['chat', 'follow', 'subscriber', 'resub', 'gift', 'cheer', 'raid'] as const;
export type Trigger = (typeof TRIGGERS)[number];
export const PERMISSIONS = ['everyone', 'subscriber', 'vip', 'moderator', 'broadcaster'] as const;
export const EFFECTS = ['pop', 'slide-up', 'slide-left', 'fade', 'bounce', 'zoom', 'spin'] as const;
export const CHARACTER_STYLES = ['anime', 'people'] as const;
export const TARGET_MODES = ['optional', 'required', 'none'] as const;
export const PARTICLES = ['none', 'hearts', 'stars', 'confetti', 'sparkles'] as const;

/** Alerts every streamer starts with (they can be edited, extended with variations or switched off). */
export const DEFAULT_ALERTS = [
  { trigger: 'follow', name: 'alert-follow', animation: 'wave', text: 'Bedankt voor de follow, {user}!', style: defaultStyle({ particles: 'stars', accentColor: '#22d3ee', effect: 'slide-up' }) },
  { trigger: 'subscriber', name: 'alert-sub', animation: 'love', text: '{user} is nu subscriber (tier {tier})!', style: defaultStyle({ particles: 'hearts', accentColor: '#a855f7', effect: 'zoom' }) },
  { trigger: 'resub', name: 'alert-resub', animation: 'love', text: '{user} is al {months} maanden subscriber!', style: defaultStyle({ particles: 'hearts', accentColor: '#a855f7', effect: 'zoom' }) },
  { trigger: 'gift', name: 'alert-gift', animation: 'highfive', text: '{user} geeft {amount} subs weg!', style: defaultStyle({ particles: 'confetti', accentColor: '#ec4899', effect: 'bounce' }) },
  { trigger: 'cheer', name: 'alert-cheer', animation: 'dance', text: '{user} cheert {amount} bits!', style: defaultStyle({ particles: 'sparkles', accentColor: '#f59e0b', effect: 'pop' }) },
  { trigger: 'raid', name: 'alert-raid', animation: 'hug', walkIn: true, durationMs: 7000, text: '{user} raidt met {amount} kijkers!', style: defaultStyle({ particles: 'confetti', accentColor: '#10b981', effect: 'pop' }) },
] as const;
