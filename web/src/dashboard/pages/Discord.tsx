import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMe } from '../App';
import { api } from '../api';
import { usePoll } from '../hooks';
import { MediaPicker } from '../components/Shared';
import { Field, PageHeader, StatusDot, Svg, Toggle, useToast } from '../ui';

type Card = { background: string | null; title: string; subtitle: string; accentColor: string; textColor: string; dim: number };
type BotProfile = { nick: string | null; avatar: string | null; bio: string | null };
type Guild = { id: number; removedAt: number | null; guildId: string; guildName: string; guildIcon: string | null; enabled: boolean; channelId: string | null; message: string; card: Card; memberCount: number; botProfile: BotProfile };
type BotStatus = { status: 'off' | 'connecting' | 'connected' | 'error'; botName: string | null; error: string | null; avatar: string | null; warning: string | null; avatarError: string | null };
type State = { configured: boolean; bot: BotStatus; guilds: Guild[] };

export function DiscordPage() {
  const { me } = useMe();
  const { data, reload } = usePoll<State>('/api/discord', 5000);
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const error = params.get('error');
  const [tab, setTab] = useState<'welcome' | 'profile' | 'server'>('welcome');

  useEffect(() => {
    if (params.get('connected')) {
      toast('Server toegevoegd! Kies hieronder een welkomstkanaal.');
      const next = new URLSearchParams(params);
      next.delete('connected');
      setParams(next, { replace: true });
    }
  }, [params, setParams, toast]);

  if (!data) return <div className="card h-60 animate-pulse" />;
  const tone = data.bot.status === 'connected' ? 'ok' : data.bot.status === 'connecting' ? 'warn' : data.bot.status === 'error' ? 'error' : 'off';
  const selectedId = params.get('server');
  const guild = data.guilds.find((g) => g.guildId === selectedId) ?? data.guilds[0];
  const select = (g: Guild) => {
    const next = new URLSearchParams(params);
    next.set('server', g.guildId);
    setParams(next, { replace: true });
  };
  const addButton = (
    <a href="/auth/discord/connect" className="btn-primary">
      <Svg i="plus" className="h-4 w-4" /> Server toevoegen
    </a>
  );

  return (
    <>
      <PageHeader title="Discord" subtitle="Jouw bot voor je Discord-server(s): welkomstberichten en meer." actions={data.configured && addButton} />
      {error && <div className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}

      {!data.configured ? (
        me.isOwner ? (
          <DiscordSetup onDone={reload} />
        ) : (
          <section className="card p-6 text-sm text-zinc-400">De Discord-bot is op deze installatie nog niet ingesteld. Vraag de beheerder om dit eenmalig te doen.</section>
        )
      ) : (
        <>
          <section className="card mb-5 flex flex-wrap items-center gap-3 p-4 text-sm">
            <StatusDot tone={tone} />
            <span className="text-zinc-200">
              Bot {data.bot.botName ? <b>{data.bot.botName}</b> : ''} {data.bot.status === 'connected' ? 'is online' : data.bot.status === 'connecting' ? 'verbindt…' : data.bot.status === 'error' ? 'heeft een probleem' : 'staat uit'}
            </span>
            {data.bot.error && <span className="text-rose-300">{data.bot.error}</span>}
            {data.bot.warning && <span className="basis-full rounded-lg bg-amber-400/10 px-3 py-2 text-amber-200">{data.bot.warning}</span>}
            {data.bot.avatarError && <span className="basis-full rounded-lg bg-amber-400/10 px-3 py-2 break-all text-amber-200">⚠ {data.bot.avatarError}</span>}
          </section>

          {data.guilds.length === 0 ? (
            <section className="card p-8">
              <h2 className="mb-1 text-lg font-semibold text-white">Voeg je bot toe aan je Discord-server</h2>
              <p className="mb-6 text-sm text-zinc-400">Dit duurt minder dan een minuut. Je hebt wel de rol “Server beheren” nodig in die server.</p>
              <ol className="mb-6 grid gap-3 sm:grid-cols-3">
                {['Klik op “Server toevoegen”', 'Kies je server in Discord', 'Klik op “Toestaan”'].map((t, i) => (
                  <li key={t} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[.03] p-3 text-sm text-zinc-200">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#5865f2] font-bold text-white">{i + 1}</span>
                    {t}
                  </li>
                ))}
              </ol>
              {addButton}
            </section>
          ) : (
            <>
              <nav className="mb-5 flex gap-2 overflow-x-auto pb-1" aria-label="Jouw servers">
                {data.guilds.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => select(g)}
                    aria-current={g.id === guild.id ? 'page' : undefined}
                    className={`flex shrink-0 cursor-pointer items-center gap-2.5 rounded-xl border py-2 pr-4 pl-2 text-sm font-semibold transition ${
                      g.id === guild.id ? 'border-[#5865f2] bg-[#5865f2]/15 text-white' : 'border-white/10 text-zinc-300 hover:bg-white/[.05]'
                    }`}
                  >
                    <GuildIcon g={g} size="h-8 w-8" />
                    {g.guildName}
                    {g.removedAt && <span className="h-2 w-2 rounded-full bg-rose-500" title="Bot zit niet meer in deze server" />}
                  </button>
                ))}
                <a href="/auth/discord/connect" className="flex shrink-0 items-center gap-2 rounded-xl border border-dashed border-white/20 px-4 py-2 text-sm font-semibold text-zinc-400 hover:border-white/40 hover:text-white">
                  <Svg i="plus" className="h-4 w-4" /> Nog een server
                </a>
              </nav>

              {guild.removedAt ? (
                <section className="card border-rose-500/30 p-6">
                  <h2 className="font-semibold text-white">De bot zit niet meer in {guild.guildName}</h2>
                  <p className="mt-1 mb-4 text-sm text-zinc-400">Iemand heeft de bot in Discord uit de server gehaald. Je instellingen zijn bewaard: voeg hem opnieuw toe en alles werkt weer.</p>
                  <div className="flex flex-wrap gap-2">
                    {addButton}
                    <RemoveGuildButton guild={guild} onDone={reload} label="Instellingen verwijderen" />
                  </div>
                </section>
              ) : (
                <>
                  <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-white/[.06] bg-ink-950/40 p-1" role="tablist">
                    {(
                      [
                        ['welcome', 'Welkom'],
                        ['profile', 'Bot-profiel'],
                        ['server', 'Server'],
                      ] as const
                    ).map(([k, l]) => (
                      <button
                        key={k}
                        role="tab"
                        aria-selected={tab === k}
                        onClick={() => setTab(k)}
                        className={`flex-1 cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition ${tab === k ? 'bg-white/[.08] text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  {tab === 'welcome' && <GuildEditor key={guild.id} guild={guild} onChange={reload} />}
                  {tab === 'profile' && <BotProfileEditor key={guild.id} guild={guild} bot={data.bot} onChange={reload} />}
                  {tab === 'server' && (
                    <section className="card p-6" aria-label="Server">
                      <div className="flex items-center gap-4">
                        <GuildIcon g={guild} size="h-14 w-14" />
                        <div>
                          <h2 className="text-lg font-semibold text-white">{guild.guildName}</h2>
                          <p className="text-sm text-zinc-400">{guild.memberCount ? `${guild.memberCount} leden · ` : ''}bot is aanwezig</p>
                        </div>
                      </div>
                      <div className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/[.06] p-5">
                        <h3 className="font-semibold text-white">Bot uit deze server halen</h3>
                        <p className="mt-1 mb-4 text-sm text-zinc-400">
                          De bot verlaat {guild.guildName} en alle instellingen voor deze server worden gewist. Je kunt hem later altijd opnieuw toevoegen met “Server toevoegen”.
                        </p>
                        <RemoveGuildButton guild={guild} onDone={reload} label="Bot uit deze server halen" />
                      </div>
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

function GuildIcon({ g, size }: { g: Guild; size: string }) {
  return g.guildIcon ? (
    <img src={`https://cdn.discordapp.com/icons/${g.guildId}/${g.guildIcon}.png?size=64`} alt="" className={`${size} rounded-xl`} />
  ) : (
    <div className={`${size} grid shrink-0 place-items-center rounded-xl bg-[#5865f2] font-bold text-white`}>{g.guildName[0]}</div>
  );
}

function RemoveGuildButton({ guild, onDone, label }: { guild: Guild; onDone: () => void; label: string }) {
  const toast = useToast();
  return (
    <button
      className="btn-danger"
      onClick={async () => {
        if (!confirm(`Weet je het zeker? De bot verlaat ${guild.guildName} en de instellingen voor deze server worden gewist.`)) return;
        await api(`/api/discord/guilds/${guild.id}`, { method: 'DELETE' });
        toast(`Bot is uit ${guild.guildName} gehaald`);
        onDone();
      }}
    >
      {label}
    </button>
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
          <Field label="Bericht" hint="Enter = nieuwe regel. {user} = vermelding van het nieuwe lid, {name} = naam, {server}, {count} = aantal leden. Discord-opmaak werkt ook: **vet**, *schuin*, > citaat.">
            <textarea
              className="input min-h-36 resize-y leading-relaxed"
              rows={6}
              maxLength={1500}
              value={g.message}
              placeholder={'Hallo {user},\n\nWelkom in {server}! Lees even de regels in #regels.'}
              onChange={(e) => setG({ ...g, message: e.target.value })}
            />
            <span className="mt-1 block text-right text-xs text-zinc-500">{g.message.length}/1500</span>
          </Field>
          <div>
            <span className="label">Achtergrond (leeg = kleurverloop)</span>
            <MediaPicker kind="image" allowVideo={false} value={g.card.background} onChange={(v) => card('background', v)} />
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
            <div className="mb-2 text-sm whitespace-pre-wrap text-zinc-200">
              {g.message.replace(/\{user\}/gi, '@NieuwLid').replace(/\{name\}/gi, 'NieuwLid').replace(/\{server\}/gi, g.guildName).replace(/\{count\}/gi, String(g.memberCount || 1234))}
            </div>
            {preview ? <img src={preview} alt="Voorbeeld van het welkomstplaatje" className="w-full rounded-lg" /> : <div className="aspect-[1100/420] animate-pulse rounded-lg bg-white/5" />}
          </div>
          <p className="mt-2 text-xs text-zinc-500">In het echt staan de avatar en naam van het nieuwe lid erop.</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-white/[.06] pt-4">
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
          3. <b>Bot</b> → zet <b>Server Members Intent</b> én <b>Message Content Intent</b> aan (voor welkomst, AutoMod en levels) → <b>Reset Token</b> en kopieer het token.
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

/** Per-server bot look: name, profile photo and bio, so it feels like the streamer's own bot. */
function BotProfileEditor({ guild, bot, onChange }: { guild: Guild; bot: BotStatus; onChange: () => void }) {
  const [p, setP] = useState<BotProfile>(guild.botProfile ?? { nick: null, avatar: null, bio: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const saved = guild.botProfile ?? { nick: null, avatar: null, bio: null };
  const dirty = JSON.stringify([p.nick || null, p.avatar || null, p.bio || null]) !== JSON.stringify([saved.nick, saved.avatar, saved.bio]);
  const name = p.nick || bot.botName || 'Bot';
  const avatar = p.avatar || bot.avatar;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/discord/guilds/${guild.id}/profile`, { method: 'PUT', json: p });
      toast(`Bot-profiel op ${guild.guildName} bijgewerkt`);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5" aria-label={`Bot-profiel op ${guild.guildName}`}>
      <h3 className="font-semibold text-white">Jouw bot op {guild.guildName}</h3>
      <p className="mt-1 mb-5 text-sm text-zinc-400">Geef de bot een eigen naam, profielfoto en beschrijving. Dit geldt alleen op jouw server: andere streamers hebben hun eigen versie.</p>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <Field label="Naam van de bot" hint="Max. 32 tekens. Leeg = standaardnaam.">
            <input className="input" maxLength={32} placeholder={bot.botName ?? 'Lumio'} value={p.nick ?? ''} onChange={(e) => setP({ ...p, nick: e.target.value || null })} />
          </Field>
          <div>
            <span className="label">Profielfoto (PNG, JPG, GIF of WEBP; GIF mag bewegen)</span>
            <MediaPicker kind="image" allowVideo={false} value={p.avatar} onChange={(v) => setP({ ...p, avatar: v })} />
          </div>
          <Field label="Over mij" hint="Max. 190 tekens, zichtbaar in het profiel van de bot.">
            <textarea className="input min-h-20" maxLength={190} value={p.bio ?? ''} placeholder="Bijv. De officiële bot van KnuffelStreamer 💜" onChange={(e) => setP({ ...p, bio: e.target.value || null })} />
          </Field>
          {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
          <div className="flex justify-end gap-2">
            {dirty && (
              <button className="btn-ghost" onClick={() => setP(saved)}>
                Ongedaan maken
              </button>
            )}
            <button className="btn-primary" disabled={busy || !dirty} onClick={save}>
              {busy ? 'Opslaan bij Discord…' : dirty ? 'Bot-profiel opslaan' : 'Opgeslagen'}
            </button>
          </div>
        </div>
        <div>
          <span className="label">Zo ziet je bot eruit in Discord</span>
          <div className="overflow-hidden rounded-xl border border-white/10 bg-[#232428]">
            <div className="h-16" style={{ background: 'linear-gradient(135deg, #5865f2, #a855f7)' }} />
            <div className="px-4 pb-4">
              <div className="-mt-9 mb-2 h-[72px] w-[72px] overflow-hidden rounded-full border-[6px] border-[#232428] bg-[#5865f2]">
                {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center text-2xl font-bold text-white">{name[0]}</div>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-white">{name}</span>
                <span className="rounded bg-[#5865f2] px-1.5 py-0.5 text-[10px] font-bold text-white">✓ APP</span>
              </div>
              {p.bio && <p className="mt-2 rounded-lg bg-[#2b2d31] p-3 text-sm whitespace-pre-wrap text-zinc-200">{p.bio}</p>}
            </div>
          </div>
          <div className="mt-3 flex gap-3 rounded-xl border border-white/10 bg-[#313338] p-3">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-[#5865f2]">
              {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center font-bold text-white">{name[0]}</div>}
            </div>
            <div className="min-w-0 text-sm">
              <div>
                <span className="font-semibold text-white">{name}</span> <span className="rounded bg-[#5865f2] px-1 text-[10px] font-bold text-white">APP</span>
              </div>
              <div className="whitespace-pre-wrap text-zinc-300">{guild.message.replace(/\{user\}/gi, '@NieuwLid').replace(/\{name\}/gi, 'NieuwLid').replace(/\{server\}/gi, guild.guildName).replace(/\{count\}/gi, String(guild.memberCount || 1234))}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
