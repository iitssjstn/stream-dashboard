import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMe } from '../App';
import { api } from '../api';
import { usePoll } from '../hooks';
import { MediaPicker } from '../components/Shared';
import { Field, PageHeader, StatusDot, Svg, Toggle, useToast } from '../ui';
import { t as tr, Trans } from '../i18n';

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
      toast(tr('Server added! Choose a welcome channel below.'));
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
      <Svg i="plus" className="h-4 w-4" /> {tr('Add server')}
    </a>
  );

  return (
    <>
      <PageHeader title="Discord" subtitle={tr('Your bot for your Discord server(s): welcome messages and more.')} actions={data.configured && addButton} />
      {error && <div className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{tr(error)}</div>}

      {!data.configured ? (
        me.isOwner ? (
          <DiscordSetup onDone={reload} />
        ) : (
          <section className="card p-6 text-sm text-zinc-400">{tr('The Discord bot has not been set up on this installation yet. Ask the administrator to do this once.')}</section>
        )
      ) : (
        <>
          <section className="card mb-5 flex flex-wrap items-center gap-3 p-4 text-sm">
            <StatusDot tone={tone} />
            <span className="text-zinc-200">
              <Trans
                text={data.bot.status === 'connected' ? 'Bot {name} is online' : data.bot.status === 'connecting' ? 'Bot {name} is connecting…' : data.bot.status === 'error' ? 'Bot {name} has a problem' : 'Bot {name} is off'}
                name={data.bot.botName ? <b>{data.bot.botName}</b> : ''}
              />
            </span>
            {data.bot.error && <span className="text-rose-300">{tr(data.bot.error)}</span>}
            {data.bot.warning && <span className="basis-full rounded-lg bg-amber-400/10 px-3 py-2 text-amber-200">{tr(data.bot.warning)}</span>}
            {data.bot.avatarError && <span className="basis-full rounded-lg bg-amber-400/10 px-3 py-2 break-all text-amber-200">⚠ {tr(data.bot.avatarError)}</span>}
          </section>

          {data.guilds.length === 0 ? (
            <section className="card p-8">
              <h2 className="mb-1 text-lg font-semibold text-white">{tr('Add your bot to your Discord server')}</h2>
              <p className="mb-6 text-sm text-zinc-400">{tr('This takes less than a minute. You do need the “Manage Server” permission in that server.')}</p>
              <ol className="mb-6 grid gap-3 sm:grid-cols-3">
                {[tr('Click “Add server”'), tr('Choose your server in Discord'), tr('Click “Authorize”')].map((t, i) => (
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
              <nav className="mb-5 flex gap-2 overflow-x-auto pb-1" aria-label={tr('Your servers')}>
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
                    {g.removedAt && <span className="h-2 w-2 rounded-full bg-rose-500" title={tr('The bot is no longer in this server')} />}
                  </button>
                ))}
                <a href="/auth/discord/connect" className="flex shrink-0 items-center gap-2 rounded-xl border border-dashed border-white/20 px-4 py-2 text-sm font-semibold text-zinc-400 hover:border-white/40 hover:text-white">
                  <Svg i="plus" className="h-4 w-4" /> {tr('Another server')}
                </a>
              </nav>

              {guild.removedAt ? (
                <section className="card border-rose-500/30 p-6">
                  <h2 className="font-semibold text-white">{tr('The bot is no longer in {server}', { server: guild.guildName })}</h2>
                  <p className="mt-1 mb-4 text-sm text-zinc-400">{tr('Someone removed the bot from the server in Discord. Your settings are kept: add it again and everything works again.')}</p>
                  <div className="flex flex-wrap gap-2">
                    {addButton}
                    <RemoveGuildButton guild={guild} onDone={reload} label={tr('Delete settings')} />
                  </div>
                </section>
              ) : (
                <>
                  <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-white/[.06] bg-ink-950/40 p-1" role="tablist">
                    {(
                      [
                        ['welcome', tr('Welcome')],
                        ['profile', tr('Bot profile')],
                        ['server', tr('Server')],
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
                          <p className="text-sm text-zinc-400">{guild.memberCount ? `${tr('{n} members', { n: guild.memberCount })} · ` : ''}{tr('bot is present')}</p>
                        </div>
                      </div>
                      <div className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/[.06] p-5">
                        <h3 className="font-semibold text-white">{tr('Remove the bot from this server')}</h3>
                        <p className="mt-1 mb-4 text-sm text-zinc-400">
                          {tr('The bot leaves {server} and all settings for this server are deleted. You can always add it again later with “Add server”.', { server: guild.guildName })}
                        </p>
                        <RemoveGuildButton guild={guild} onDone={reload} label={tr('Remove the bot from this server')} />
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
        if (!confirm(tr('Are you sure? The bot leaves {server} and the settings for this server are deleted.', { server: guild.guildName }))) return;
        await api(`/api/discord/guilds/${guild.id}`, { method: 'DELETE' });
        toast(tr('Bot removed from {server}', { server: guild.guildName }));
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
      toast(tr('Welcome settings saved'));
      onChange();
    } catch (e) {
      toast(tr((e as Error).message), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card p-5" aria-label={tr('Discord server {server}', { server: g.guildName })}>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {g.guildIcon ? (
          <img src={`https://cdn.discordapp.com/icons/${g.guildId}/${g.guildIcon}.png?size=64`} alt="" className="h-10 w-10 rounded-xl" />
        ) : (
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#5865f2] font-bold text-white">{g.guildName[0]}</div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold text-white">{g.guildName}</h2>
          <div className="text-xs text-zinc-500">{g.memberCount ? tr('{n} members', { n: g.memberCount }) : tr('Discord server')}</div>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <Toggle checked={g.enabled} onChange={(v) => setG({ ...g, enabled: v })} label={tr('Welcome messages on')} /> {tr('Welcome on')}
        </label>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <Field label={tr('Channel')} hint={channelError ? tr(channelError) : tr('The bot must be allowed to send messages and files in this channel.')}>
            <select className="input" value={g.channelId ?? ''} onChange={(e) => setG({ ...g, channelId: e.target.value || null })}>
              <option value="">{tr('— choose a channel —')}</option>
              {(channels ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr('Message')} hint={tr('Enter = new line. {user} = mention of the new member, {name} = name, {server}, {count} = member count. Discord formatting works too: **bold**, *italic*, > quote.')}>
            <textarea
              className="input min-h-36 resize-y leading-relaxed"
              rows={6}
              maxLength={1500}
              value={g.message}
              placeholder={tr('Hi {user},\n\nWelcome to {server}! Please read the rules in #rules.')}
              onChange={(e) => setG({ ...g, message: e.target.value })}
            />
            <span className="mt-1 block text-right text-xs text-zinc-500">{g.message.length}/1500</span>
          </Field>
          <div>
            <span className="label">{tr('Background (empty = gradient)')}</span>
            <MediaPicker kind="image" allowVideo={false} value={g.card.background} onChange={(v) => card('background', v)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr('Title')}>
              <input className="input" maxLength={80} value={g.card.title} onChange={(e) => card('title', e.target.value)} />
            </Field>
            <Field label={tr('Subtitle')}>
              <input className="input" maxLength={120} value={g.card.subtitle} onChange={(e) => card('subtitle', e.target.value)} />
            </Field>
            <Field label={tr('Accent colour (ring around avatar)')}>
              <input type="color" className="h-10 w-full cursor-pointer rounded-xl border border-white/10 bg-transparent" value={g.card.accentColor} onChange={(e) => card('accentColor', e.target.value)} />
            </Field>
            <Field label={tr('Text colour')}>
              <input type="color" className="h-10 w-full cursor-pointer rounded-xl border border-white/10 bg-transparent" value={g.card.textColor} onChange={(e) => card('textColor', e.target.value)} />
            </Field>
          </div>
          <Field label={tr('Darken background: {n}%', { n: g.card.dim })}>
            <input type="range" className="w-full" min={0} max={90} value={g.card.dim} onChange={(e) => card('dim', Number(e.target.value))} />
          </Field>
        </div>

        <div className="xl:sticky xl:top-6 xl:self-start">
          <span className="label">{tr('Preview')}</span>
          <div className="overflow-hidden rounded-xl border border-white/10 bg-[#313338] p-3">
            <div className="mb-2 text-sm whitespace-pre-wrap text-zinc-200">
              {g.message.replace(/\{user\}/gi, `@${tr('NewMember')}`).replace(/\{name\}/gi, tr('NewMember')).replace(/\{server\}/gi, g.guildName).replace(/\{count\}/gi, String(g.memberCount || 1234))}
            </div>
            {preview ? <img src={preview} alt={tr('Preview of the welcome image')} className="w-full rounded-lg" /> : <div className="aspect-[1100/420] animate-pulse rounded-lg bg-white/5" />}
          </div>
          <p className="mt-2 text-xs text-zinc-500">{tr('In reality it shows the avatar and name of the new member.')}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-white/[.06] pt-4">
        <button
          className="btn-ghost"
          disabled={!guild.channelId || dirty}
          title={dirty ? tr('Save first') : !guild.channelId ? tr('Choose a channel first') : undefined}
          onClick={async () => {
            try {
              await api(`/api/discord/guilds/${g.id}/test`, { method: 'POST' });
              toast(tr('Test message sent in Discord'));
            } catch (e) {
              toast(tr((e as Error).message), 'error');
            }
          }}
        >
          <Svg i="play" className="h-3.5 w-3.5" /> {tr('Send test')}
        </button>
        <button className="btn-primary" disabled={saving || !dirty} onClick={save}>
          {saving ? tr('Saving…') : dirty ? tr('Save') : tr('Saved')}
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
  if (data.source === 'secret') return <section className="card p-5 text-sm text-zinc-400">{tr('The Discord bot is managed via Docker secrets.')}</section>;

  return (
    <section className="card p-5">
      <h2 className="font-semibold text-white">{tr('Set up the Discord bot (once, owner)')}</h2>
      <p className="mt-1 mb-4 text-sm text-zinc-400">
        {tr('Discord only lets you create bots by hand. Do this once; after that every streamer can connect their server with one click.')}
        {data.source === 'setup' && ` ${tr('A bot is already set up; fill in everything again to replace it.')}`}
      </p>
      <ol className="mb-5 space-y-2 text-sm text-zinc-300">
        <li>
          <Trans
            text="1. Go to {site} → {newApp} (e.g. “Waviloop”)."
            site={
              <a className="font-semibold text-brand-400 underline" href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">
                discord.com/developers/applications
              </a>
            }
            newApp={<b>New Application</b>}
          />
        </li>
        <li>
          <Trans
            text="2. {oauth} → {redirects} → add: {uri}"
            oauth={<b>OAuth2</b>}
            redirects={<b>Redirects</b>}
            uri={<code className="rounded bg-white/5 px-1.5 py-0.5 text-brand-400 select-all">{data.redirectUri}</code>}
          />
        </li>
        <li>
          <Trans
            text="3. {bot} → turn on {members} and {content} (for welcome, AutoMod and levels) → {reset} and copy the token."
            bot={<b>Bot</b>}
            members={<b>Server Members Intent</b>}
            content={<b>Message Content Intent</b>}
            reset={<b>Reset Token</b>}
          />
        </li>
        <li>
          <Trans text="4. Copy the {id} (General Information) and the {secret} (OAuth2)." id={<b>Application ID</b>} secret={<b>Client Secret</b>} />
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
            setError(tr((err as Error).message));
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
        <Field label={tr('Bot token')} hint={tr('Stored encrypted and never shown again.')}>
          <input className="input font-mono" type="password" value={botToken} onChange={(e) => setBotToken(e.target.value.trim())} required autoComplete="new-password" />
        </Field>
        {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
        <button className="btn-primary justify-self-start" disabled={busy}>
          {busy ? tr('Checking with Discord…') : tr('Save bot')}
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
      toast(tr('Bot profile on {server} updated', { server: guild.guildName }));
      onChange();
    } catch (e) {
      setError(tr((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5" aria-label={tr('Bot profile on {server}', { server: guild.guildName })}>
      <h3 className="font-semibold text-white">{tr('Your bot on {server}', { server: guild.guildName })}</h3>
      <p className="mt-1 mb-5 text-sm text-zinc-400">{tr('Give the bot its own name, profile picture and description. This only applies to your server: other streamers have their own version.')}</p>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <Field label={tr('Bot name')} hint={tr('Max. 32 characters. Empty = default name.')}>
            <input className="input" maxLength={32} placeholder={bot.botName ?? 'Waviloop'} value={p.nick ?? ''} onChange={(e) => setP({ ...p, nick: e.target.value || null })} />
          </Field>
          <div>
            <span className="label">{tr('Profile picture (PNG, JPG, GIF or WEBP; GIFs may be animated)')}</span>
            <MediaPicker kind="image" allowVideo={false} value={p.avatar} onChange={(v) => setP({ ...p, avatar: v })} />
          </div>
          <Field label={tr('About me')} hint={tr('Max. 190 characters, shown in the bot profile.')}>
            <textarea className="input min-h-20" maxLength={190} value={p.bio ?? ''} placeholder={tr('E.g. The official bot of KnuffelStreamer 💜')} onChange={(e) => setP({ ...p, bio: e.target.value || null })} />
          </Field>
          {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
          <div className="flex justify-end gap-2">
            {dirty && (
              <button className="btn-ghost" onClick={() => setP(saved)}>
                {tr('Undo')}
              </button>
            )}
            <button className="btn-primary" disabled={busy || !dirty} onClick={save}>
              {busy ? tr('Saving with Discord…') : dirty ? tr('Save bot profile') : tr('Saved')}
            </button>
          </div>
        </div>
        <div>
          <span className="label">{tr('This is how your bot looks in Discord')}</span>
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
              <div className="whitespace-pre-wrap text-zinc-300">{guild.message.replace(/\{user\}/gi, `@${tr('NewMember')}`).replace(/\{name\}/gi, tr('NewMember')).replace(/\{server\}/gi, guild.guildName).replace(/\{count\}/gi, String(guild.memberCount || 1234))}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
