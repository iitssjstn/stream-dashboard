import { useEffect, useMemo, useRef, useState } from 'react';
import { playEvent } from '../../overlay/renderer';
import type { OverlayEvent } from '../../overlay/types';
import type { Command } from '../api';

export function previewEvent(cmd: Pick<Command, 'name' | 'animation' | 'imageUrl' | 'soundUrl' | 'soundVolume' | 'text' | 'durationMs' | 'style' | 'showUsername'> & Partial<Pick<Command, 'targetMode' | 'targetFallback' | 'showText' | 'characterStyle' | 'walkIn' | 'useVideoLength'>>, viewer = 'KawaiiKijker'): OverlayEvent {
  const target = cmd.targetMode === 'required' ? 'Vriendje' : null;
  const user = cmd.showUsername ? viewer : 'Iemand';
  return {
    type: 'command',
    eventId: crypto.randomUUID(),
    createdAt: Date.now(),
    command: cmd.name,
    animation: cmd.animation,
    characterStyle: cmd.characterStyle ?? 'anime',
    walkIn: cmd.walkIn ?? false,
    useVideoLength: cmd.useVideoLength ?? false,
    imageUrl: cmd.imageUrl,
    soundUrl: cmd.soundUrl,
    soundVolume: cmd.soundVolume,
    text: cmd.showText === false ? '' : cmd.text.replace(/\{user\}/gi, user).replace(/\{target\}/gi, target ?? cmd.targetFallback ?? 'de streamer').replace(/\{channel\}/gi, 'jouwkanaal').replace(/\{amount\}/gi, '100').replace(/\{months\}/gi, '6').replace(/\{tier\}/gi, '1').replace(/\{message\}/gi, 'Hallo!').replace(/\{count\}/gi, '42').replace(/\{args\}/gi, '').replace(/\{random:(\d+)-(\d+)\}/gi, '7'),
    viewer: cmd.showUsername ? viewer : null,
    target,
    durationMs: cmd.durationMs,
    style: cmd.style,
  };
}

type Props = {
  cmd: Parameters<typeof previewEvent>[0];
  width: number;
  height: number;
  onMove?: (x: number, y: number) => void;
  replayKey?: number;
  muted?: boolean;
};

/**
 * Live preview using the exact same renderer as the OBS overlay. Loops the animation and
 * restarts it whenever a setting changes. Click/drag on the canvas to move the element.
 */
export function OverlayPreview({ cmd, width, height, onMove, replayKey = 0, muted = true }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const dragging = useRef(false);
  // Position changes should not restart the animation, everything else should.
  const sig = useMemo(() => JSON.stringify({ ...cmd, style: { ...cmd.style, x: 0, y: 0 } }), [cmd]);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / width));
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [width]);

  useEffect(() => {
    let run = true;
    const s = stage.current!;
    s.replaceChildren();
    const loop = async () => {
      while (run) {
        await playEvent(s, previewEvent(cmd), { muted });
        await new Promise((r) => setTimeout(r, 700));
      }
    };
    const t = setTimeout(loop, 200);
    return () => {
      run = false;
      clearTimeout(t);
      s.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, replayKey, muted]);

  // Follow position live without restarting.
  useEffect(() => {
    stage.current?.querySelectorAll<HTMLElement>('.lm-item').forEach((el) => {
      el.style.left = `${cmd.style.x}%`;
      el.style.top = `${cmd.style.y}%`;
    });
  }, [cmd.style.x, cmd.style.y]);

  const move = (e: React.PointerEvent) => {
    if (!onMove || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const x = Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
    const y = Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)));
    onMove(x, y);
  };

  return (
    <div
      ref={box}
      className={`checker relative w-full overflow-hidden rounded-xl border border-white/10 ${onMove ? 'cursor-crosshair touch-none' : ''}`}
      style={{ aspectRatio: `${width} / ${height}` }}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => dragging.current && move(e)}
      onPointerUp={() => (dragging.current = false)}
    >
      <div ref={stage} className="lm-stage" style={{ width, height, transform: `scale(${scale})` }} />
      {onMove && (
        <div
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/80 shadow-[0_0_0_3px_rgb(168_85_247/.5)]"
          style={{ left: `${cmd.style.x}%`, top: `${cmd.style.y}%` }}
        />
      )}
    </div>
  );
}
