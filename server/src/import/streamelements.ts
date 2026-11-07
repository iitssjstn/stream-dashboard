/**
 * StreamElements -> Waviloop conversion. Field names follow StreamElements' published API spec
 * (github.com/StreamElements/api-docs): /channels/me, /bot/commands/{channel},
 * /bot/timers/{channel}, /overlays/{channel} and the "se-widget-alert-box" widget settings.
 */
import { config } from '../config.js';
import { defaultStyle } from '../commands/defaults.js';

export class SeError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function se<T>(path: string, jwt: string): Promise<T> {
  const res = await fetch(`${config.streamElementsApi}${path}`, {
    headers: { authorization: `Bearer ${jwt}`, accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new SeError(502, 'StreamElements is niet bereikbaar');
  });
  if (res.status === 401 || res.status === 403) throw new SeError(400, 'StreamElements weigert dit JWT-token (ongeldig of verlopen)');
  if (!res.ok) throw new SeError(502, `StreamElements gaf een fout (${res.status}) bij ${path.split('/').slice(0, 3).join('/')}`);
  return (await res.json()) as T;
}

// ---- variables ----

/** Converts StreamElements chat variables ($(x) or ${x}) to Waviloop's {x}. Unknown ones are kept and reported. */
export function convertChatVars(input: string) {
  const unsupported = new Set<string>();
  let usesTarget = false;
  const text = input.replace(/\$[({]\s*([^)}]+?)\s*[)}]/g, (whole, inner: string) => {
    const [name, ...rest] = inner.split(/\s+/);
    const key = name.toLowerCase();
    if (key === 'user' || key === 'sender' || key === 'user.name') return '{user}';
    if (key === 'touser') return (usesTarget = true), '{target}';
    if (key === 'channel') return '{channel}';
    if (key === 'count') return rest.length ? (unsupported.add(whole), '{count}') : '{count}';
    if (key === 'random') return '{random:1-100}';
    const r = /^random\.(-?\d+)-(-?\d+)$/.exec(key);
    if (r) return `{random:${r[1]}-${r[2]}}`;
    if (key === '1') return (usesTarget = true), '{target}';
    if (/^1:\d*$/.test(key) || key === '1:') return '{args}';
    unsupported.add(whole);
    return whole;
  });
  return { text, unsupported: [...unsupported], usesTarget };
}

/** Converts AlertBox placeholders ({name}, {amount}, {sender}, {message}) to Waviloop's. */
export function convertAlertText(input: string, trigger?: string) {
  const unsupported = new Set<string>();
  const text = input.replace(/\{(\w+)\}/g, (whole, key: string) => {
    switch (key.toLowerCase()) {
      case 'name':
        // For gifts StreamElements' {name} is the recipient; Twitch announces a gift batch without recipients.
        return trigger === 'gift' ? 'de chat' : '{user}';
      case 'sender':
        return '{user}';
      case 'amount':
        return '{amount}';
      case 'message':
        return '{message}';
      case 'tier':
        return '{tier}';
      default:
        unsupported.add(whole);
        return '';
    }
  });
  return { text: text.replace(/\s+/g, ' ').trim(), unsupported: [...unsupported] };
}

// ---- normalized preview items ----

export type ImportCommand = {
  key: string;
  name: string;
  aliases: string[];
  reply: string;
  permission: 'everyone' | 'subscriber' | 'vip' | 'moderator' | 'broadcaster';
  userCooldownSec: number;
  globalCooldownSec: number;
  enabled: boolean;
  targetFallback: string;
  warnings: string[];
};

export type ImportTimer = {
  key: string;
  name: string;
  messages: string[];
  intervalMin: number;
  offlineIntervalMin: number;
  minChatLines: number;
  enabled: boolean;
  warnings: string[];
};

export type ImportAlert = {
  key: string;
  label: string;
  /** Name of the StreamElements overlay this alert came from */
  overlay: string;
  trigger: 'follow' | 'subscriber' | 'resub' | 'gift' | 'cheer' | 'raid';
  enabled: boolean;
  minAmount: number;
  text: string;
  imageUrl: string | null;
  soundUrl: string | null;
  soundVolume: number;
  durationMs: number;
  fontFamily: string | null;
  fontSize: number | null;
  textColor: string | null;
  accentColor: string | null;
  warnings: string[];
};

export type ImportSkipped = { what: string; reason: string };

export type ImportPreview = {
  channel: { id: string; name: string };
  commands: ImportCommand[];
  timers: ImportTimer[];
  alerts: ImportAlert[];
  skipped: ImportSkipped[];
};

/** StreamElements accessLevel: 100 everyone, 250 subscriber, 300 regular, 400 VIP, 500 moderator, 1000 super mod, 1500 broadcaster. */
export function mapAccessLevel(level: number): ImportCommand['permission'] {
  if (level >= 1500) return 'broadcaster';
  if (level >= 500) return 'moderator';
  if (level >= 400) return 'vip';
  if (level >= 250) return 'subscriber';
  return 'everyone';
}

const NAME_RE = /^[a-z0-9_\-àáâäèéêëìíîïòóôöùúûü]{1,30}$/;
const cleanName = (n: unknown) => String(n ?? '').trim().replace(/^!/, '').toLowerCase();
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
const httpsUrl = (v: unknown) => (typeof v === 'string' && /^https:\/\/\S+$/.test(v) && v.length <= 500 ? v : null);
const hex = (v: unknown) => {
  if (typeof v !== 'string') return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  return m[1].length === 3 ? `#${[...m[1]].map((c) => c + c).join('')}`.toLowerCase() : `#${m[1]}`.toLowerCase();
};

export function convertCommands(raw: any[], skipped: ImportSkipped[]): ImportCommand[] {
  const out: ImportCommand[] = [];
  for (const c of raw ?? []) {
    const name = cleanName(c.command);
    if (!name || !NAME_RE.test(name)) {
      skipped.push({ what: `command "${c.command ?? '?'}"`, reason: 'naam bevat tekens die Waviloop niet ondersteunt' });
      continue;
    }
    if (typeof c.reply !== 'string' || !c.reply.trim()) {
      skipped.push({ what: `!${name}`, reason: 'heeft geen tekstantwoord' });
      continue;
    }
    const warnings: string[] = [];
    const conv = convertChatVars(c.reply);
    if (conv.unsupported.length) warnings.push(`Variabelen niet ondersteund (blijven als tekst staan): ${conv.unsupported.join(', ')}`);
    if (c.type && c.type !== 'say') warnings.push(`Type "${c.type}" wordt als gewoon chatbericht verstuurd`);
    if (num(c.cost, 0) > 0) warnings.push('Kosten in loyaliteitspunten worden niet overgenomen');
    if (Array.isArray(c.keywords) && c.keywords.length) warnings.push('Keywords (trigger zonder !) worden niet overgenomen');
    if (c.regex) warnings.push('Regex-trigger wordt niet overgenomen');
    if (c.enabledOnline === false || c.enabledOffline === false) warnings.push('Alleen-online/alleen-offline wordt niet overgenomen');
    const aliases = (Array.isArray(c.aliases) ? c.aliases : []).map(cleanName).filter((a: string) => NAME_RE.test(a) && a !== name);
    out.push({
      key: `cmd:${c._id ?? name}`,
      name,
      aliases: [...new Set<string>(aliases)].slice(0, 10),
      reply: conv.text.slice(0, 480),
      permission: mapAccessLevel(num(c.accessLevel, 100)),
      userCooldownSec: Math.max(0, Math.min(86_400, Math.round(num(c.cooldown?.user, 0)))),
      globalCooldownSec: Math.max(0, Math.min(86_400, Math.round(num(c.cooldown?.global, 0)))),
      enabled: c.enabled !== false,
      targetFallback: conv.usesTarget ? '{user}' : 'de streamer',
      warnings,
    });
  }
  return out;
}

export function convertTimers(raw: any[], skipped: ImportSkipped[]): ImportTimer[] {
  const out: ImportTimer[] = [];
  for (const t of raw ?? []) {
    const msgs: string[] = (Array.isArray(t.messages) ? t.messages : [t.message]).filter((m: unknown) => typeof m === 'string' && m.trim());
    const name = String(t.name ?? '').trim().slice(0, 60) || 'Timer';
    if (!msgs.length) {
      skipped.push({ what: `timer "${name}"`, reason: 'heeft geen berichten' });
      continue;
    }
    const warnings: string[] = [];
    const messages = msgs.slice(0, 20).map((m) => {
      const conv = convertChatVars(m);
      if (conv.unsupported.length) warnings.push(`Variabelen niet ondersteund: ${conv.unsupported.join(', ')}`);
      return conv.text.slice(0, 480);
    });
    const online = t.online ?? {};
    const offline = t.offline ?? {};
    const onlineOn = online.enabled !== false;
    if (!onlineOn && offline.enabled) warnings.push('Stond alleen offline aan; in Waviloop loopt hij ook tijdens de stream (pas het interval aan als je dat niet wilt)');
    out.push({
      key: `timer:${t._id ?? name}`,
      name,
      messages,
      intervalMin: Math.max(1, Math.min(1440, Math.round(num(online.interval, 15)))),
      offlineIntervalMin: offline.enabled ? Math.max(1, Math.min(1440, Math.round(num(offline.interval, 30)))) : 0,
      minChatLines: Math.max(0, Math.min(1000, Math.round(num(t.chatLines, 0)))),
      enabled: t.enabled !== false && (onlineOn || Boolean(offline.enabled)),
      warnings,
    });
  }
  return out;
}

const ALERT_TYPES: Record<string, ImportAlert['trigger'] | null> = {
  follower: 'follow',
  subscriber: 'subscriber',
  cheer: 'cheer',
  raid: 'raid',
  tip: null,
  host: null,
  merch: null,
  purchase: null,
  charityCampaignDonation: null,
};

function alertFrom(trigger: ImportAlert['trigger'], label: string, key: string, base: any, over: any, minAmount: number, enabled: boolean, overlay = ''): ImportAlert {
  const merged = { ...base, ...over, text: { ...base?.text, ...over?.text, css: { ...base?.text?.css, ...over?.text?.css } }, graphics: { ...base?.graphics, ...over?.graphics }, audio: { ...base?.audio, ...over?.audio } };
  const warnings: string[] = [];
  const conv = convertAlertText(String(merged.text?.message ?? ''), trigger);
  if (conv.unsupported.length) warnings.push(`Placeholders niet ondersteund (weggelaten): ${conv.unsupported.join(', ')}`);
  // Images, GIFs and videos (MP4/WebM, also with transparency) are all played by the overlay.
  const imageUrl = httpsUrl(merged.graphics?.src);
  if (merged.tts?.enabled) warnings.push('Text-to-speech wordt niet overgenomen');
  if (Array.isArray(merged.graphics?.list) || merged.enableRandomPick === false) {
    /* nothing: single graphic is used */
  }
  const css = merged.text?.css ?? {};
  return {
    key,
    label,
    overlay,
    trigger,
    enabled,
    minAmount,
    text: conv.text.slice(0, 200),
    imageUrl,
    soundUrl: httpsUrl(merged.audio?.src),
    soundVolume: Math.round(Math.max(0, Math.min(1, num(merged.audio?.volume, 0.5))) * 100),
    durationMs: Math.max(1500, Math.min(60_000, Math.round(num(merged.duration, 8) * 1000))),
    fontFamily: typeof css['font-family'] === 'string' ? css['font-family'].slice(0, 40) : null,
    fontSize: Number.isFinite(Number(css['font-size'])) ? Math.max(12, Math.min(140, Math.round(Number(css['font-size'])))) : null,
    textColor: hex(css.color),
    accentColor: hex(css.highlights?.color),
    warnings,
  };
}

/** Extracts alerts from all AlertBox widgets ("se-widget-alert-box") of all overlays. */
const SE_TYPE_LABEL: Record<string, string> = { follower: 'Follow', subscriber: 'Sub', cheer: 'Bits', raid: 'Raid' };

export function convertAlertBoxes(widgets: { overlay: string; widget: any }[], skipped: ImportSkipped[]): ImportAlert[] {
  const out: ImportAlert[] = [];
  widgets.forEach(({ overlay, widget: w }, wi) => {
    const vars = w?.variables ?? {};
    for (const [seType, cfg] of Object.entries<any>(vars)) {
      if (!(seType in ALERT_TYPES)) continue;
      const trigger = ALERT_TYPES[seType];
      if (!trigger) {
        skipped.push({ what: `${overlay ? `${overlay}: ` : ''}${seType}-alert`, reason: seType === 'host' ? 'Twitch heeft hosts afgeschaft' : 'bestaat niet als Twitch-event (StreamElements-eigen)' });
        continue;
      }
      const enabled = cfg?.enabled !== false;
      const prefix = `alert:${wi}:${seType}`;
      out.push(alertFrom(trigger, SE_TYPE_LABEL[seType] ?? seType, `${prefix}:base`, cfg, {}, Math.max(0, Math.round(num(cfg?.minAmount, 0))), enabled, overlay));
      (Array.isArray(cfg?.variations) ? cfg.variations : []).forEach((v: any, vi: number) => {
        const label = v?.name ? String(v.name).slice(0, 50) : `${SE_TYPE_LABEL[seType] ?? seType} variatie ${vi + 1}`;
        const settings = v?.settings ?? {};
        if (v?.type === 'gift' || v?.type === 'communityGift') {
          if (seType !== 'subscriber') return skipped.push({ what: label, reason: 'onbekende variatie' });
          out.push(alertFrom('gift', label, `${prefix}:v${vi}`, cfg, settings, v?.type === 'communityGift' ? 2 : 0, enabled, overlay));
        } else if (v?.type === 'amount' && (v?.condition ?? 'ATLEAST') === 'ATLEAST') {
          const req = Math.max(0, Math.round(num(v?.requirement, 0)));
          // For subscriptions the "amount" is the number of months, i.e. a resub.
          out.push(alertFrom(seType === 'subscriber' ? 'resub' : trigger, label, `${prefix}:v${vi}`, cfg, settings, req, enabled, overlay));
        } else {
          skipped.push({ what: label, reason: `variatie-type "${v?.type}${v?.condition ? ` ${v.condition}` : ''}" wordt niet ondersteund` });
        }
      });
    }
  });
  return out;
}

export async function fetchPreview(jwt: string): Promise<ImportPreview> {
  const me = await se<any>('/channels/me', jwt);
  const id = me?._id;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) throw new SeError(502, 'Onverwacht antwoord van StreamElements (geen kanaal-id)');
  const enc = encodeURIComponent(id);
  const skipped: ImportSkipped[] = [];
  const [rawCommands, rawTimers, overlays] = await Promise.all([
    se<any[]>(`/bot/commands/${enc}`, jwt),
    se<any[]>(`/bot/timers/${enc}`, jwt),
    se<any>(`/overlays/${enc}`, jwt),
  ]);
  const overlayList: any[] = Array.isArray(overlays) ? overlays : (overlays?.docs ?? []);
  const widgets: { overlay: string; widget: any }[] = [];
  for (const o of overlayList.slice(0, 50)) {
    if (typeof o?._id !== 'string') continue;
    const full = await se<any>(`/overlays/${enc}/${encodeURIComponent(o._id)}`, jwt);
    const overlay = String(full?.name ?? o.name ?? '').slice(0, 40);
    for (const w of full?.widgets ?? []) if (w?.type === 'se-widget-alert-box') widgets.push({ overlay, widget: w });
  }
  return {
    channel: { id, name: String(me.displayName ?? me.username ?? me.alias ?? 'StreamElements') },
    commands: convertCommands(Array.isArray(rawCommands) ? rawCommands : [], skipped),
    timers: convertTimers(Array.isArray(rawTimers) ? rawTimers : [], skipped),
    alerts: convertAlertBoxes(widgets, skipped),
    skipped,
  };
}

/** Builds a full Waviloop command body for validateCommand(). */
export function commandBody(c: ImportCommand) {
  return {
    name: c.name,
    trigger: 'chat',
    aliases: c.aliases,
    reply: c.reply,
    animation: 'none',
    text: '',
    showText: false,
    enabled: c.enabled,
    permission: c.permission,
    userCooldownSec: c.userCooldownSec,
    globalCooldownSec: c.globalCooldownSec,
    targetMode: 'optional',
    targetFallback: c.targetFallback,
    durationMs: 5000,
    style: defaultStyle(),
  };
}

const FALLBACK_ANIMATION: Record<ImportAlert['trigger'], string> = { follow: 'wave', subscriber: 'love', resub: 'love', gift: 'highfive', cheer: 'dance', raid: 'hug' };

export function alertBody(a: ImportAlert, name: string) {
  return {
    name,
    label: (a.overlay ? `${a.overlay} — ${a.label}` : a.label).slice(0, 80),
    trigger: a.trigger,
    minAmount: a.minAmount,
    animation: a.imageUrl ? 'image' : FALLBACK_ANIMATION[a.trigger],
    imageUrl: a.imageUrl,
    soundUrl: a.soundUrl,
    soundVolume: a.soundVolume,
    text: a.text || '{user}',
    showText: Boolean(a.text),
    durationMs: a.durationMs,
    enabled: a.enabled,
    permission: 'everyone',
    userCooldownSec: 0,
    globalCooldownSec: 0,
    targetMode: 'none',
    style: defaultStyle({
      ...(a.fontFamily ? { fontFamily: a.fontFamily } : {}),
      ...(a.fontSize ? { fontSize: a.fontSize } : {}),
      ...(a.textColor ? { textColor: a.textColor } : {}),
      ...(a.accentColor ? { accentColor: a.accentColor } : {}),
      particles: 'none',
      effect: 'fade',
    }),
  };
}
