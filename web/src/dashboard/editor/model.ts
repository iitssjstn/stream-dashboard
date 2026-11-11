import { t } from '../i18n';
import type { Command, Trigger } from '../api';
import type { Icon } from '../ui';
import type { WidgetData, WidgetType } from '../../overlay/widgets';
import { makeBlank } from '../pages/CommandEditor';

export type Widget = { id: number; type: WidgetType; name: string; enabled: boolean; x: number; y: number; scale: number; z: number; config: Record<string, any> };
export type Doc = { cmds: Command[]; widgets: Widget[] };
export type Sel = { kind: 'cmd' | 'widget'; id: number } | null;

export const WIDGET_EVENTS = ['follow', 'subscriber', 'gift', 'cheer', 'raid'] as const;

export const WIDGET_TYPES: { type: WidgetType; label: string; hint: string; icon: keyof typeof Icon }[] = [
  { type: 'text', label: 'Text', hint: 'A line of your own text', icon: 'type' },
  { type: 'image', label: 'Image', hint: 'Image, GIF or video that stays in view', icon: 'image' },
  { type: 'latest', label: 'Latest event', hint: 'Your latest follower, sub, cheer or raid', icon: 'star' },
  { type: 'rotator', label: 'Event rotator', hint: 'Switches between your latest events', icon: 'refresh' },
  { type: 'goal', label: 'Goal bar', hint: 'Fills up with followers, subs or bits', icon: 'target' },
  { type: 'countdown', label: 'Countdown', hint: 'Counts down, e.g. “Starting soon”', icon: 'clock' },
];

export const eventTemplates = (): Record<string, string> => ({
  follow: t('Latest follower: {user}'),
  subscriber: t('Latest sub: {user}'),
  gift: t('Latest gift: {user} ({amount} subs)'),
  cheer: t('Latest cheer: {user} ({amount} bits)'),
  raid: t('Latest raid: {user} ({amount} viewers)'),
});

export const EVENT_LABELS: Record<string, string> = { follow: 'Follow', subscriber: 'New sub', gift: 'Gifted subs', cheer: 'Bits', raid: 'Raid' };

const textStyle = { fontFamily: 'Fredoka', fontSize: 48, color: '#ffffff', accentColor: '#a855f7', shadow: true, background: 'none' };

export function makeWidget(type: WidgetType, id: number, z: number, count: number): Widget {
  const base = { id, type, enabled: true, x: 50, y: 50, scale: 1, z, name: `${t(WIDGET_TYPES.find((w) => w.type === type)!.label)} ${count}` };
  switch (type) {
    case 'text':
      return { ...base, config: { ...textStyle, text: t('Your text here') } };
    case 'image':
      return { ...base, config: { url: '', width: 400 } };
    case 'latest':
      return { ...base, y: 90, config: { ...textStyle, background: 'box', event: 'follow', template: eventTemplates().follow, empty: '' } };
    case 'rotator':
      return { ...base, y: 90, config: { ...textStyle, background: 'box', events: [...WIDGET_EVENTS], templates: eventTemplates(), intervalSec: 6 } };
    case 'goal':
      return { ...base, y: 12, config: { ...textStyle, fontSize: 34, metric: 'follow', title: t('Follower goal'), target: 100, start: 0, since: Date.now(), width: 640, barColor: '#a855f7' } };
    case 'countdown':
      return { ...base, config: { ...textStyle, fontSize: 96, label: t('Starting soon'), seconds: 300, endsAt: null, endText: t('Live!') } };
  }
}

/** A new chat command or alert, ready to be edited in the overlay editor. */
export function makeCommand(trigger: Trigger, id: number, overlayId: number, taken: Set<string>): Command {
  const blank = makeBlank();
  if (trigger === 'chat') {
    let n = 1;
    while (taken.has(`command${n}`)) n++;
    return { ...blank, id, overlayId, name: `command${n}` } as Command;
  }
  return {
    ...blank,
    id,
    overlayId,
    trigger,
    name: `alert-${trigger}-${Date.now().toString(36)}`.slice(0, 30),
    animation: 'love',
    text: trigger === 'follow' ? t('Thanks for the follow, {user}!') : '{user}: {amount}!',
    targetMode: 'none',
    userCooldownSec: 0,
    globalCooldownSec: 0,
  } as Command;
}

/** Names shown in the editor while nothing has happened on the channel yet. */
export const sampleData = (real: WidgetData | null, widgets: Widget[]): WidgetData => {
  const sample: WidgetData['latest'] = {
    follow: { user: 'NewFollower', amount: 1 },
    subscriber: { user: 'SuperSub', amount: 1 },
    gift: { user: 'KindGifter', amount: 5 },
    cheer: { user: 'BitBoss', amount: 500 },
    raid: { user: 'RaidLeader', amount: 42 },
  };
  const latest = { ...sample };
  for (const k of Object.keys(sample)) if (real?.latest[k]) latest[k] = real.latest[k];
  const goals: Record<number, number> = {};
  for (const w of widgets) if (w.type === 'goal') goals[w.id] = real?.goals[w.id] ?? w.config.start ?? 0;
  return { latest, goals };
};

/** Size of the box that stands for a command or alert on the canvas (before its own scale). */
export const cmdBox = (c: Command) => (c.animation === 'image' ? { w: 440, h: 380 } : { w: 680, h: 500 });
