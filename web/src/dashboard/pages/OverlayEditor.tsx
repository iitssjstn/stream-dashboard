import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ALERT_TYPES, api, LABELS, type Command, type OverlayProfile, type Trigger } from '../api';
import { CopyUrl } from '../components/Shared';
import { previewEvent } from '../components/OverlayPreview';
import { playEvent } from '../../overlay/renderer';
import { WidgetLayer, type WidgetData, type WidgetType } from '../../overlay/widgets';
import { StatusDot, Svg, useToast, type Icon } from '../ui';
import { t } from '../i18n';
import { CommandInspector, Section, WidgetInspector } from '../editor/Inspector';
import { cmdBox, makeCommand, makeWidget, sampleData, WIDGET_TYPES, type Doc, type Sel, type Widget } from '../editor/model';

const PRESETS = [
  [1920, 1080, '1080p'],
  [1280, 720, '720p'],
  [2560, 1440, '1440p'],
  [1080, 1920, 'Vertical'],
] as const;
const PAD = 48;
const PALETTE = ['#a855f7', '#3b82f6', '#ec4899', '#22d3ee', '#f59e0b', '#10b981', '#f43f5e', '#8b5cf6', '#84cc16', '#06b6d4'];
const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function cmdLabel(c: Command) {
  if (c.trigger === 'chat') return `!${c.name}`;
  const type = ALERT_TYPES.find((a) => a.trigger === c.trigger);
  return c.label || `${type?.label ?? c.trigger}${c.minAmount ? ` ${c.minAmount}+` : ''}`;
}

export function OverlayEditor() {
  const overlayId = Number(useParams().id);
  const nav = useNavigate();
  const toast = useToast();
  const [overlay, setOverlay] = useState<OverlayProfile | null>(null);
  const [overlayCount, setOverlayCount] = useState(1);
  const [allCmds, setAllCmds] = useState<Command[]>([]);
  const [doc, setDocState] = useState<Doc | null>(null);
  const [saved, setSaved] = useState<Doc | null>(null);
  const [data, setData] = useState<WidgetData | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState<'add' | 'emulate' | 'help' | null>(null);
  const [zoomMode, setZoomMode] = useState<number | 'fit'>('fit');
  const [fitZoom, setFitZoom] = useState(0.5);
  const [grid, setGrid] = useState(true);
  const [muted, setMuted] = useState(true);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);
  const [name, setName] = useState('');
  const [, rerender] = useState(0);
  const docRef = useRef<Doc | null>(null);
  const hist = useRef({ past: [] as Doc[], future: [] as Doc[], key: '', at: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const tempId = useRef(-1);
  const zoom = zoomMode === 'fit' ? fitZoom : zoomMode;

  const setDoc = (d: Doc | null) => {
    docRef.current = d;
    setDocState(d);
  };

  const load = useCallback(async () => {
    const [overlays, cmds, w] = await Promise.all([
      api<OverlayProfile[]>('/api/overlays'),
      api<Command[]>('/api/commands'),
      api<{ widgets: Widget[]; data: WidgetData }>(`/api/overlays/${overlayId}/widgets`),
    ]);
    const o = overlays.find((x) => x.id === overlayId);
    if (!o) throw new Error(t('Overlay not found'));
    setOverlay(o);
    setOverlayCount(overlays.length);
    setName(o.name);
    setAllCmds(cmds);
    setData(w.data);
    return { cmds: cmds.filter((c) => c.overlayId === overlayId && c.animation !== 'none'), widgets: w.widgets } as Doc;
  }, [overlayId]);

  useEffect(() => {
    load()
      .then((d) => {
        setDoc(d);
        setSaved(d);
      })
      .catch(() => nav('/overlay', { replace: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayId]);

  const dirty = useMemo(() => Boolean(doc && saved && !same(doc, saved)), [doc, saved]);

  /** Changes the document and remembers the previous state for undo. Quick edits of the same field are merged. */
  const apply = useCallback((fn: (d: Doc) => Doc, key = '') => {
    const cur = docRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (next === cur) return;
    const h = hist.current;
    const now = Date.now();
    if (!(key && h.key === key && now - h.at < 900)) {
      h.past.push(cur);
      if (h.past.length > 100) h.past.shift();
    }
    h.key = key;
    h.at = now;
    h.future = [];
    setDoc(next);
  }, []);

  const undo = useCallback(() => {
    const h = hist.current;
    const prev = h.past.pop();
    if (!prev || !docRef.current) return;
    h.future.push(docRef.current);
    h.key = '';
    setDoc(prev);
    rerender((n) => n + 1);
  }, []);
  const redo = useCallback(() => {
    const h = hist.current;
    const next = h.future.pop();
    if (!next || !docRef.current) return;
    h.past.push(docRef.current);
    h.key = '';
    setDoc(next);
    rerender((n) => n + 1);
  }, []);

  const selCmd = sel?.kind === 'cmd' ? doc?.cmds.find((c) => c.id === sel.id) ?? null : null;
  const selWidget = sel?.kind === 'widget' ? doc?.widgets.find((w) => w.id === sel.id) ?? null : null;
  const active: Sel = selCmd || selWidget ? sel : null;

  const patchCmd = useCallback((id: number, patch: Partial<Command>, key = '') => apply((d) => ({ ...d, cmds: d.cmds.map((c) => (c.id === id ? { ...c, ...patch } : c)) }), key && `c${id}-${key}`), [apply]);
  const patchWidget = useCallback((id: number, patch: Partial<Widget>, key = '') => apply((d) => ({ ...d, widgets: d.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)) }), key && `w${id}-${key}`), [apply]);

  const posOf = useCallback((s: NonNullable<Sel>) => {
    const d = docRef.current!;
    if (s.kind === 'widget') {
      const w = d.widgets.find((x) => x.id === s.id)!;
      return { x: w.x, y: w.y, scale: w.scale };
    }
    const c = d.cmds.find((x) => x.id === s.id)!;
    return { x: c.style.x, y: c.style.y, scale: c.style.scale };
  }, []);
  const setPos = useCallback(
    (s: NonNullable<Sel>, p: { x?: number; y?: number; scale?: number }, key: string) => {
      if (s.kind === 'widget') {
        patchWidget(s.id, { ...(p.x !== undefined && { x: r2(clamp(p.x, -20, 120)) }), ...(p.y !== undefined && { y: r2(clamp(p.y, -20, 120)) }), ...(p.scale !== undefined && { scale: clamp(Math.round(p.scale * 100) / 100, 0.1, 6) }) }, key);
      } else {
        const c = docRef.current!.cmds.find((x) => x.id === s.id)!;
        patchCmd(s.id, { style: { ...c.style, ...(p.x !== undefined && { x: r2(clamp(p.x, 0, 100)) }), ...(p.y !== undefined && { y: r2(clamp(p.y, 0, 100)) }), ...(p.scale !== undefined && { scale: clamp(Math.round(p.scale * 100) / 100, 0.2, 3) }) } }, key);
      }
    },
    [patchCmd, patchWidget],
  );

  const remove = useCallback(
    (s: NonNullable<Sel>) => {
      apply((d) => (s.kind === 'widget' ? { ...d, widgets: d.widgets.filter((w) => w.id !== s.id) } : { ...d, cmds: d.cmds.filter((c) => c.id !== s.id) }));
      setSel(null);
      if (s.kind === 'cmd') toast(t('Removed. Undo with Ctrl+Z; it is final once you save.'));
    },
    [apply, toast],
  );

  const duplicate = useCallback(
    (s: NonNullable<Sel>) => {
      const d = docRef.current!;
      const id = tempId.current--;
      if (s.kind === 'widget') {
        const w = d.widgets.find((x) => x.id === s.id)!;
        apply((cur) => ({ ...cur, widgets: [...cur.widgets, { ...w, id, name: `${w.name} 2`.slice(0, 60), x: r2(Math.min(120, w.x + 3)), y: r2(Math.min(120, w.y + 3)), config: structuredClone(w.config) }] }));
        setSel({ kind: 'widget', id });
      } else {
        const c = d.cmds.find((x) => x.id === s.id)!;
        const taken = new Set([...allCmds, ...d.cmds].map((x) => x.name));
        const fresh = makeCommand(c.trigger, id, overlayId, taken);
        apply((cur) => ({ ...cur, cmds: [...cur.cmds, { ...c, id, name: fresh.name, aliases: [], useCount: 0, style: { ...c.style, x: Math.min(100, c.style.x + 3), y: Math.min(100, c.style.y + 3) } }] }));
        setSel({ kind: 'cmd', id });
      }
    },
    [allCmds, apply, overlayId],
  );

  const addWidget = (type: WidgetType) => {
    const id = tempId.current--;
    const d = docRef.current!;
    apply((cur) => ({ ...cur, widgets: [...cur.widgets, makeWidget(type, id, cur.widgets.length, d.widgets.filter((w) => w.type === type).length + 1)] }));
    setSel({ kind: 'widget', id });
    setMenu(null);
    setShowRight(true);
  };
  const addCommand = (trigger: Trigger) => {
    const id = tempId.current--;
    const taken = new Set([...allCmds, ...docRef.current!.cmds].map((x) => x.name));
    apply((cur) => ({ ...cur, cmds: [...cur.cmds, makeCommand(trigger, id, overlayId, taken)] }));
    setSel({ kind: 'cmd', id });
    setMenu(null);
    setShowRight(true);
  };
  const adopt = (c: Command) => {
    apply((cur) => ({ ...cur, cmds: [...cur.cmds, { ...c, overlayId }] }));
    setSel({ kind: 'cmd', id: c.id });
    setMenu(null);
  };
  const moveLayer = (id: number, dir: 1 | -1) =>
    apply((d) => {
      const i = d.widgets.findIndex((w) => w.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.widgets.length) return d;
      const widgets = [...d.widgets];
      [widgets[i], widgets[j]] = [widgets[j], widgets[i]];
      return { ...d, widgets };
    });

  const save = useCallback(async () => {
    const start = docRef.current;
    if (!start || !saved || saving) return;
    const noImage = start.widgets.find((w) => w.type === 'image' && !w.config.url);
    if (noImage) {
      setSel({ kind: 'widget', id: noImage.id });
      return toast(t('Choose an image for “{name}” first.', { name: noImage.name }), 'error');
    }
    setSaving(true);
    let work = start;
    let selected = sel;
    let ok = false;
    try {
      for (const old of saved.cmds) if (!work.cmds.some((c) => c.id === old.id)) await api(`/api/commands/${old.id}`, { method: 'DELETE' });
      for (const c of start.cmds) {
        const before = saved.cmds.find((x) => x.id === c.id);
        const json = { ...c, aliases: c.aliases.filter(Boolean), overlayId };
        let row: Command | null = null;
        if (c.id < 0) row = await api<Command>('/api/commands', { method: 'POST', json });
        else {
          if (!before) await api(`/api/commands/${c.id}/overlay`, { method: 'PATCH', json: { overlayId } });
          if (!before || !same(before, c)) row = await api<Command>(`/api/commands/${c.id}`, { method: 'PUT', json });
        }
        if (row) {
          const fresh = row;
          work = { ...work, cmds: work.cmds.map((x) => (x.id === c.id ? fresh : x)) };
          if (selected?.kind === 'cmd' && selected.id === c.id) selected = { kind: 'cmd', id: fresh.id };
        }
      }
      if (!same(work.widgets, saved.widgets)) {
        const index = selected?.kind === 'widget' ? work.widgets.findIndex((w) => w.id === selected!.id) : -1;
        const res = await api<{ widgets: Widget[] }>(`/api/overlays/${overlayId}/widgets`, { method: 'PUT', json: { widgets: work.widgets.map((w, i) => ({ ...w, id: w.id > 0 ? w.id : undefined, z: i })) } });
        work = { ...work, widgets: res.widgets };
        if (index >= 0 && res.widgets[index]) selected = { kind: 'widget', id: res.widgets[index].id };
      }
      ok = true;
      toast(t('Overlay saved'));
    } catch (e) {
      toast(t('Not saved: {reason}', { reason: (e as Error).message }), 'error');
    } finally {
      try {
        const server = await load();
        setSaved(server);
        setDoc(ok ? server : work);
        hist.current = { past: [], future: [], key: '', at: 0 };
        setSel(selected);
      } catch {
        /* keep the current state; the next save tries again */
      }
      setSaving(false);
    }
  }, [load, overlayId, saved, saving, sel, toast]);

  const patchOverlay = async (patch: Partial<Pick<OverlayProfile, 'name' | 'width' | 'height'>>) => {
    try {
      const o = await api<OverlayProfile>(`/api/overlays/${overlayId}`, { method: 'PATCH', json: patch });
      setOverlay(o);
      setName(o.name);
    } catch (e) {
      toast((e as Error).message, 'error');
      setName(overlay?.name ?? '');
    }
  };

  /** Plays the alert a Twitch event would trigger: here in the editor and in OBS. */
  const emulate = async (trigger: Exclude<Trigger, 'chat'>) => {
    setMenu(null);
    const amount = trigger === 'cheer' ? 500 : trigger === 'raid' ? 42 : trigger === 'gift' ? 5 : trigger === 'resub' ? 6 : 1;
    const match = docRef.current?.cmds.filter((c) => c.enabled && c.trigger === trigger && amount >= c.minAmount).sort((a, b) => b.minAmount - a.minAmount)[0];
    if (!match) return toast(t('This overlay has no active alert for that event yet.'), 'error');
    setSel(null);
    if (stage.current) void playEvent(stage.current, previewEvent(match, 'TestViewer'), { muted });
    try {
      const r = await api<{ delivered: number }>(`/api/overlays/${overlayId}/emulate`, { method: 'POST', json: { type: trigger } });
      toast(r.delivered ? t('Played here and in OBS') : t('Played here (no overlay open in OBS)'));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const saveRef = useRef(save);
  saveRef.current = save;
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 's') {
        e.preventDefault();
        return void saveRef.current();
      }
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      const s = activeRef.current;
      if (mod && key === 'z') {
        e.preventDefault();
        return e.shiftKey ? redo() : undo();
      }
      if (mod && key === 'y') {
        e.preventDefault();
        return redo();
      }
      if (e.key === 'Escape') return setSel(null);
      if (!s || !overlay) return;
      if (mod && key === 'd') {
        e.preventDefault();
        return duplicate(s);
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        return remove(s);
      }
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (dir) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const p = posOf(s);
        setPos(s, { x: p.x + ((dir[0] * step) / overlay.width) * 100, y: p.y + ((dir[1] * step) / overlay.height) * 100 }, 'pos');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [duplicate, overlay, posOf, redo, remove, setPos, undo]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!doc || !overlay) {
    return (
      <div className="fixed inset-0 z-40 grid place-items-center bg-ink-950">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  const back = () => {
    if (dirty && !confirm(t('You have unsaved changes. Go back anyway?'))) return;
    nav('/overlay');
  };
  const others = allCmds.filter((c) => c.animation !== 'none' && c.overlayId !== overlayId && !doc.cmds.some((x) => x.id === c.id));
  const alerts = doc.cmds.filter((c) => c.trigger !== 'chat');
  const chats = doc.cmds.filter((c) => c.trigger === 'chat');
  const iconBtn = 'grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-zinc-300 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30';

  const layerRow = (s: NonNullable<Sel>, label: string, icon: keyof typeof Icon, enabled: boolean, toggle: () => void, extra?: ReactNode) => {
    const on = active?.kind === s.kind && active.id === s.id;
    return (
      <li key={`${s.kind}${s.id}`} className={`group flex items-center rounded-lg ${on ? 'bg-brand-500/20 ring-1 ring-brand-500/50' : 'hover:bg-white/[.05]'}`}>
        <button type="button" aria-pressed={on} onClick={() => setSel(s)} className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-2.5 py-2 text-left text-sm ${enabled ? 'text-zinc-100' : 'text-zinc-500'}`}>
          <Svg i={icon} className="h-4 w-4 shrink-0 text-zinc-400" />
          <span className="truncate">{label}</span>
        </button>
        {extra}
        <button type="button" title={enabled ? t('Hide') : t('Show')} aria-label={enabled ? t('Hide') : t('Show')} onClick={toggle} className="mr-1 grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-md text-zinc-500 hover:bg-white/10 hover:text-white">
          <Svg i={enabled ? 'eye' : 'eyeOff'} className="h-4 w-4" />
        </button>
      </li>
    );
  };
  const group = (title: string, items: ReactNode[]) =>
    items.length ? (
      <div>
        <h3 className="px-2.5 pt-3 pb-1 text-[10px] font-bold tracking-widest text-zinc-500 uppercase">{title}</h3>
        <ul className="space-y-0.5">{items}</ul>
      </div>
    ) : null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-ink-950 text-zinc-200">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/[.08] bg-ink-900 px-3">
        <button type="button" className={iconBtn} onClick={back} title={t('Back to overlays')} aria-label={t('Back to overlays')}>
          <Svg i="back" />
        </button>
        <button type="button" className={`${iconBtn} lg:hidden`} onClick={() => setShowLeft((v) => !v)} title={t('Layers')} aria-label={t('Layers')}>
          <Svg i="layers" />
        </button>
        <input
          aria-label={t('Overlay name')}
          className="w-32 min-w-0 shrink rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-base font-semibold text-white outline-none hover:border-white/10 focus:border-brand-500/60 sm:w-56"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => (name.trim() && name.trim() !== overlay.name ? void patchOverlay({ name: name.trim() }) : setName(overlay.name))}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <button
          type="button"
          title={t('Copy URL')}
          aria-label={t('Copy URL')}
          onClick={async () => {
            await navigator.clipboard.writeText(overlay.url);
            toast(t('Overlay URL copied. Paste it into OBS as a Browser Source.'));
          }}
          className="group flex min-w-0 shrink cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-ink-950/60 py-1.5 pr-2.5 pl-3 text-left transition hover:border-brand-500/60"
        >
          <Svg i="link" className="h-4 w-4 shrink-0 text-brand-400" />
          <code className="hidden min-w-0 truncate font-mono text-xs text-zinc-300 md:block">{overlay.url.replace(/\/overlay\/(.{4}).+$/, '/overlay/$1••••••••')}</code>
          <Svg i="copy" className="h-4 w-4 shrink-0 text-zinc-500 group-hover:text-white" />
        </button>
        {dirty && <span className="chip hidden bg-amber-500/15 text-amber-300 sm:inline-flex">{t('not saved')}</span>}
        <div className="ml-auto flex items-center gap-1">
          <div className="relative">
            <button type="button" className={iconBtn} onClick={() => setMenu(menu === 'help' ? null : 'help')} title={t('Help')} aria-label={t('Help')} aria-expanded={menu === 'help'}>
              <Svg i="help" />
            </button>
            {menu === 'help' && (
              <Popover onClose={() => setMenu(null)} className="top-11 right-0 w-80 p-4">
                <h3 className="mb-2 text-sm font-semibold text-white">{t('How it works')}</h3>
                <ul className="space-y-1.5 text-xs text-zinc-300">
                  <li>{t('Click a layer or an item on the canvas to select it; its settings open on the right.')}</li>
                  <li>{t('Drag to move, drag a corner to resize.')}</li>
                  {(
                    [
                      ['← ↑ ↓ →', t('Move 1 px (Shift: 10 px)')],
                      ['Delete', t('Remove the selected item')],
                      ['Ctrl+Z / Ctrl+Shift+Z', t('Undo / redo')],
                      ['Ctrl+D', t('Duplicate')],
                      ['Ctrl+S', t('Save')],
                      ['Ctrl + scroll', t('Zoom')],
                    ] as const
                  ).map(([k, l]) => (
                    <li key={k} className="flex justify-between gap-3">
                      <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-zinc-100">{k}</kbd>
                      <span className="text-right">{l}</span>
                    </li>
                  ))}
                </ul>
              </Popover>
            )}
          </div>
          <button type="button" className={`${iconBtn} md:hidden`} onClick={() => setShowRight((v) => !v)} title={t('Settings')} aria-label={t('Settings')}>
            <Svg i="cog" />
          </button>
          <a className="btn-ghost hidden px-5 py-2 sm:inline-flex" href={overlay.url} target="_blank" rel="noreferrer" title={t('Opens the real overlay in a new tab')}>
            {t('Preview')}
          </a>
          <button type="button" className="btn-primary px-6 py-2" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? t('Saving…') : dirty ? t('Save') : t('Saved')}
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <aside className={`${showLeft ? 'flex' : 'hidden'} absolute inset-y-0 left-0 z-20 w-64 shrink-0 flex-col border-r border-white/[.08] bg-ink-900 lg:static lg:flex`} aria-label={t('Layers')}>
          <div className="flex items-center justify-between border-b border-white/[.06] px-3 py-2.5">
            <h2 className="flex items-center gap-2 text-xs font-bold tracking-widest text-zinc-300 uppercase">
              <Svg i="layers" className="h-4 w-4 text-brand-400" /> {t('Layers')}
            </h2>
            <div className="flex">
              <button type="button" className={`${iconBtn} h-8 w-8`} disabled={!active} title={t('Centre')} aria-label={t('Centre')} onClick={() => active && setPos(active, { x: 50, y: 50 }, '')}>
                <Svg i="center" className="h-4 w-4" />
              </button>
              <button type="button" className={`${iconBtn} h-8 w-8`} disabled={!active} title={t('Duplicate')} aria-label={t('Duplicate')} onClick={() => active && duplicate(active)}>
                <Svg i="copy" className="h-4 w-4" />
              </button>
              <button type="button" className={`${iconBtn} h-8 w-8`} disabled={!active} title={t('Delete')} aria-label={t('Delete')} onClick={() => active && remove(active)}>
                <Svg i="trash" className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {group(
              t('Widgets'),
              [...doc.widgets].reverse().map((w) =>
                layerRow(
                  { kind: 'widget', id: w.id },
                  w.name,
                  WIDGET_TYPES.find((x) => x.type === w.type)!.icon,
                  w.enabled,
                  () => patchWidget(w.id, { enabled: !w.enabled }),
                  <span className="hidden shrink-0 group-hover:flex">
                    <button type="button" title={t('Bring forward')} aria-label={t('Bring forward')} onClick={() => moveLayer(w.id, 1)} className="grid h-7 w-6 cursor-pointer place-items-center text-zinc-500 hover:text-white">
                      <Svg i="up" className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" title={t('Send backward')} aria-label={t('Send backward')} onClick={() => moveLayer(w.id, -1)} className="grid h-7 w-6 cursor-pointer place-items-center text-zinc-500 hover:text-white">
                      <Svg i="up" className="h-3.5 w-3.5 rotate-180" />
                    </button>
                  </span>,
                ),
              ),
            )}
            {group(t('Alerts'), alerts.map((c) => layerRow({ kind: 'cmd', id: c.id }, cmdLabel(c), 'bell', c.enabled, () => patchCmd(c.id, { enabled: !c.enabled }))))}
            {group(t('Commands'), chats.map((c) => layerRow({ kind: 'cmd', id: c.id }, cmdLabel(c), 'bolt', c.enabled, () => patchCmd(c.id, { enabled: !c.enabled }))))}
            {!doc.widgets.length && !doc.cmds.length && <p className="p-3 text-sm text-zinc-500">{t('This overlay is still empty. Add your first widget with the button at the bottom.')}</p>}
          </div>
        </aside>

        <main className="relative min-w-0 flex-1">
          <Canvas
            overlay={overlay}
            doc={doc}
            data={data}
            sel={active}
            zoom={zoom}
            grid={grid}
            muted={muted}
            stage={stage}
            onFit={setFitZoom}
            onZoom={(z) => setZoomMode(clamp(z, 0.1, 3))}
            onSelect={(s) => {
              setSel(s);
              if (s) setShowLeft(false);
            }}
            posOf={posOf}
            setPos={setPos}
          />
          {active && (
            <div className="pointer-events-none absolute bottom-20 left-5 hidden text-sm text-zinc-500 sm:block">
              {t('Delete with')} <kbd className="rounded-md border border-white/15 px-1.5 py-0.5 font-mono text-xs">delete</kbd>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-4 flex justify-center px-2">
            <div className="relative flex max-w-full items-center gap-0.5 rounded-2xl border border-white/10 bg-ink-800/95 p-1.5 shadow-[0_0_0_1px_rgb(168_85_247/.15),0_18px_40px_-12px_#000] backdrop-blur" role="toolbar" aria-label={t('Editor tools')}>
              <button type="button" className="btn px-3 py-2 text-zinc-100 hover:bg-white/10" aria-expanded={menu === 'add'} onClick={() => setMenu(menu === 'add' ? null : 'add')}>
                <Svg i="plus" className="h-4 w-4" /> {t('Add widget')}
              </button>
              <button type="button" className="btn px-3 py-2 text-zinc-100 hover:bg-white/10" aria-expanded={menu === 'emulate'} onClick={() => setMenu(menu === 'emulate' ? null : 'emulate')}>
                <Svg i="bell" className="h-4 w-4" /> {t('Emulate')}
              </button>
              <span className="mx-1 h-6 w-px bg-white/10" />
              <button type="button" className={iconBtn} disabled={!hist.current.past.length} onClick={undo} title={t('Undo')} aria-label={t('Undo')}><Svg i="undo" className="h-4 w-4" /></button>
              <button type="button" className={iconBtn} disabled={!hist.current.future.length} onClick={redo} title={t('Redo')} aria-label={t('Redo')}><Svg i="redo" className="h-4 w-4" /></button>
              <span className="mx-1 h-6 w-px bg-white/10" />
              <button type="button" className={iconBtn} onClick={() => setZoomMode(clamp(zoom * 1.2, 0.1, 3))} title={t('Zoom in')} aria-label={t('Zoom in')}><Svg i="zoomIn" className="h-4 w-4" /></button>
              <button type="button" className="hidden w-12 cursor-pointer text-center text-xs font-semibold text-zinc-400 hover:text-white sm:block" onClick={() => setZoomMode(1)} title={t('Zoom to 100%')}>{Math.round(zoom * 100)}%</button>
              <button type="button" className={iconBtn} onClick={() => setZoomMode(clamp(zoom / 1.2, 0.1, 3))} title={t('Zoom out')} aria-label={t('Zoom out')}><Svg i="zoomOut" className="h-4 w-4" /></button>
              <button type="button" className={`${iconBtn} ${zoomMode === 'fit' ? 'text-brand-400' : ''}`} onClick={() => setZoomMode('fit')} title={t('Fit to screen')} aria-label={t('Fit to screen')}><Svg i="fit" className="h-4 w-4" /></button>
              <span className="mx-1 h-6 w-px bg-white/10" />
              <button type="button" className={`${iconBtn} ${grid ? 'text-brand-400' : ''}`} aria-pressed={grid} onClick={() => setGrid(!grid)} title={t('Grid')} aria-label={t('Grid')}><Svg i="grid" className="h-4 w-4" /></button>
              <button type="button" className={`${iconBtn} ${muted ? '' : 'text-brand-400'}`} aria-pressed={!muted} onClick={() => setMuted(!muted)} title={muted ? t('Sound is off') : t('Sound is on')} aria-label={t('Sound')}><Svg i={muted ? 'soundOff' : 'sound'} className="h-4 w-4" /></button>

              {menu === 'add' && (
                <Popover onClose={() => setMenu(null)} className="bottom-14 left-0 max-h-[70vh] w-[min(92vw,26rem)] overflow-y-auto p-3">
                  <h3 className="px-1 pb-2 text-[10px] font-bold tracking-widest text-zinc-500 uppercase">{t('Widgets')}</h3>
                  <div className="grid grid-cols-2 gap-1.5">
                    {WIDGET_TYPES.map((w) => (
                      <button key={w.type} type="button" onClick={() => addWidget(w.type)} className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-white/[.08] p-2.5 text-left transition hover:border-brand-500/50 hover:bg-brand-500/10">
                        <Svg i={w.icon} className="mt-0.5 h-5 w-5 shrink-0 text-brand-400" />
                        <span>
                          <span className="block text-sm font-semibold text-white">{t(w.label)}</span>
                          <span className="block text-[11px] leading-snug text-zinc-400">{t(w.hint)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <h3 className="px-1 pt-3 pb-2 text-[10px] font-bold tracking-widest text-zinc-500 uppercase">{t('Commands and alerts')}</h3>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => addCommand('chat')}><Svg i="bolt" className="h-3.5 w-3.5" /> {t('Chat command')}</button>
                    {ALERT_TYPES.map((a) => (
                      <button key={a.trigger} type="button" className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => addCommand(a.trigger)}><Svg i="bell" className="h-3.5 w-3.5" /> {a.label}</button>
                    ))}
                  </div>
                  {others.length > 0 && (
                    <label className="mt-3 block">
                      <span className="mb-1 block px-1 text-[10px] font-bold tracking-widest text-zinc-500 uppercase">{t('Move here from another overlay')}</span>
                      <select className="input py-1.5" value="" onChange={(e) => { const c = others.find((x) => x.id === Number(e.target.value)); if (c) adopt(c); }}>
                        <option value="">{t('Choose a command or alert')}</option>
                        {others.map((c) => <option key={c.id} value={c.id}>{cmdLabel(c)}</option>)}
                      </select>
                    </label>
                  )}
                </Popover>
              )}
              {menu === 'emulate' && (
                <Popover onClose={() => setMenu(null)} className="bottom-14 left-24 w-64 p-3">
                  <p className="px-1 pb-2 text-xs text-zinc-400">{t('Play a test event to see your alert. Nothing is sent to chat.')}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {ALERT_TYPES.map((a) => (
                      <button key={a.trigger} type="button" className="btn-ghost px-2 py-2 text-xs" onClick={() => void emulate(a.trigger)}>{a.label}</button>
                    ))}
                  </div>
                </Popover>
              )}
            </div>
          </div>
        </main>

        <aside className={`${showRight ? 'block' : 'hidden'} absolute inset-y-0 right-0 z-20 w-80 max-w-full shrink-0 overflow-y-auto border-l border-white/[.08] bg-ink-900 md:static md:block`} aria-label={t('Settings')}>
          {selWidget ? (
            <WidgetInspector key={`w${selWidget.id}`} w={selWidget} width={overlay.width} height={overlay.height} onChange={(p, k) => patchWidget(selWidget.id, p, k)} />
          ) : selCmd ? (
            <>
              <CommandInspector key={`c${selCmd.id}`} c={selCmd} width={overlay.width} height={overlay.height} onChange={(p, k) => patchCmd(selCmd.id, p, k)} />
              {selCmd.id > 0 && (
                <div className="p-4">
                  <button
                    type="button"
                    className="btn-ghost w-full py-2 text-xs"
                    onClick={async () => {
                      if (dirty) await save();
                      const r = await api<{ delivered: number }>(`/api/commands/${selCmd.id}/test`, { method: 'POST' });
                      toast(r.delivered ? t('Played in OBS') : t('No overlay open in OBS'), r.delivered ? 'ok' : 'error');
                    }}
                  >
                    <Svg i="play" className="h-3 w-3" /> {dirty ? t('Save & test in OBS') : t('Test in OBS')}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="border-b border-white/[.06] p-4">
                <h2 className="text-sm font-semibold text-white">{t('Overlay settings')}</h2>
                <p className="mt-1 text-xs text-zinc-400">{t('Select a layer to edit it, or add a widget with the button at the bottom.')}</p>
              </div>
              <Section title={t('Add to OBS')} defaultOpen>
                <span className="flex items-center gap-2 text-xs text-zinc-300">
                  <StatusDot tone={overlay.connectedClients ? 'ok' : 'off'} />
                  {overlay.connectedClients ? t('{n} browser source(s) connected', { n: overlay.connectedClients }) : t('Not opened in OBS yet')}
                </span>
                <CopyUrl url={overlay.url} />
                <p className="text-[11px] leading-snug text-zinc-500">{t('In OBS: add a Browser Source, paste this URL and set the size to {w}×{h}. Keep the URL secret.', { w: overlay.width, h: overlay.height })}</p>
              </Section>
              <Section title={t('Resolution')} defaultOpen>
                <div className="grid grid-cols-2 gap-1.5">
                  {PRESETS.map(([pw, ph, l]) => (
                    <button key={l} type="button" aria-pressed={overlay.width === pw && overlay.height === ph} onClick={() => void patchOverlay({ width: pw, height: ph })} className={`cursor-pointer rounded-lg border px-2 py-1.5 text-left text-xs transition ${overlay.width === pw && overlay.height === ph ? 'border-brand-500 bg-brand-500/15 text-white' : 'border-white/10 text-zinc-300 hover:bg-white/[.05]'}`}>
                      <span className="block font-semibold">{t(l)}</span>
                      <span className="block text-zinc-500">{pw}×{ph}</span>
                    </button>
                  ))}
                </div>
              </Section>
              <Section title={t('Danger zone')}>
                <button
                  type="button"
                  className="btn-danger w-full py-2 text-xs"
                  onClick={async () => {
                    if (!confirm(t('Create a new URL? You will need to update the Browser Source in OBS afterwards.'))) return;
                    const r = await api<{ url: string }>(`/api/overlays/${overlayId}/regenerate`, { method: 'POST' });
                    setOverlay({ ...overlay, url: r.url, connectedClients: 0 });
                    toast(t('New overlay URL created'));
                  }}
                >
                  <Svg i="refresh" className="h-3.5 w-3.5" /> {t('Generate new URL')}
                </button>
                {overlayCount > 1 && (
                  <button
                    type="button"
                    className="btn-danger w-full py-2 text-xs"
                    onClick={async () => {
                      if (!confirm(t('Delete this overlay? Its commands will move to another overlay.'))) return;
                      await api(`/api/overlays/${overlayId}`, { method: 'DELETE' });
                      nav('/overlay');
                    }}
                  >
                    <Svg i="trash" className="h-3.5 w-3.5" /> {t('Delete overlay')}
                  </button>
                )}
              </Section>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function Popover({ children, onClose, className }: { children: ReactNode; onClose: () => void; className: string }) {
  return (
    <>
      <button type="button" aria-label={t('Close')} className="fixed inset-0 z-30 cursor-default" onClick={onClose} />
      <div role="dialog" className={`fade-in absolute z-40 rounded-2xl border border-white/10 bg-ink-800 shadow-2xl shadow-black/70 ${className}`}>{children}</div>
    </>
  );
}

type CanvasProps = {
  overlay: OverlayProfile;
  doc: Doc;
  data: WidgetData | null;
  sel: Sel;
  zoom: number;
  grid: boolean;
  muted: boolean;
  stage: React.RefObject<HTMLDivElement | null>;
  onFit: (zoom: number) => void;
  onZoom: (zoom: number) => void;
  onSelect: (s: Sel) => void;
  posOf: (s: NonNullable<Sel>) => { x: number; y: number; scale: number };
  setPos: (s: NonNullable<Sel>, p: { x?: number; y?: number; scale?: number }, key: string) => void;
};

/** The artboard: the real widget renderer plus boxes for commands and alerts, with drag, resize and zoom. */
function Canvas({ overlay, doc, data, sel, zoom, grid, muted, stage, onFit, onZoom, onSelect, posOf, setPos }: CanvasProps) {
  const W = overlay.width;
  const H = overlay.height;
  const scroller = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const layer = useRef<WidgetLayer | null>(null);
  const drag = useRef<null | { mode: 'move' | 'scale'; sel: NonNullable<Sel>; sx: number; sy: number; ox: number; oy: number; os: number; cx: number; cy: number; d0: number; moved: boolean }>(null);
  const [frame, setFrame] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  const [guides, setGuides] = useState({ v: false, h: false });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const selCmd = sel?.kind === 'cmd' ? doc.cmds.find((c) => c.id === sel.id) ?? null : null;

  useEffect(() => {
    const el = scroller.current!;
    const fit = () => onFit(clamp(Math.min((el.clientWidth - PAD * 2) / W, (el.clientHeight - PAD * 2 - 40) / H), 0.1, 3));
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      onZoom(zoomRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', wheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, H]);

  useEffect(() => {
    const l = new WidgetLayer(stage.current!);
    layer.current = l;
    return () => l.destroy();
  }, [stage]);
  useEffect(() => {
    layer.current?.update(doc.widgets.map((w, i) => ({ ...w, z: i })), sampleData(data, doc.widgets));
    for (const w of doc.widgets) stage.current?.querySelector<HTMLElement>(`[data-wid="${w.id}"]`)?.classList.toggle('wl-off', !w.enabled);
  }, [doc.widgets, data, stage]);

  // The selected command or alert plays in a loop, with the same renderer as OBS.
  const sig = selCmd ? JSON.stringify({ ...selCmd, style: { ...selCmd.style, x: 0, y: 0, scale: 1 } }) : '';
  useEffect(() => {
    if (!selCmd) return;
    let run = true;
    const s = stage.current!;
    const loop = async () => {
      while (run) {
        await playEvent(s, previewEvent(selCmd), { muted });
        await new Promise((r) => setTimeout(r, 700));
      }
    };
    const timer = setTimeout(loop, 150);
    return () => {
      run = false;
      clearTimeout(timer);
      s.querySelectorAll('.lm-item').forEach((e) => e.remove());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, muted]);
  useEffect(() => {
    if (!selCmd) return;
    stage.current?.querySelectorAll<HTMLElement>('.lm-item').forEach((el) => {
      el.style.left = `${selCmd.style.x}%`;
      el.style.top = `${selCmd.style.y}%`;
      el.style.setProperty('--scale', String(selCmd.style.scale));
    });
  }, [selCmd?.style.x, selCmd?.style.y, selCmd?.style.scale, selCmd, stage]);

  const measure = useCallback(() => {
    const b = board.current;
    const el = sel && b ? (sel.kind === 'widget' ? b.querySelector(`[data-wid="${sel.id}"]`) : b.querySelector(`[data-cid="${sel.id}"]`)) : null;
    if (!el || !b) return setFrame((f) => (f ? null : f));
    const r = el.getBoundingClientRect();
    const o = b.getBoundingClientRect();
    const z = zoomRef.current;
    const next = { l: (r.left - o.left) / z, t: (r.top - o.top) / z, w: r.width / z, h: r.height / z };
    setFrame((f) => (f && Math.abs(f.l - next.l) + Math.abs(f.t - next.t) + Math.abs(f.w - next.w) + Math.abs(f.h - next.h) < 0.5 ? f : next));
  }, [sel]);
  useLayoutEffect(measure);
  useEffect(() => {
    // Fonts and images load later and change the size of a widget.
    const timer = setInterval(measure, 300);
    return () => clearInterval(timer);
  }, [measure]);

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const handle = target.closest('[data-handle]');
    const item = target.closest<HTMLElement>('[data-wid],[data-cid]');
    if (handle && sel && frame) {
      const o = board.current!.getBoundingClientRect();
      const cx = o.left + (frame.l + frame.w / 2) * zoom;
      const cy = o.top + (frame.t + frame.h / 2) * zoom;
      const p = posOf(sel);
      drag.current = { mode: 'scale', sel, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, os: p.scale, cx, cy, d0: Math.max(8, Math.hypot(e.clientX - cx, e.clientY - cy)), moved: true };
    } else if (item) {
      const s: NonNullable<Sel> = item.dataset.wid ? { kind: 'widget', id: Number(item.dataset.wid) } : { kind: 'cmd', id: Number(item.dataset.cid) };
      onSelect(s);
      const p = posOf(s);
      drag.current = { mode: 'move', sel: s, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, os: p.scale, cx: 0, cy: 0, d0: 1, moved: false };
    } else {
      onSelect(null);
      return;
    }
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'scale') return setPos(d.sel, { scale: d.os * (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) / d.d0) }, 'drag');
    const dx = (e.clientX - d.sx) / zoom;
    const dy = (e.clientY - d.sy) / zoom;
    if (!d.moved && Math.hypot(dx, dy) * zoom < 3) return;
    d.moved = true;
    let x = d.ox + (dx / W) * 100;
    let y = d.oy + (dy / H) * 100;
    // Snaps to the middle of the screen; hold Alt to place it freely.
    const snapX = !e.altKey && Math.abs(x - 50) < (8 / zoom / W) * 100;
    const snapY = !e.altKey && Math.abs(y - 50) < (8 / zoom / H) * 100;
    if (snapX) x = 50;
    if (snapY) y = 50;
    setGuides((g) => (g.v === snapX && g.h === snapY ? g : { v: snapX, h: snapY }));
    setPos(d.sel, { x, y }, 'drag');
  };
  const up = () => {
    drag.current = null;
    setGuides((g) => (g.v || g.h ? { v: false, h: false } : g));
  };

  const line = 2 / zoom;
  const knob = 12 / zoom;
  return (
    <div ref={scroller} className="wl-canvas absolute inset-0 overflow-auto" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className="relative" style={{ width: W * zoom + PAD * 2, height: H * zoom + PAD * 2 + 40, minWidth: '100%', minHeight: '100%' }}>
        <div ref={board} data-testid="artboard" className={`absolute touch-none ${grid ? 'wl-board-grid' : 'wl-board'}`} style={{ left: `max(${PAD}px, calc(50% - ${(W * zoom) / 2}px))`, top: `max(${PAD}px, calc(50% - ${(H * zoom) / 2 + 30}px))`, width: W, height: H, transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
          {doc.cmds.map((c, i) => {
            const box = cmdBox(c);
            const on = sel?.kind === 'cmd' && sel.id === c.id;
            const color = PALETTE[i % PALETTE.length];
            return (
              <div
                key={c.id}
                data-cid={c.id}
                title={LABELS.animation[c.animation]}
                className={`wl-cmd absolute cursor-grab rounded-xl active:cursor-grabbing ${c.enabled ? '' : 'wl-cmd-off'}`}
                style={{
                  left: `${c.style.x}%`,
                  top: `${c.style.y}%`,
                  width: box.w * c.style.scale,
                  height: box.h * c.style.scale,
                  transform: 'translate(-50%, -50%)',
                  border: on ? 'none' : `${line}px dashed ${color}`,
                  ['--tint' as string]: `${color}1f`,
                }}
              >
                {!on && (
                  <span className="wl-cmd-label absolute top-0 left-0 rounded-br-lg rounded-tl-lg px-2 py-0.5 font-mono font-semibold whitespace-nowrap text-white" style={{ background: color, fontSize: 12 / zoom }}>
                    {c.trigger === 'chat' ? '' : '🔔 '}
                    {cmdLabel(c)}
                  </span>
                )}
              </div>
            );
          })}
          <div ref={stage} className="lm-stage wl-stage" style={{ width: W, height: H, zIndex: 1 }} />
          {guides.v && <div className="pointer-events-none absolute inset-y-0 left-1/2 bg-cyan-400" style={{ width: line, marginLeft: -line / 2, zIndex: 5 }} />}
          {guides.h && <div className="pointer-events-none absolute inset-x-0 top-1/2 bg-cyan-400" style={{ height: line, marginTop: -line / 2, zIndex: 5 }} />}
          {frame && sel && (
            <div data-testid="selection" className="pointer-events-none absolute" style={{ left: frame.l, top: frame.t, width: frame.w, height: frame.h, outline: `${line}px solid #c084fc`, boxShadow: `0 0 ${14 / zoom}px rgb(168 85 247 / .55)`, zIndex: 6 }}>
              {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                <span
                  key={corner}
                  data-handle={corner}
                  className="pointer-events-auto absolute rounded-full border-white bg-brand-500"
                  style={{
                    width: knob,
                    height: knob,
                    borderWidth: line,
                    left: corner.endsWith('w') ? -knob / 2 : undefined,
                    right: corner.endsWith('e') ? -knob / 2 : undefined,
                    top: corner.startsWith('n') ? -knob / 2 : undefined,
                    bottom: corner.startsWith('s') ? -knob / 2 : undefined,
                    cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize',
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
