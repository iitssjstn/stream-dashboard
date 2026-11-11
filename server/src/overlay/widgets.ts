import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { Widget, WidgetConfig } from '../db/schema.js';
import { ValidationError } from '../api/validate.js';
import type { OverlayHub } from './hub.js';

export const WIDGET_TYPES = ['text', 'image', 'latest', 'rotator', 'goal', 'countdown'] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];
/** Events a "latest …" widget or the rotator can show. */
export const WIDGET_EVENTS = ['follow', 'subscriber', 'gift', 'cheer', 'raid'] as const;
export const GOAL_METRICS = ['follow', 'sub', 'bits'] as const;
const BACKGROUNDS = ['none', 'pill', 'box'] as const;
const MAX_WIDGETS = 40;

const num = (v: unknown, name: string, min: number, max: number, fallback?: number) => {
  const n = v === undefined || v === null || v === '' ? fallback : Number(v);
  if (n === undefined || !Number.isFinite(n) || n < min || n > max) throw new ValidationError(`${name} must be between ${min} and ${max}`);
  return n;
};
const text = (v: unknown, name: string, max: number, required = false) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s && required) throw new ValidationError(`${name} is required`);
  if (s.length > max) throw new ValidationError(`${name} is too long (max ${max})`);
  return s;
};
const hex = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback);
const pick = <T extends readonly string[]>(v: unknown, list: T, fallback: T[number]): T[number] => (typeof v === 'string' && list.includes(v) ? (v as T[number]) : fallback);
const media = (v: unknown, name: string) => {
  const s = text(v, name, 500, true);
  if (!/^\/uploads\/[\w.-]+$/.test(s) && !/^https:\/\/[^\s]+$/.test(s)) throw new ValidationError(`${name} must be an upload or https URL`);
  return s;
};

function textStyle(c: any) {
  return {
    fontFamily: text(c?.fontFamily, 'Font', 40) || 'Fredoka',
    fontSize: Math.round(num(c?.fontSize, 'Font size', 12, 300, 48)),
    color: hex(c?.color, '#ffffff'),
    accentColor: hex(c?.accentColor, '#a855f7'),
    shadow: c?.shadow !== false,
    background: pick(c?.background, BACKGROUNDS, 'none'),
  };
}

function validateConfig(type: WidgetType, c: any): WidgetConfig {
  switch (type) {
    case 'text':
      return { ...textStyle(c), text: text(c?.text, 'Text', 300, true) };
    case 'image':
      return { url: media(c?.url, 'Image'), width: Math.round(num(c?.width, 'Width', 20, 3840, 400)) };
    case 'latest':
      return { ...textStyle(c), event: pick(c?.event, WIDGET_EVENTS, 'follow'), template: text(c?.template, 'Text', 200, true), empty: text(c?.empty, 'Text', 80) };
    case 'rotator': {
      const events = Array.isArray(c?.events) ? WIDGET_EVENTS.filter((e) => c.events.includes(e)) : [];
      if (!events.length) throw new ValidationError('Choose at least one event for the rotator');
      const templates: Record<string, string> = {};
      for (const e of WIDGET_EVENTS) templates[e] = text(c?.templates?.[e], 'Text', 200);
      return { ...textStyle(c), events, templates, intervalSec: Math.round(num(c?.intervalSec, 'Interval', 2, 120, 6)) };
    }
    case 'goal':
      return {
        ...textStyle(c),
        metric: pick(c?.metric, GOAL_METRICS, 'follow'),
        title: text(c?.title, 'Title', 80),
        target: Math.round(num(c?.target, 'Goal', 1, 1_000_000_000, 100)),
        start: Math.round(num(c?.start, 'Start value', 0, 1_000_000_000, 0)),
        since: Math.round(num(c?.since, 'Start time', 0, 9e15, Date.now())),
        width: Math.round(num(c?.width, 'Width', 200, 3840, 640)),
        barColor: hex(c?.barColor, '#a855f7'),
      };
    case 'countdown':
      return {
        ...textStyle(c),
        label: text(c?.label, 'Label', 80),
        seconds: Math.round(num(c?.seconds, 'Duration', 5, 86_400, 300)),
        endsAt: c?.endsAt ? Math.round(num(c.endsAt, 'End time', 0, 9e15)) : null,
        endText: text(c?.endText, 'Text', 80),
      };
  }
}

export type WidgetInput = { id?: number; type: WidgetType; name: string; enabled: boolean; x: number; y: number; scale: number; z: number; config: WidgetConfig };

export function validateWidgets(body: any): WidgetInput[] {
  if (!Array.isArray(body?.widgets)) throw new ValidationError('Widgets are required');
  if (body.widgets.length > MAX_WIDGETS) throw new ValidationError(`At most ${MAX_WIDGETS} widgets per overlay`);
  return body.widgets.map((w: any, i: number) => {
    if (!WIDGET_TYPES.includes(w?.type)) throw new ValidationError('Invalid widget type');
    return {
      id: Number.isInteger(w.id) && w.id > 0 ? w.id : undefined,
      type: w.type,
      name: text(w.name, 'Name', 60) || w.type,
      enabled: w.enabled !== false,
      x: Math.round(num(w.x, 'Position X', -20, 120, 50) * 100) / 100,
      y: Math.round(num(w.y, 'Position Y', -20, 120, 50) * 100) / 100,
      scale: Math.round(num(w.scale, 'Size', 0.1, 6, 1) * 1000) / 1000,
      z: Number.isInteger(w.z) ? w.z : i,
      config: validateConfig(w.type, w.config ?? {}),
    };
  });
}

/** Replaces the overlay's widgets with the given list (updates, inserts and deletes in one go). */
export function saveWidgets(userId: number, overlayId: number, list: WidgetInput[]) {
  const now = Date.now();
  db.transaction((tx) => {
    const existing = new Set(tx.select({ id: schema.widgets.id }).from(schema.widgets).where(eq(schema.widgets.overlayId, overlayId)).all().map((w) => w.id));
    const kept = new Set<number>();
    for (const w of list) {
      const { id, ...data } = w;
      if (id && existing.has(id)) {
        kept.add(id);
        tx.update(schema.widgets).set({ ...data, updatedAt: now }).where(eq(schema.widgets.id, id)).run();
      } else tx.insert(schema.widgets).values({ ...data, userId, overlayId, createdAt: now, updatedAt: now }).run();
    }
    const gone = [...existing].filter((id) => !kept.has(id));
    if (gone.length) tx.delete(schema.widgets).where(inArray(schema.widgets.id, gone)).run();
  });
}

export const listWidgets = (overlayId: number): Widget[] =>
  db.select().from(schema.widgets).where(eq(schema.widgets.overlayId, overlayId)).orderBy(schema.widgets.z, schema.widgets.id).all();

type Latest = Record<string, { user: string; amount: number } | null>;

/** Live values the widgets show: the latest event per type and the progress of each goal. */
export function widgetData(userId: number, widgets: Widget[]) {
  const latest: Latest = {};
  for (const type of WIDGET_EVENTS) {
    const row = db
      .select()
      .from(schema.streamEvents)
      .where(and(eq(schema.streamEvents.userId, userId), eq(schema.streamEvents.type, type)))
      .orderBy(desc(schema.streamEvents.id))
      .get();
    latest[type] = row ? { user: row.viewer, amount: row.amount } : null;
  }
  const goals: Record<number, number> = {};
  for (const w of widgets) {
    if (w.type !== 'goal') continue;
    const c = w.config as { metric: string; start: number; since: number };
    const types = c.metric === 'follow' ? ['follow'] : c.metric === 'bits' ? ['cheer'] : ['subscriber', 'resub', 'gift'];
    // Followers and (re)subs count as one each, gifted subs and bits by their amount.
    const value = c.metric === 'follow' ? sql<number>`count(*)` : sql<number>`coalesce(sum(case when ${schema.streamEvents.type} in ('subscriber', 'resub') then 1 else ${schema.streamEvents.amount} end), 0)`;
    const row = db
      .select({ value })
      .from(schema.streamEvents)
      .where(and(eq(schema.streamEvents.userId, userId), inArray(schema.streamEvents.type, types), gte(schema.streamEvents.createdAt, c.since)))
      .get();
    goals[w.id] = c.start + (row?.value ?? 0);
  }
  return { latest, goals };
}

export function widgetState(userId: number, overlayId: number) {
  const widgets = listWidgets(overlayId);
  const shown = widgets.filter((w) => w.enabled);
  return { type: 'widgets' as const, widgets: shown.map(({ id, type, x, y, scale, z, config }) => ({ id, type, x, y, scale, z, config })), data: widgetData(userId, shown) };
}

export function pushWidgets(hub: OverlayHub, userId: number, overlayId: number) {
  if (hub.count(overlayId)) hub.broadcast(overlayId, widgetState(userId, overlayId));
}

/** Stores a Twitch event and refreshes the widgets in every connected overlay of this streamer. */
export function recordStreamEvent(hub: OverlayHub, userId: number, ev: { type: string; user: string; amount?: number }) {
  db.insert(schema.streamEvents).values({ userId, type: ev.type, viewer: ev.user.slice(0, 60), amount: Math.round(ev.amount ?? 0), createdAt: Date.now() }).run();
  for (const o of db.select({ id: schema.overlays.id }).from(schema.overlays).where(eq(schema.overlays.userId, userId)).all()) pushWidgets(hub, userId, o.id);
}
