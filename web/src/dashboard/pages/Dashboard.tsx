import { Link } from 'react-router-dom';
import { useMe } from '../App';
import { api } from '../api';
import { ActivityList, CopyUrl } from '../components/Shared';
import { PageHeader, StatusDot, Svg, useToast } from '../ui';

export function Dashboard() {
  const { me, reload } = useMe();
  const toast = useToast();
  const chat = me.chat;
  const chatLabel = { connected: 'Verbonden met chat', connecting: 'Verbinden…', auth_failed: 'Authenticatie mislukt', disconnected: 'Niet verbonden' }[chat.status];
  const chatTone = chat.status === 'connected' ? 'ok' : chat.status === 'connecting' ? 'warn' : chat.status === 'auth_failed' ? 'error' : 'off';

  return (
    <>
      <PageHeader title={`Hoi ${me.user.displayName} 👋`} subtitle="Alles wat je stream interactief maakt, op één plek." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Twitch-chat"
          value={<span className="flex items-center gap-2 text-lg"><StatusDot tone={chatTone} /> {chatLabel}</span>}
          foot={
            <button
              className="text-xs font-semibold text-brand-400 hover:text-brand-300"
              onClick={async () => {
                await api('/api/chat/reconnect', { method: 'POST' });
                toast('Chatverbinding wordt opnieuw opgebouwd');
                setTimeout(reload, 1500);
              }}
            >
              Opnieuw verbinden
            </button>
          }
          sub={`#${me.user.login}`}
        />
        <Stat
          label="Overlay"
          value={
            <span className="flex items-center gap-2 text-lg">
              <StatusDot tone={me.overlay.connectedClients ? 'ok' : 'off'} />
              {me.overlay.connectedClients ? `${me.overlay.connectedClients} actief in OBS` : 'Niet geopend'}
            </span>
          }
          sub={`${me.overlay.width}×${me.overlay.height}`}
        />
        <Stat label="Actieve commands" value={<span className="text-3xl">{me.stats.commands}</span>} sub="ingeschakeld" />
        <Stat label="Afgespeeld (24 uur)" value={<span className="text-3xl">{me.stats.triggers24h}</span>} sub="via chat" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <section className="card p-5 lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-white">Recente activiteit</h2>
            <Link to="/activity" className="text-xs font-semibold text-brand-400 hover:text-brand-300">
              Alles bekijken
            </Link>
          </div>
          <ActivityList limit={8} compact />
        </section>

        <section className="card p-5 lg:col-span-2">
          <h2 className="font-semibold text-white">Overlay toevoegen aan OBS</h2>
          <p className="mt-1 mb-4 text-sm text-zinc-400">Eenmalig instellen, daarna werkt alles automatisch, ook als dit dashboard dicht is.</p>
          <CopyUrl url={me.overlay.url} />
          <ol className="mt-5 space-y-3 text-sm text-zinc-300">
            {[
              <>Klik in OBS bij <b>Bronnen</b> op <b>+</b> → <b>Browser</b>.</>,
              <>Plak de URL en zet breedte/hoogte op <b>{me.overlay.width}×{me.overlay.height}</b>.</>,
              <>Laat <i>“Aangepaste CSS”</i> leeg en vink <b>“Audio regelen via OBS”</b> aan voor geluiden.</>,
              <>Typ <code className="text-brand-400">!knuffel</code> in je chat. Klaar!</>,
            ].map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white/[.06] text-xs font-bold text-brand-400">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <Link to="/overlay" className="btn-ghost mt-5 w-full">
            <Svg i="layers" className="h-4 w-4" /> Overlay beheren
          </Link>
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, sub, foot }: { label: string; value: React.ReactNode; sub?: string; foot?: React.ReactNode }) {
  return (
    <div className="card relative overflow-hidden p-5">
      <div className="pointer-events-none absolute -top-12 -right-12 h-32 w-32 rounded-full bg-gradient-to-br from-brand-500/15 to-sky2-500/10 blur-2xl" />
      <div className="text-xs font-semibold tracking-wider text-zinc-500 uppercase">{label}</div>
      <div className="mt-2 font-semibold text-white">{value}</div>
      <div className="mt-1 flex items-center justify-between text-xs text-zinc-500">
        <span>{sub}</span>
        {foot}
      </div>
    </div>
  );
}
