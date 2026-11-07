import { useId, useState } from 'react';
import { t } from '../i18n';

/**
 * Single-series sparkline for a stat tile: 2px line, soft area, hover crosshair + tooltip.
 * The tile's title names the series, so no legend is needed.
 */
export function Sparkline({ values, firstHour, color = '#c084fc' }: { values: number[]; firstHour: number; color?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId().replace(/:/g, '');
  const W = 120;
  const H = 44;
  const pad = 3;
  const max = Math.max(1, ...values);
  const step = (W - pad * 2) / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => [pad + i * step, H - pad - (v / max) * (H - pad * 2)] as const);

  // Monotone-ish smoothing (Catmull-Rom -> cubic Bézier, tension 0.5, clamped to the plot).
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const [p1, p2] = [pts[i], pts[i + 1]];
    const p3 = pts[i + 2] ?? p2;
    const c1y = Math.min(H - pad, Math.max(pad, p1[1] + (p2[1] - p0[1]) / 6));
    const c2y = Math.min(H - pad, Math.max(pad, p2[1] - (p3[1] - p1[1]) / 6));
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${c1y} ${p2[0] - (p3[0] - p1[0]) / 6},${c2y} ${p2[0]},${p2[1]}`;
  }
  const area = `${d} L${pts[pts.length - 1][0]},${H} L${pts[0][0]},${H} Z`;
  const total = values.reduce((a, b) => a + b, 0);
  const hourLabel = (i: number) => {
    const t = new Date(firstHour + i * 3600_000);
    const hh = (n: number) => String(n).padStart(2, '0');
    return `${hh(t.getHours())}:00–${hh((t.getHours() + 1) % 24)}:00`;
  };

  return (
    <div className="relative h-11 w-[120px]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-full w-full overflow-visible"
        role="img"
        aria-label={t('{total} plays in the last 24 hours, peak {max} per hour', { total, max: max === 1 && total === 0 ? 0 : max })}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(values.length - 1, Math.round((x - pad) / step))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`a${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity=".35" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#a${id})`} />
        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
        {hover !== null && (
          <>
            <line x1={pts[hover][0]} x2={pts[hover][0]} y1={0} y2={H} stroke="rgb(255 255 255 / .35)" strokeWidth="1" />
            <circle cx={pts[hover][0]} cy={pts[hover][1]} r="4" fill={color} stroke="#100e1c" strokeWidth="2" />
          </>
        )}
        {/* Invisible full-height hit area so the hover works anywhere over the plot */}
        <rect x="0" y="0" width={W} height={H} fill="transparent" />
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute bottom-full z-10 mb-1.5 -translate-x-1/2 rounded-lg border border-white/10 bg-ink-950/95 px-2.5 py-1.5 text-[11px] whitespace-nowrap text-zinc-300 shadow-xl"
          style={{ left: `${(pts[hover][0] / W) * 100}%` }}
        >
          <span className="font-semibold text-white">{values[hover]}</span> {values[hover] === 1 ? t('play') : t('plays')} · {hourLabel(hover)}
        </div>
      )}
    </div>
  );
}
