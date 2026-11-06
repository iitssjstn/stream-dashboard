import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMe } from '../App';
import { api } from '../api';
import { usePoll } from '../hooks';
import { MediaPicker } from '../components/Shared';
import { Field, PageHeader, StatusDot, Svg, Toggle, useToast } from '../ui';

type Card = { background: string | null; title: string; subtitle: string; accentColor: string; textColor: string; dim: number };
type Guild = { id: number; guildId: string; guildName: string; guildIcon: string | null; enabled: boolean; channelId: string | null; message: string; card: Card; memberCount: number };
type BotStatus = { status: 'off' | 'connecting' | 'connected' | 'error'; botName: string | null; error: string | null };
type State = { configured: boolean; bot: BotStatus; guilds: Guild[] };

export function DiscordPage() {
  const { me } = useMe();
  const { data, reload } = usePoll<State>('/api/discord', 5000);
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const error = params.get('error');

  useEffect(() => {
    if (params.get('connected')) {
      toast('Discord-server gekoppeld! Kies hieronder een welkomstkanaal.');
      setParams({}, { replace: true });
    }
  }, [params, setParams, toast]);

  if (!data) return <div className="card h-60 animate-pulse" />;
  const tone = data.bot.status === 'connected' ? 'ok' : data.bot.status === 'connecting' ? 'warn' : data.bot.status === 'error' ? 'error' : 'off';

  return (
    <>
      <PageHeader
        title="Discord"
        subtitle="Heet nieuwe leden van je Discord-server welkom met een eigen plaatje."
        actions={
          data.configured && (
            <a href="/auth/discord/connect" className="btn-primary">
              <Svg i="plus" className="h-4 w-4" /> Verbind je Discord-server
            </a>
          )
        }
      />
      {error && <div className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}

      {!data.configured ? (
        me.isOwner ? (
          <DiscordSetup onDone={reload} />
        ) : (
          <section className="card p-6 text-sm text-zinc-400">De Discord-bot is op deze installatie nog niet ingesteld. Vraag de beheerder om dit eenmalig te doen.</section>
        )
      ) : (
        <>
          <section className="card mb-6 flex items-center gap-3 p-4 text-sm">
            <StatusDot tone={tone} />
            <span className="text-zinc-200">
              Bot {data.bot.botName ? <b>{data.bot.botName}</b> : ''} {data.bot.status === 'connected' ? 'is online' : data.bot.status === 'connecting' ? 'verbindt…' : data.bot.status === 'error' ? 'heeft een probleem' : 'staat uit'}
            </span>
            {data.bot.error && <span className="text-rose-300">{data.bot.error}</span>}
          </section>
          {data.guilds.length === 0 ? (
            <section className="card p-10 text-center">
              <p className="mb-4 text-sm text-zinc-400">Nog geen server gekoppeld. Klik op de knop, kies je server bij Discord en klik op Toestaan.</p>
              <a href="/auth/discord/connect" className="btn-primary">
                <Svg i="plus" className="h-4 w-4" /> Verbind je Discord-server
              </a>
            </section>
          ) : (
            <div className="space-y-6">
              {data.guilds.map((g) => (
                <GuildEditor key={g.id} guild={g} onChange={reload} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function GuildEditor({ guild, onChange }: { guild: Guild; onChange: () => void }) {
  const [g, setG] = useState(guild);
  const [channels, setChannels] = useState<{ id: string; name: string }[] | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const lastUrl = useRef<string | null>(null);
  // Only the editable fields count; server-side fields such as updatedAt change on every save.
  const editable = (x: Guild) => JSON.stringify([x.enabled, x.channelId, x.message, x.card]);
  const dirty = editable(g) !== editable(guild);

  useEffect(() => {
    api<{ id: string; name: string }[]>(`/api/discord/guilds/${guild.id}/channels`).then(setChannels, (e) => setChannelError((e as Error).message));
  }, [guild.id]);

  // Live preview of the image (debounced), rendered by the server exactly as it will be posted.
  const cardKey = JSON.stringify(g.card);
  useEffect(() => {
    const t = setTimeout(async () => {
      const res = await fetch('/api/discord/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ card: g.card, server: g.guildName }) });
      if (!res.ok) return;
      const url = URL.createObjectURL(await res.blob());
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
      lastUrl.current = url;
      setPreview(url);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey, g.guildName]);

  const card = <K extends keyof Card>(k: K, v: Card[K]) => setG({ ...g, card: { ...g.card, [k]: v } });
  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/discord/guilds/${g.id}`, { method: 'PUT', json: { enabled: g.enabled, channelId: g.channelId, message: g.message, card: g.card } });
      toast('Welkomstinstellingen opgeslagen');
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card p-5" aria-label={`Discord-server ${g.guildName}`}>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {g.guildIcon ? (
          <img src={`https://cdn.discordapp.com/icons/${g.guildId}/${g.guildIcon}.png?size=64`} alt="" className="h-10 w-10 rounded-xl" />
        ) : (
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#5865f2] font-bold text-white">{g.guildName[0]}</div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold text-white">{g.guildName}</h2>
          <div className="text-xs text-zinc-500">{g.memberCount ? `${g.memberCount} leden` : 'Discord-server'}</div>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <Toggle checked={g.enabled} onChange={(v) => setG({ ...g, enabled: v })} label="Welkomstberichten aan" /> Welkomst aan
        </label>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <Field label="Kanaal" hint={channelError ?? 'De bot moet in dit kanaal berichten en bestanden mogen sturen.'}>
            <select className="input" value={g.channelId ?? ''} onChange={(e) => setG({ ...g, channelId: e.target.value || null })}>
              <option value="">— kies een kanaal —</option>
              {(channels ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Bericht" hint="{user} = vermelding van het nieuwe lid, {name} = naam, {server}, {count} = aantal leden">
            <input className="input" maxLength={500} value={g.message} onChange={(e) => setG({ ...g, message: e.target.value })} />
          </Field>
          <div>
            <span className="label">Achtergrond (leeg = kleurverloop)</span>
            <MediaPicker kind="image" value={g.card.background} onChange={(v) => card('background', v)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Titel">
              <input className="input" maxLength={80} value={g.card.title} onChange={(e) => card('title', e.target.value)} />
            </Field>
            <Field label="Ondertitel">
              <input className="input" maxLength={120} value={g.card.subtitle} onChange={(e) => card('subtitle', e.target.value)} />
            </Field>
            <Field label="Accentkleur (rand om avatar)">
              <input type="color" className="h-10 w-full cursor-pointer rounded-xl border border-white/10 bg-transparent" value={g.card.accentColor} onChange={(e) => card('accentColor', e.target.value)} />
            </Field>
            <Field label="Tekstkleur">
              <input type="color" className="h-10 w-full cursor-pointer rounded-xl border border-white/10 bg-transparent" value={g.card.textColor} onChange={(e) => card('textColor', e.target.value)} />
            </Field>
          </div>
          <Field label={`Achtergrond donkerder: ${g.card.dim}%`}>
            <input type="range" className="w-full" min={0} max={90} value={g.card.dim} onChange={(e) => card('dim', Number(e.target.value))} />
          </Field>
        </div>

        <div className="xl:sticky xl:top-6 xl:self-start">
          <span className="label">Voorbeeld</span>
          <div className="overflow-hidden rounded-xl border border-white/10 bg-[#313338] p-3">
            <div className="mb-2 text-sm text-zinc-200">
              {g.message.replace(/\{user\}/gi, '@NieuwLid').replace(/\{name\}/gi, 'NieuwLid').replace(/\{server\}/gi, g.guildName).replace(/\{count\}/gi, String(g.memberCount || 1234))}
            </div>
            {preview ? <img src={preview} alt="Voorbeeld van het welkomstplaatje" className="w-full rounded-lg" /> : <div className="aspect-[1100/420] animate-pulse rounded-lg bg-white/5" />}
          </div>
          <p className="mt-2 text-xs text-zinc-500">In het echt staan de avatar en naam van het nieuwe lid erop.</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-white/[.06] pt-4">
        <button
          className="btn-danger mr-auto"
          onClick={async () => {
            if (!confirm(`${g.guildName} ontkoppelen? De bot verlaat dan je server.`)) return;
            await api(`/api/discord/guilds/${g.id}`, { method: 'DELETE' });
            onChange();
          }}
        >
          Ontkoppelen
        </button>
        <button
          className="btn-ghost"
          disabled={!guild.channelId || dirty}
          title={dirty ? 'Sla eerst op' : !guild.channelId ? 'Kies eerst een kanaal' : undefined}
          onClick={async () => {
            try {
              await api(`/api/discord/guilds/${g.id}/test`, { method: 'POST' });
              toast('Testbericht verstuurd in Discord');
            } catch (e) {
              toast((e as Error).message, 'error');
            }
          }}
        >
          <Svg i="play" className="h-3.5 w-3.5" /> Test sturen
        </button>
        <button className="btn-primary" disabled={saving || !dirty} onClick={save}>
          {saving ? 'Opslaan…' : dirty ? 'Opslaan' : 'Opgeslagen'}
        </button>
      </div>
    </section>
  );
}

/** One-time setup of the shared Discord bot (owner only). */
export function DiscordSetup({ onDone }: { onDone: () => void }) {
  const { data, reload } = usePoll<{ source: 'secret' | 'setup' | 'none'; clientId: string; redirectUri: string }>('/api/admin/discord');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [botToken, setBotToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  if (!data) return null;
  if (data.source === 'secret') return <section className="card p-5 text-sm text-zinc-400">De Discord-bot wordt beheerd via Docker secrets.</section>;

  return (
    <section className="card p-5">
      <h2 className="font-semibold text-white">Discord-bot instellen (eenmalig, eigenaar)</h2>
      <p className="mt-1 mb-4 text-sm text-zinc-400">
        Discord laat bots alleen handmatig aanmaken. Doe dit één keer; daarna kan elke streamer met één klik zijn server verbinden.
        {data.source === 'setup' && ' Er is al een bot ingesteld; vul alles opnieuw in om hem te vervangen.'}
      </p>
      <ol className="mb-5 space-y-2 text-sm text-zinc-300">
        <li>
          1. Ga naar{' '}
          <a className="font-semibold text-brand-400 underline" href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">
            discord.com/developers/applications
          </a>{' '}
          → <b>New Application</b> (bijv. “Lumio”).
        </li>
        <li>
          2. <b>OAuth2</b> → <b>Redirects</b> → voeg toe:{' '}
          <code className="rounded bg-white/5 px-1.5 py-0.5 text-brand-400 select-all">{data.redirectUri}</code>
        </li>
        <li>
          3. <b>Bot</b> → zet <b>Server Members Intent</b> aan (nodig om nieuwe leden te zien) → <b>Reset Token</b> en kopieer het token.
        </li>
        <li>
          4. Kopieer de <b>Application ID</b> (General Information) en het <b>Client Secret</b> (OAuth2).
        </li>
      </ol>
      <form
        className="grid gap-3"
        autoComplete="off"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const r = await api<{ botName: string }>('/api/admin/discord', { method: 'PUT', json: { clientId, clientSecret, botToken } });
            toast(`Bot ${r.botName} is ingesteld`);
            setClientSecret('');
            setBotToken('');
            void reload();
            onDone();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Application ID">
          <input className="input font-mono" value={clientId} onChange={(e) => setClientId(e.target.value.trim())} required inputMode="numeric" />
        </Field>
        <Field label="Client Secret">
          <input className="input font-mono" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value.trim())} required autoComplete="new-password" />
        </Field>
        <Field label="Bot-token" hint="Wordt versleuteld opgeslagen en nooit meer getoond.">
          <input className="input font-mono" type="password" value={botToken} onChange={(e) => setBotToken(e.target.value.trim())} required autoComplete="new-password" />
        </Field>
        {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
        <button className="btn-primary justify-self-start" disabled={busy}>
          {busy ? 'Controleren bij Discord…' : 'Bot opslaan'}
        </button>
      </form>
    </section>
  );
}
