import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useMe } from '../App';
import { api, LABELS, type Command } from '../api';
import { usePoll } from '../hooks';
import { CopyUrl } from '../components/Shared';
import { OverlayPreview } from '../components/OverlayPreview';
import { PageHeader, StatusDot, Svg, useToast } from '../ui';
import { t } from '../i18n';

const PRESETS = [
  [1920, 1080, '1080p'],
  [1280, 720, '720p'],
  [2560, 1440, '1440p'],
  [1080, 1920, 'Vertical'],
] as const;

export function OverlayPage() {
  const { me, reload } = useMe();
  const toast = useToast();
  const { data: allCmds, reload: reloadCmds, setData } = usePoll<Command[]>('/api/commands');
  // Only things that actually appear in the overlay; alerts included.
  const cmds = allCmds?.filter((c) => c.animation !== 'none') ?? null;
  const [w, setW] = useState(me.overlay.width);
  const [h, setH] = useState(me.overlay.height);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const saveRes = async (width: number, height: number) => {
    setW(width);
    setH(height);
    await api('/api/settings', { method: 'PATCH', json: { overlayWidth: width, overlayHeight: height } });
    toast(t('Resolution set to {w}×{h}. Also update the Browser Source in OBS.', { w: width, h: height }));
    void reload();
  };

  const sel = cmds?.find((c) => c.id === selected) ?? null;

  return (
    <>
      <PageHeader title="Overlay" subtitle={t('One URL for all your interactive elements. Works independently of this dashboard.')} />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card space-y-4 p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-white">{t('Your overlay URL')}</h2>
            <span className="flex items-center gap-2 text-sm text-zinc-300">
              <StatusDot tone={me.overlay.connectedClients ? 'ok' : 'off'} />
              {me.overlay.connectedClients ? t('{n} browser source(s) connected', { n: me.overlay.connectedClients }) : t('Not opened in OBS yet')}
            </span>
          </div>
          <CopyUrl url={me.overlay.url} />
          <p className="text-xs text-zinc-500">
            {t('This URL is secret: anyone who has it can see your overlay. Leaked? Create a new one; the old one stops working immediately. Add ?debug to the URL to show the connection status on screen.')}
          </p>
          <button
            className="btn-danger"
            onClick={async () => {
              if (!confirm(t('Create a new URL? You will need to update the Browser Source in OBS afterwards.'))) return;
              await api('/api/overlay/regenerate', { method: 'POST' });
              toast(t('New overlay URL created'));
              void reload();
            }}
          >
            <Svg i="refresh" className="h-4 w-4" /> Nieuwe URL genereren
          </button>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-semibold text-white">{t('Resolution')}</h2>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map(([pw, ph, l]) => (
              <button
                key={l}
                onClick={() => saveRes(pw, ph)}
                className={`cursor-pointer rounded-xl border px-3 py-2.5 text-sm transition ${w === pw && h === ph ? 'border-brand-500 bg-brand-500/10 text-white' : 'border-white/10 text-zinc-300 hover:bg-white/[.04]'}`}
              >
                <div className="font-semibold">{t(l)}</div>
                <div className="text-xs text-zinc-500">{pw}×{ph}</div>
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="label">{t('Width')}</span>
              <input className="input" type="number" value={w} onChange={(e) => setW(Number(e.target.value))} />
            </label>
            <label className="flex-1">
              <span className="label">{t('Height')}</span>
              <input className="input" type="number" value={h} onChange={(e) => setH(Number(e.target.value))} />
            </label>
            <button className="btn-ghost" onClick={() => saveRes(w, h)}>
              {t('Save')}
            </button>
          </div>
        </section>
      </div>

      <section className="card mt-6 p-5">
        <div className="mb-4">
          <h2 className="font-semibold text-white">{t('Layout')}</h2>
          <p className="text-sm text-zinc-400">{t('Pick a command on the right, or click a box, and drag it into place. The selected command plays in the preview.')}</p>
        </div>
        {cmds && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
            <LayoutCanvas
              width={me.overlay.width}
              height={me.overlay.height}
              commands={cmds}
              selected={selected}
              hovered={hovered}
              onSelect={setSelected}
              onMove={(id, x, y) => setData((all) => all?.map((c) => (c.id === id ? { ...c, style: { ...c.style, x, y } } : c)) ?? null)}
              onDrop={async (id) => {
                const c = cmds.find((x) => x.id === id);
                if (!c) return;
                try {
                  await api(`/api/commands/${id}`, { method: 'PUT', json: c });
                } catch (e) {
                  toast((e as Error).message, 'error');
                  void reloadCmds();
                }
              }}
              preview={sel}
            />
            <ul className="flex max-h-[520px] flex-col gap-1.5 overflow-y-auto pr-1" aria-label={t('Commands in the overlay')}>
              {cmds.map((c, i) => {
                const active = c.id === selected;
                return (
                  <li key={c.id}>
                    <div
                      onMouseEnter={() => setHovered(c.id)}
                      onMouseLeave={() => setHovered(null)}
                      className={`rounded-xl border transition ${
                        active ? 'border-brand-500/60 bg-brand-500/10' : 'border-white/[.06] bg-white/[.02] hover:border-white/15 hover:bg-white/[.04]'
                      } ${c.enabled ? '' : 'opacity-50'}`}
                    >
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setSelected(active ? null : c.id)}
                        className="block w-full cursor-pointer px-3 pt-2.5 pb-2.5 text-left"
                      >
                      <div className="flex items-center gap-2.5">
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: colorFor(i) }} />
                        <span className="truncate font-mono text-sm font-semibold text-white">{c.trigger === 'chat' ? `!${c.name}` : `🔔 ${c.trigger}${c.minAmount ? ` ${c.minAmount}+` : ''}`}</span>
                        {!c.enabled && <span className="chip ml-auto bg-white/[.06] px-2 py-0.5 text-[10px] text-zinc-400">{t('off')}</span>}
                      </div>
                      <div className="mt-0.5 pl-[22px] text-xs text-zinc-500">
                        {LABELS.animation[c.animation] ?? c.animation} · x {c.style.x}% · y {c.style.y}%
                      </div>
                      </button>
                      {active && (
                        <div className="-mt-0.5 flex gap-2 px-3 pb-2.5 pl-[34px]">
                          <button
                            className="btn-ghost px-2.5 py-1.5 text-xs"
                            onClick={async () => {
                              const r = await api<{ delivered: number }>(`/api/commands/${c.id}/test`, { method: 'POST' });
                              toast(r.delivered ? t('Played in OBS') : t('No overlay open in OBS'), r.delivered ? 'ok' : 'error');
                            }}
                          >
                            <Svg i="play" className="h-3 w-3" /> {t('Test in OBS')}
                          </button>
                          <Link to={`/commands/${c.id}`} className="btn-ghost px-2.5 py-1.5 text-xs">
                            <Svg i="edit" className="h-3.5 w-3.5" /> {t('Edit')}
                          </Link>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </>
  );
}

const PALETTE = ['#a855f7', '#3b82f6', '#ec4899', '#22d3ee', '#f59e0b', '#10b981', '#f43f5e', '#8b5cf6', '#84cc16', '#06b6d4'];
const colorFor = (i: number) => PALETTE[i % PALETTE.length];

function LayoutCanvas(props: {
  width: number;
  height: number;
  commands: Command[];
  selected: number | null;
  hovered: number | null;
  preview: Command | null;
  onSelect: (id: number) => void;
  onMove: (id: number, x: number, y: number) => void;
  onDrop: (id: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / props.width));
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [props.width]);

  const pos = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return [
      Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))),
      Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100))),
    ] as const;
  };

  return (
    <div className="relative">
      {props.preview && (
        <div className="pointer-events-none absolute inset-0 z-0">
          <OverlayPreview cmd={props.preview} width={props.width} height={props.height} />
        </div>
      )}
      <div
        ref={box}
        className={`relative z-10 w-full touch-none overflow-hidden rounded-xl border border-white/10 ${props.preview ? '' : 'checker'}`}
        style={{ aspectRatio: `${props.width} / ${props.height}` }}
        onPointerMove={(e) => {
          if (drag.current === null) return;
          const [x, y] = pos(e);
          props.onMove(drag.current, x, y);
        }}
        onPointerUp={() => {
          if (drag.current !== null) props.onDrop(drag.current);
          drag.current = null;
        }}
      >
        {props.commands
          .map((c, i) => ({ c, color: colorFor(i) }))
          // The selected element is drawn last so it is always on top and can be grabbed.
          .sort((a, b) => Number(a.c.id === props.selected) - Number(b.c.id === props.selected))
          .map(({ c, color }) => {
            const bw = (c.animation === 'image' ? 440 : 680) * c.style.scale * scale;
            const bh = (c.animation === 'image' ? 380 : 500) * c.style.scale * scale;
            const active = props.selected === c.id;
            const hot = active || props.hovered === c.id;
            const dimmed = props.selected !== null && !active && props.hovered !== c.id;
            return (
              <div
                key={c.id}
                onPointerDown={(e) => {
                  e.preventDefault();
                  (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
                  drag.current = c.id;
                  props.onSelect(c.id);
                }}
                className={`absolute flex cursor-grab items-start justify-start rounded-lg border-2 p-1 text-[11px] font-semibold transition-[opacity,background-color,border-style] active:cursor-grabbing ${
                  hot ? 'border-solid' : 'border-dashed'
                } ${dimmed ? 'opacity-30' : ''} ${c.enabled ? '' : 'opacity-40'}`}
                style={{
                  left: `${c.style.x}%`,
                  top: `${c.style.y}%`,
                  width: bw,
                  height: bh,
                  transform: 'translate(-50%, -50%)',
                  borderColor: color,
                  background: hot ? `${color}26` : `${color}0d`,
                  zIndex: active ? 20 : hot ? 10 : 1,
                }}
                title={LABELS.animation[c.animation]}
              >
                <span className={`rounded px-1.5 py-0.5 font-mono text-white shadow ${dimmed ? 'invisible' : ''}`} style={{ background: color }}>
                  {c.trigger === 'chat' ? `!${c.name}` : `🔔 ${c.trigger}${c.minAmount ? ` ${c.minAmount}+` : ''}`}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}
