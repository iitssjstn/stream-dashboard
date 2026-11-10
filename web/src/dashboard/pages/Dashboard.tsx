import { Link } from 'react-router-dom';
import { useMe } from '../App';
import { api } from '../api';
import { ActivityList } from '../components/Shared';
import { Sparkline } from '../components/Sparkline';
import { StatusDot, Svg, useToast } from '../ui';
import { t } from '../i18n';

const GREEN = '#34d399';
const CYAN = '#22d3ee';
const PURPLE = '#a855f7';
const VIOLET = '#c084fc';

export function Dashboard() {
  const { me, reload } = useMe();
  const toast = useToast();
  const chat = me.chat;
  const health = {
    connected: { label: t('Connected to Twitch'), tone: 'ok' as const, glow: GREEN },
    connecting: { label: t('Connecting…'), tone: 'warn' as const, glow: '#fbbf24' },
    auth_failed: { label: t('Authentication failed'), tone: 'error' as const, glow: '#fb7185' },
    disconnected: { label: t('Not connected'), tone: 'off' as const, glow: '#a1a1aa' },
  }[chat.status];
  const clients = me.overlay.connectedClients;

  return (
    <>
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{t('Hi {name} 👋', { name: me.user.displayName })}</h1>
        <p className="mt-1 text-sm text-zinc-400">{t('Everything that makes your stream interactive, in one place.')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="glow-card" style={{ '--glow': health.glow } as React.CSSProperties}>
          <Label>{t('Stream health')}</Label>
          <div className="mt-2.5 flex items-center gap-2 text-sm font-bold tracking-wide text-white uppercase">
            <StatusDot tone={health.tone} /> {health.label}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span>#{me.user.login}</span>
            <button
              className="cursor-pointer rounded-md border border-white/15 bg-white/[.06] px-2 py-0.5 font-semibold text-zinc-200 transition hover:bg-white/[.12]"
              onClick={async () => {
                await api('/api/chat/reconnect', { method: 'POST' });
                toast(t('Reconnecting to chat'));
                setTimeout(reload, 1500);
              }}
            >
              {t('Reconnect')}
            </button>
          </div>
        </div>

        <div className="glow-card" style={{ '--glow': CYAN } as React.CSSProperties}>
          <Label>{t('Active overlays')}</Label>
          <div className="mt-1.5 flex items-baseline gap-1.5 text-white">
            <span className="text-3xl font-bold">{clients}</span>
            <span className="text-sm font-semibold">{t('in OBS')}</span>
          </div>
          <div className="mt-1 text-xs text-zinc-400">
            {me.overlay.width}×{me.overlay.height}
            {!clients && ` · ${t('not opened yet')}`}
          </div>
        </div>

        <div className="glow-card" style={{ '--glow': PURPLE } as React.CSSProperties}>
          <Label>{t('Active commands')}</Label>
          <div className="mt-1.5 text-3xl font-bold text-white">{me.stats.commands}</div>
          <div className="mt-1 text-xs text-zinc-400">{t('enabled')}</div>
        </div>

        <div className="glow-card" style={{ '--glow': VIOLET } as React.CSSProperties}>
          <Label>{t('Plays (24 h)')}</Label>
          <div className="mt-1.5 flex items-end justify-between gap-3">
            <div>
              <div className="text-3xl font-bold text-white">{me.stats.triggers24h}</div>
              <div className="mt-1 text-xs text-zinc-400">{t('via chat')}</div>
            </div>
            <Sparkline values={me.stats.playsByHour} firstHour={me.stats.playsFirstHour} color={VIOLET} />
          </div>
        </div>
      </div>

      <div className="mt-6">
        <section className="card p-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-white">{t('Recent activity')}</h2>
            <div className="flex items-center gap-3">
              <Link to="/overlay" className="btn-ghost px-2.5 py-1.5 text-xs">
                <Svg i="layers" className="h-3.5 w-3.5" /> {t('Manage overlay')}
              </Link>
              <Link to="/activity" className="text-xs font-semibold text-brand-400 hover:text-brand-300">
                {t('View all')}
              </Link>
            </div>
          </div>
          <ActivityList limit={8} compact />
        </section>
      </div>
    </>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => <div className="text-[11px] font-semibold tracking-wider text-zinc-300 uppercase">{children}</div>;
