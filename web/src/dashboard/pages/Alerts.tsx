import { Link } from 'react-router-dom';
import { useMe } from '../App';
import { ALERT_TYPES, api, LABELS, type Command } from '../api';
import { usePoll } from '../hooks';
import { PageHeader, StatusDot, Svg, Toggle, useToast } from '../ui';

const EVENT_LABEL: Record<string, string> = {
  'channel.follow': 'follows',
  'channel.subscribe': 'subs',
  'channel.subscription.message': 'resubs',
  'channel.subscription.gift': 'gifts',
  'channel.cheer': 'bits',
  'channel.raid': 'raids',
};

export function AlertsPage() {
  const { me, reload: reloadMe } = useMe();
  const { data, reload, setData } = usePoll<Command[]>('/api/commands');
  const toast = useToast();
  const alerts = (data ?? []).filter((c) => c.trigger !== 'chat');
  const st = me.alerts;
  const tone = st.status === 'connected' ? 'ok' : st.status === 'connecting' ? 'warn' : st.status === 'error' ? 'error' : 'off';

  const toggle = async (c: Command, enabled: boolean) => {
    setData((d) => d?.map((x) => (x.id === c.id ? { ...x, enabled } : x)) ?? null);
    try {
      await api(`/api/commands/${c.id}`, { method: 'PUT', json: { ...c, enabled } });
    } catch (e) {
      toast((e as Error).message, 'error');
      void reload();
    }
  };

  return (
    <>
      <PageHeader title="Alerts" subtitle="Follows, subs, bits en raids live in je overlay, rechtstreeks via Twitch." />

      <section className="card mb-6 flex flex-col gap-4 p-5 md:flex-row md:items-center">
        <div className="flex-1">
          <div className="flex items-center gap-2 font-semibold text-white">
            <StatusDot tone={tone} /> Twitch-events {st.status === 'connected' ? 'verbonden' : st.status === 'connecting' ? 'verbinden…' : st.status === 'error' ? 'fout' : 'uit'}
          </div>
          <div className="mt-1 text-sm text-zinc-400">
            {st.subscribed.length ? `Luistert naar: ${st.subscribed.map((s) => EVENT_LABEL[s] ?? s).join(', ')}` : 'Nog geen events actief.'}
            {st.lastError && <span className="block text-rose-300">{st.lastError}</span>}
          </div>
          {st.missingScopes.length > 0 && (
            <div className="mt-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
              Voor follow-, sub- en bits-alerts heeft Lumio extra Twitch-rechten nodig. Koppel Twitch één keer opnieuw om ze te geven.
              <a href="/auth/twitch/login" className="ml-2 font-semibold underline">
                Opnieuw koppelen
              </a>
            </div>
          )}
        </div>
        <button
          className="btn-ghost"
          onClick={async () => {
            await api('/api/alerts/reconnect', { method: 'POST' });
            toast('Opnieuw verbinden met Twitch-events…');
            setTimeout(reloadMe, 2000);
          }}
        >
          <Svg i="refresh" className="h-4 w-4" /> Opnieuw verbinden
        </button>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {ALERT_TYPES.map((t) => {
          const list = alerts.filter((a) => a.trigger === t.trigger).sort((a, b) => a.minAmount - b.minAmount);
          return (
            <section key={t.trigger} className="card p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-white">{t.label}</h2>
                  <p className="text-xs text-zinc-500">Variabelen: {t.vars}</p>
                </div>
                <Link to={`/commands/new?trigger=${t.trigger}`} className="btn-ghost px-3 py-1.5 text-xs">
                  <Svg i="plus" className="h-3.5 w-3.5" /> {t.amount ? 'Variant' : 'Alert'}
                </Link>
              </div>
              {list.length === 0 ? (
                <p className="rounded-xl border border-dashed border-white/10 p-4 text-center text-sm text-zinc-500">Geen alert ingesteld.</p>
              ) : (
                <ul className="space-y-2">
                  {list.map((a) => (
                    <li key={a.id} className={`flex items-center gap-3 rounded-xl border border-white/[.06] bg-white/[.02] px-3 py-2.5 ${a.enabled ? '' : 'opacity-50'}`}>
                      <Toggle checked={a.enabled} onChange={(v) => toggle(a, v)} label={`${t.label} aan/uit`} />
                      <div className="min-w-0 flex-1">
                        {a.label && <div className="truncate text-sm font-semibold text-white">{a.label}</div>}
                        <div className={`truncate text-sm ${a.label ? 'text-zinc-400' : 'text-zinc-200'}`}>{a.showText ? a.text : <i className="text-zinc-500">geen tekst</i>}</div>
                        <div className="truncate text-xs text-zinc-500">
                          {t.amount && a.minAmount ? `vanaf ${a.minAmount} ${t.amount} · ` : t.amount ? 'standaard · ' : ''}
                          {LABELS.animation[a.animation] ?? a.animation}
                          {a.soundUrl ? ' · 🔊' : ''}
                          {a.reply ? ' · 💬' : ''}
                        </div>
                      </div>
                      <button
                        className="btn-ghost px-2.5 py-1.5"
                        title="Test in OBS"
                        aria-label={`${t.label} testen`}
                        onClick={async () => {
                          const r = await api<{ delivered: number }>(`/api/commands/${a.id}/test`, { method: 'POST' });
                          toast(r.delivered ? 'Test-alert afgespeeld in OBS' : 'Geen overlay open in OBS', r.delivered ? 'ok' : 'error');
                        }}
                      >
                        <Svg i="play" className="h-3.5 w-3.5" />
                      </button>
                      <Link to={`/commands/${a.id}`} className="btn-ghost px-2.5 py-1.5" aria-label={`${t.label} bewerken`}>
                        <Svg i="edit" className="h-4 w-4" />
                      </Link>
                      <button
                        className="btn-danger px-2.5 py-1.5"
                        aria-label={`${t.label} verwijderen`}
                        onClick={async () => {
                          if (!confirm('Deze alert verwijderen?')) return;
                          await api(`/api/commands/${a.id}`, { method: 'DELETE' });
                          void reload();
                        }}
                      >
                        <Svg i="trash" className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
