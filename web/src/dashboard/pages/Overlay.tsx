import { useEffect, useRef, useState } from 'react';
import { useMe } from '../App';
import { api, LABELS, type Command } from '../api';
import { usePoll } from '../hooks';
import { CopyUrl } from '../components/Shared';
import { OverlayPreview } from '../components/OverlayPreview';
import { PageHeader, StatusDot, Svg, useToast } from '../ui';

const PRESETS = [
  [1920, 1080, '1080p'],
  [1280, 720, '720p'],
  [2560, 1440, '1440p'],
  [1080, 1920, 'Verticaal'],
] as const;

export function OverlayPage() {
  const { me, reload } = useMe();
  const toast = useToast();
  const { data: cmds, reload: reloadCmds, setData } = usePoll<Command[]>('/api/commands');
  const [w, setW] = useState(me.overlay.width);
  const [h, setH] = useState(me.overlay.height);
  const [selected, setSelected] = useState<number | null>(null);

  const saveRes = async (width: number, height: number) => {
    setW(width);
    setH(height);
    await api('/api/settings', { method: 'PATCH', json: { overlayWidth: width, overlayHeight: height } });
    toast(`Resolutie ingesteld op ${width}×${height}. Pas ook de Browser Source in OBS aan.`);
    void reload();
  };

  const sel = cmds?.find((c) => c.id === selected) ?? null;

  return (
    <>
      <PageHeader title="Overlay" subtitle="Eén URL voor al je interactieve elementen. Werkt los van dit dashboard." />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card space-y-4 p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-white">Jouw overlay-URL</h2>
            <span className="flex items-center gap-2 text-sm text-zinc-300">
              <StatusDot tone={me.overlay.connectedClients ? 'ok' : 'off'} />
              {me.overlay.connectedClients ? `${me.overlay.connectedClients} browser source(s) verbonden` : 'Nog niet geopend in OBS'}
            </span>
          </div>
          <CopyUrl url={me.overlay.url} />
          <p className="text-xs text-zinc-500">
            Deze URL is geheim: iedereen die hem heeft kan je overlay zien. Gelekt? Maak een nieuwe aan, de oude stopt direct met werken. Voeg <code>?debug</code> toe aan de URL om de verbindingsstatus in beeld te zien.
          </p>
          <button
            className="btn-danger"
            onClick={async () => {
              if (!confirm('Nieuwe URL maken? Je moet daarna de Browser Source in OBS bijwerken.')) return;
              await api('/api/overlay/regenerate', { method: 'POST' });
              toast('Nieuwe overlay-URL aangemaakt');
              void reload();
            }}
          >
            <Svg i="refresh" className="h-4 w-4" /> Nieuwe URL genereren
          </button>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-semibold text-white">Resolutie</h2>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map(([pw, ph, l]) => (
              <button
                key={l}
                onClick={() => saveRes(pw, ph)}
                className={`cursor-pointer rounded-xl border px-3 py-2.5 text-sm transition ${w === pw && h === ph ? 'border-brand-500 bg-brand-500/10 text-white' : 'border-white/10 text-zinc-300 hover:bg-white/[.04]'}`}
              >
                <div className="font-semibold">{l}</div>
                <div className="text-xs text-zinc-500">{pw}×{ph}</div>
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="label">Breedte</span>
              <input className="input" type="number" value={w} onChange={(e) => setW(Number(e.target.value))} />
            </label>
            <label className="flex-1">
              <span className="label">Hoogte</span>
              <input className="input" type="number" value={h} onChange={(e) => setH(Number(e.target.value))} />
            </label>
            <button className="btn-ghost" onClick={() => saveRes(w, h)}>
              Opslaan
            </button>
          </div>
        </section>
      </div>

      <section className="card mt-6 p-5">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-semibold text-white">Indeling</h2>
            <p className="text-sm text-zinc-400">Sleep elementen naar hun plek. Klik een element om het af te spelen in de preview.</p>
          </div>
          {sel && (
            <button
              className="btn-ghost"
              onClick={async () => {
                const r = await api<{ delivered: number }>(`/api/commands/${sel.id}/test`, { method: 'POST' });
                toast(r.delivered ? 'Afgespeeld in OBS' : 'Geen overlay open in OBS', r.delivered ? 'ok' : 'error');
              }}
            >
              <Svg i="play" className="h-3.5 w-3.5" /> !{sel.name} testen in OBS
            </button>
          )}
        </div>
        {cmds && (
          <LayoutCanvas
            width={me.overlay.width}
            height={me.overlay.height}
            commands={cmds}
            selected={selected}
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
        )}
      </section>
    </>
  );
}

function LayoutCanvas(props: {
  width: number;
  height: number;
  commands: Command[];
  selected: number | null;
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
        {props.commands.map((c) => {
          const bw = (c.animation === 'image' ? 440 : 680) * c.style.scale * scale;
          const bh = (c.animation === 'image' ? 380 : 500) * c.style.scale * scale;
          const active = props.selected === c.id;
          return (
            <div
              key={c.id}
              onPointerDown={(e) => {
                e.preventDefault();
                (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
                drag.current = c.id;
                props.onSelect(c.id);
              }}
              className={`absolute flex cursor-grab items-start justify-start rounded-lg border-2 border-dashed p-1 text-[11px] font-semibold transition-colors active:cursor-grabbing ${
                active ? 'z-10 border-brand-400 bg-brand-500/10 text-white' : 'border-white/25 bg-white/[.03] text-zinc-300 hover:border-white/50'
              } ${c.enabled ? '' : 'opacity-40'}`}
              style={{ left: `${c.style.x}%`, top: `${c.style.y}%`, width: bw, height: bh, transform: 'translate(-50%, -50%)' }}
              title={LABELS.animation[c.animation]}
            >
              <span className="rounded bg-black/60 px-1.5 py-0.5 font-mono">!{c.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
