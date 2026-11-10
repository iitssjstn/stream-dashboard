import { Link } from 'react-router-dom';
import { useMe } from '../App';
import { api, type OverlayProfile } from '../api';
import { ActivityList } from '../components/Shared';
import { usePoll } from '../hooks';
import { StatusDot, Svg, useToast } from '../ui';
import { t } from '../i18n';

const GREEN = '#34d399';
const CYAN = '#22d3ee';
const PURPLE = '#a855f7';

export function Dashboard() {
  const { me, reload } = useMe();
  const { data: overlays } = usePoll<OverlayProfile[]>('/api/overlays', 15_000);
  const toast = useToast();
  const chat = me.chat;
  const health = {
    connected: { label: t('Connected to Twitch'), tone: 'ok' as const, glow: GREEN },
    connecting: { label: t('Connecting…'), tone: 'warn' as const, glow: '#fbbf24' },
    auth_failed: { label: t('Authentication failed'), tone: 'error' as const, glow: '#fb7185' },
    disconnected: { label: t('Not connected'), tone: 'off' as const, glow: '#a1a1aa' },
  }[chat.status];
  const connectedSources = overlays?.reduce((total, overlay) => total + overlay.connectedClients, 0) ?? me.overlay.connectedClients;
  const overlayCount = overlays?.length ?? 1;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{t('Hi {name} 👋', { name: me.user.displayName })}</h1>
        <p className="w-full text-sm text-zinc-400">{t('Everything that makes your stream interactive, in one place.')}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        <MetricTile label={t('Chat connection')} value={health.label} detail={`#${me.user.login}`} color={health.glow} icon="twitch" />
        <MetricTile label={t('Connected browser sources')} value={String(connectedSources)} detail={t('{n} overlay profiles', { n: overlayCount })} color={CYAN} icon="layers" />
        <MetricTile label={t('Enabled commands')} value={String(me.stats.commands)} detail={t('Ready for chat and alerts')} color={PURPLE} icon="bolt" />
        <MetricTile label={t('Plays (24 h)')} value={String(me.stats.triggers24h)} detail={t('Triggered in the last 24 hours')} color="#f59e0b" icon="activity" />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,.8fr)]">
        <section className="card min-w-0 p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-white">{t('Activity overview')}</h2>
              <p className="mt-1 text-xs text-zinc-500">{t('Last 24 hours')}</p>
            </div>
            <span className="chip border border-white/10 bg-white/[.03] text-zinc-300">
              <Svg i="activity" className="h-3.5 w-3.5 text-brand-400" /> {me.stats.triggers24h} {t('plays')}
            </span>
          </div>
          <ActivityChart values={me.stats.playsByHour} firstHour={me.stats.playsFirstHour} />
        </section>

        <aside className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <section className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-white">{t('Overlay profiles')}</h2>
              <Svg i="layers" className="h-4 w-4 text-brand-400" />
            </div>
            <div className="mt-4 flex items-end gap-2">
              <span className="text-3xl font-bold text-white">{overlayCount}</span>
              <span className="pb-1 text-sm text-zinc-400">{t('configured')}</span>
            </div>
            <p className="mt-2 text-xs text-zinc-500">{connectedSources} {t('browser sources connected')}</p>
            <Link to="/overlay" className="btn-ghost mt-4 w-full">
              <Svg i="layers" className="h-4 w-4" /> {t('Manage overlays')}
            </Link>
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-white">{t('Twitch chat')}</h2>
              <StatusDot tone={health.tone} />
            </div>
            <p className="mt-4 text-sm font-semibold text-zinc-200">{health.label}</p>
            <p className="mt-1 text-xs text-zinc-500">#{me.user.login}</p>
            <button
              className="btn-ghost mt-4 w-full"
              onClick={async () => {
                await api('/api/chat/reconnect', { method: 'POST' });
                toast(t('Reconnecting to chat'));
                setTimeout(reload, 1500);
              }}
            >
              <Svg i="refresh" className="h-4 w-4" /> {t('Reconnect')}
            </button>
          </section>
        </aside>
      </div>

      <section className="card mt-5 p-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-white">{t('Recent activity')}</h2>
          <Link to="/activity" className="text-xs font-semibold text-brand-400 hover:text-brand-300">
            {t('View all')}
          </Link>
        </div>
        <ActivityList limit={8} compact />
      </section>
    </>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => <div className="text-[11px] font-semibold tracking-wider text-zinc-300 uppercase">{children}</div>;

function MetricTile({ label, value, detail, color, icon }: { label: string; value: string; detail: string; color: string; icon: 'twitch' | 'layers' | 'bolt' | 'activity' }) {
  return (
    <section className="card relative overflow-hidden p-4" style={{ '--metric': color } as React.CSSProperties}>
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Label>{label}</Label>
          <div className="mt-2 truncate text-xl font-bold text-white">{value}</div>
          <div className="mt-1 truncate text-xs text-zinc-500">{detail}</div>
        </div>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/[.08] bg-white/[.03]" style={{ color }}>
          <Svg i={icon} className="h-4 w-4" />
        </span>
      </div>
    </section>
  );
}

function ActivityChart({ values, firstHour }: { values: number[]; firstHour: number }) {
  const width = 900;
  const height = 250;
  const left = 40;
  const right = 12;
  const top = 12;
  const bottom = 28;
  const max = Math.max(1, ...values);
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const points = values.map((value, index) => ({
    x: left + (index / Math.max(1, values.length - 1)) * plotWidth,
    y: top + plotHeight - (value / max) * plotHeight,
    value,
    index,
  }));
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  const area = `${line} L${points.at(-1)?.x ?? left},${top + plotHeight} L${left},${top + plotHeight} Z`;
  const total = values.reduce((sum, value) => sum + value, 0);
  const gradientId = 'dashboardActivityGradient';

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-52 w-full overflow-visible" role="img" aria-label={t('{total} plays in the last 24 hours, peak {max} per hour', { total, max: Math.max(...values, 0) })}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#22d3ee" stopOpacity=".28" />
            <stop offset="1" stopColor="#a855f7" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((step) => {
          const y = top + (plotHeight / 3) * step;
          return <line key={step} x1={left} x2={width - right} y1={y} y2={y} stroke="rgb(255 255 255 / .08)" strokeDasharray={step === 3 ? undefined : '3 6'} />;
        })}
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke="#67e8f9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point) => (
          <circle key={point.index} cx={point.x} cy={point.y} r="3" fill="#a5f3fc" stroke="#100e1c" strokeWidth="2">
            <title>{`${point.value} · ${new Date(firstHour + point.index * 3600_000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</title>
          </circle>
        ))}
        {[0, 6, 12, 18, 23].map((hour) => {
          const point = points[hour];
          if (!point) return null;
          return <text key={hour} x={point.x} y={height - 5} textAnchor={hour === 0 ? 'start' : hour === 23 ? 'end' : 'middle'} fill="#71717a" fontSize="11">{new Date(firstHour + hour * 3600_000).toLocaleTimeString([], { hour: '2-digit' })}</text>;
        })}
      </svg>
      {total === 0 && <p className="pointer-events-none absolute inset-0 grid place-items-center pb-6 text-xs text-zinc-500">{t('No activity in this period yet.')}</p>}
    </div>
  );
}
