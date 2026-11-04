import { Link } from 'react-router-dom';
import { useMe } from '../App';
import { api } from '../api';
import { ActivityList, CopyUrl } from '../components/Shared';
import { Sparkline } from '../components/Sparkline';
import { StatusDot, Svg, useToast } from '../ui';

const GREEN = '#34d399';
const CYAN = '#22d3ee';
const PURPLE = '#a855f7';
const VIOLET = '#c084fc';

export function Dashboard() {
  const { me, reload } = useMe();
  const toast = useToast();
  const chat = me.chat;
  const health = {
    connected: { label: 'Verbonden met Twitch', tone: 'ok' as const, glow: GREEN },
    connecting: { label: 'Verbinden…', tone: 'warn' as const, glow: '#fbbf24' },
    auth_failed: { label: 'Authenticatie mislukt', tone: 'error' as const, glow: '#fb7185' },
    disconnected: { label: 'Niet verbonden', tone: 'off' as const, glow: '#a1a1aa' },
  }[chat.status];
  const clients = me.overlay.connectedClients;

  return (
    <>
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Hoi {me.user.displayName} 👋</h1>
        <p className="mt-1 text-sm text-zinc-400">Alles wat je stream interactief maakt, op één plek.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="glow-card" style={{ '--glow': health.glow } as React.CSSProperties}>
          <Label>Stream health</Label>
          <div className="mt-2.5 flex items-center gap-2 text-sm font-bold tracking-wide text-white uppercase">
            <StatusDot tone={health.tone} /> {health.label}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span>#{me.user.login}</span>
            <button
              className="cursor-pointer rounded-md border border-white/15 bg-white/[.06] px-2 py-0.5 font-semibold text-zinc-200 transition hover:bg-white/[.12]"
              onClick={async () => {
                await api('/api/chat/reconnect', { method: 'POST' });
                toast('Chatverbinding wordt opnieuw opgebouwd');
                setTimeout(reload, 1500);
              }}
            >
              Opnieuw verbinden
            </button>
          </div>
        </div>

        <div className="glow-card" style={{ '--glow': CYAN } as React.CSSProperties}>
          <Label>Actieve overlays</Label>
          <div className="mt-1.5 flex items-baseline gap-1.5 text-white">
            <span className="text-3xl font-bold">{clients}</span>
            <span className="text-sm font-semibold">in OBS</span>
          </div>
          <div className="mt-1 text-xs text-zinc-400">
            {me.overlay.width}×{me.overlay.height}
            {!clients && ' · nog niet geopend'}
          </div>
        </div>

        <div className="glow-card" style={{ '--glow': PURPLE } as React.CSSProperties}>
          <Label>Actieve commands</Label>
          <div className="mt-1.5 text-3xl font-bold text-white">{me.stats.commands}</div>
          <div className="mt-1 text-xs text-zinc-400">ingeschakeld</div>
        </div>

        <div className="glow-card" style={{ '--glow': VIOLET } as React.CSSProperties}>
          <Label>Plays (24 uur)</Label>
          <div className="mt-1.5 flex items-end justify-between gap-3">
            <div>
              <div className="text-3xl font-bold text-white">{me.stats.triggers24h}</div>
              <div className="mt-1 text-xs text-zinc-400">via chat</div>
            </div>
            <Sparkline values={me.stats.playsByHour} firstHour={me.stats.playsFirstHour} color={VIOLET} />
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <section className="card p-5 lg:col-span-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-white">Recente activiteit</h2>
            <Link to="/activity" className="text-xs font-semibold text-brand-400 hover:text-brand-300">
              Alles bekijken
            </Link>
          </div>
          <ActivityList limit={8} compact />
        </section>

        <section className="card glass self-start p-5 lg:col-span-2">
          <h2 className="font-semibold text-white">Overlay toevoegen aan OBS</h2>
          <p className="mt-1 mb-4 text-sm text-zinc-400">Eenmalig instellen, daarna werkt alles automatisch, ook als dit dashboard dicht is.</p>
          <CopyUrl url={me.overlay.url} />
          <ol className="mt-5 space-y-3 text-sm text-zinc-300">
            {[
              <>Klik in OBS bij <C>Bronnen</C> op <C>+ → Browser</C>.</>,
              <>Plak de URL en zet breedte/hoogte op <C>{me.overlay.width}×{me.overlay.height}</C>.</>,
              <>Laat <i>“Aangepaste CSS”</i> leeg en vink <C>“Audio regelen via OBS”</C> aan voor geluiden.</>,
              <>Typ <code className="font-semibold text-brand-400">!knuffel</code> in je chat. Klaar!</>,
            ].map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[.06] text-xs font-bold text-zinc-300">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <Link to="/overlay" className="btn glow-btn mt-5 w-full" style={{ '--glow': CYAN } as React.CSSProperties}>
            <Svg i="layers" className="h-4 w-4" /> Overlay beheren
          </Link>
        </section>
      </div>
    </>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => <div className="text-[11px] font-semibold tracking-wider text-zinc-300 uppercase">{children}</div>;
const C = ({ children }: { children: React.ReactNode }) => <b className="font-semibold text-cyan-300">{children}</b>;
