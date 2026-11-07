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

export type Locale = 'en' | 'nl';
export const LOCALES: Locale[] = ['en', 'nl'];
export const asLocale = (v: unknown): Locale => (v === 'nl' ? 'nl' : 'en');

/** Commands every new streamer starts with, in their language. */
export function defaultCommands(locale: Locale) {
  const nl = locale === 'nl';
  const fallback = nl ? 'de streamer' : 'the streamer';
  return [
    {
      name: nl ? 'knuffel' : 'hug',
      animation: 'hug',
      text: nl ? '{user} geeft {target} een knuffel!' : '{user} gives {target} a big hug!',
      targetFallback: fallback,
      style: defaultStyle({ particles: 'hearts', accentColor: '#ec4899' }),
    },
    {
      name: 'highfive',
      animation: 'highfive',
      text: nl ? '{user} geeft {target} een high five!' : '{user} gives {target} a high five!',
      targetFallback: fallback,
      style: defaultStyle({ particles: 'stars', accentColor: '#3b82f6', effect: 'bounce' }),
    },
    {
      name: 'love',
      animation: 'love',
      text: nl ? '{user} stuurt liefde naar {target}!' : '{user} sends love to {target}!',
      targetFallback: fallback,
      style: defaultStyle({ particles: 'hearts', accentColor: '#f43f5e', effect: 'zoom' }),
    },
    {
      name: 'dance',
      animation: 'dance',
      text: nl ? '{user} gaat los op de dansvloer!' : '{user} hits the dance floor!',
      targetFallback: fallback,
      style: defaultStyle({ particles: 'confetti', accentColor: '#8b5cf6', effect: 'slide-up' }),
    },
    {
      name: nl ? 'zwaai' : 'wave',
      animation: 'wave',
      text: nl ? '{user} zwaait naar {target}!' : '{user} waves at {target}!',
      targetFallback: nl ? 'iedereen' : 'everyone',
      style: defaultStyle({ particles: 'sparkles', accentColor: '#22d3ee', effect: 'slide-up' }),
    },
  ];
}

export const ANIMATIONS = ['hug', 'highfive', 'love', 'dance', 'wave', 'image', 'none'] as const;
/** chat = chat command; the rest are alerts fed by Twitch EventSub */
export const TRIGGERS = ['chat', 'follow', 'subscriber', 'resub', 'gift', 'cheer', 'raid'] as const;
export type Trigger = (typeof TRIGGERS)[number];
export const PERMISSIONS = ['everyone', 'subscriber', 'vip', 'moderator', 'broadcaster'] as const;
export const EFFECTS = ['pop', 'slide-up', 'slide-left', 'fade', 'bounce', 'zoom', 'spin'] as const;
export const CHARACTER_STYLES = ['anime', 'people'] as const;
export const TARGET_MODES = ['optional', 'required', 'none'] as const;
export const PARTICLES = ['none', 'hearts', 'stars', 'confetti', 'sparkles'] as const;

/** Names of the built-in alerts (the same in every language). */
export const DEFAULT_ALERT_NAMES = ['alert-follow', 'alert-sub', 'alert-resub', 'alert-gift', 'alert-cheer', 'alert-raid'];

/** Alerts every streamer starts with (they can be edited, extended with variations or switched off). */
export function defaultAlerts(locale: Locale) {
  const nl = locale === 'nl';
  return [
    { trigger: 'follow', name: 'alert-follow', animation: 'wave', text: nl ? 'Bedankt voor de follow, {user}!' : 'Thanks for the follow, {user}!', style: defaultStyle({ particles: 'stars', accentColor: '#22d3ee', effect: 'slide-up' }) },
    { trigger: 'subscriber', name: 'alert-sub', animation: 'love', text: nl ? '{user} is nu subscriber (tier {tier})!' : '{user} just subscribed (tier {tier})!', style: defaultStyle({ particles: 'hearts', accentColor: '#a855f7', effect: 'zoom' }) },
    { trigger: 'resub', name: 'alert-resub', animation: 'love', text: nl ? '{user} is al {months} maanden subscriber!' : '{user} has been subscribed for {months} months!', style: defaultStyle({ particles: 'hearts', accentColor: '#a855f7', effect: 'zoom' }) },
    { trigger: 'gift', name: 'alert-gift', animation: 'highfive', text: nl ? '{user} geeft {amount} subs weg!' : '{user} is gifting {amount} subs!', style: defaultStyle({ particles: 'confetti', accentColor: '#ec4899', effect: 'bounce' }) },
    { trigger: 'cheer', name: 'alert-cheer', animation: 'dance', text: nl ? '{user} cheert {amount} bits!' : '{user} cheered {amount} bits!', style: defaultStyle({ particles: 'sparkles', accentColor: '#f59e0b', effect: 'pop' }) },
    { trigger: 'raid', name: 'alert-raid', animation: 'hug', walkIn: true, durationMs: 7000, text: nl ? '{user} raidt met {amount} kijkers!' : '{user} is raiding with {amount} viewers!', style: defaultStyle({ particles: 'confetti', accentColor: '#10b981', effect: 'pop' }) },
  ];
}
