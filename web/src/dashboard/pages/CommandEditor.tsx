import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ALERT_TYPES, api, FONTS, LABELS, type Command, type Trigger } from '../api';
import { useMe } from '../App';
import { OverlayPreview } from '../components/OverlayPreview';
import { figure } from '../../overlay/characters';
import { isVideo, WALKABLE } from '../../overlay/renderer';
import { MediaPicker } from '../components/Shared';
import { Field, PageHeader, Svg, Toggle, useToast } from '../ui';

type Draft = Omit<Command, 'id'> & { id?: number };

/** Stable fingerprint of the editable fields, used to detect unsaved changes. */
const fingerprint = (x: Draft) =>
  JSON.stringify(Object.keys(blank).map((k) => {
    const v = x[k as keyof Draft];
    return v && typeof v === 'object' ? Object.entries(v).sort(([a], [b]) => a.localeCompare(b)) : v;
  }));

const blank: Draft = {
  name: '',
  trigger: 'chat',
  reply: null,
  aliases: [],
  minAmount: 0,
  enabled: true,
  animation: 'hug',
  characterStyle: 'anime',
  walkIn: false,
  useVideoLength: false,
  imageUrl: null,
  soundUrl: null,
  soundVolume: 70,
  text: '{user} geeft {target} een knuffel!',
  durationMs: 5000,
  userCooldownSec: 30,
  globalCooldownSec: 5,
  permission: 'everyone',
  showUsername: true,
  showText: true,
  targetMode: 'optional',
  targetFallback: 'de streamer',
  style: { fontFamily: 'Fredoka', fontSize: 44, textColor: '#ffffff', accentColor: '#a855f7', x: 50, y: 62, scale: 1, effect: 'pop', particles: 'hearts', textShadow: true },
};

export function CommandEditor() {
  const { id } = useParams();
  const isNew = id === 'new';
  const [params] = useSearchParams();
  const newTrigger = (params.get('trigger') ?? 'chat') as Trigger;
  const newDraft: Draft =
    newTrigger === 'chat'
      ? blank
      : {
          ...blank,
          trigger: newTrigger,
          name: `alert-${newTrigger}-${Date.now().toString(36)}`.slice(0, 30),
          animation: 'love',
          text: newTrigger === 'follow' ? 'Bedankt voor de follow, {user}!' : '{user}: {amount}!',
          targetMode: 'none',
          userCooldownSec: 0,
          globalCooldownSec: 0,
          minAmount: Number(params.get('min')) || 0,
        };
  const nav = useNavigate();
  const toast = useToast();
  const { me, reload } = useMe();
  const [d, setD] = useState<Draft | null>(isNew ? newDraft : null);
  const [saving, setSaving] = useState(false);
  const [replay, setReplay] = useState(0);
  const [tab, setTab] = useState<'visual' | 'text' | 'chat' | 'rules' | 'sound'>('visual');
  const [savedPrint, setSavedPrint] = useState(isNew ? fingerprint(newDraft) : '');
  const [savedDraft, setSavedDraft] = useState<Draft | null>(isNew ? newDraft : null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirty = d !== null && fingerprint(d) !== savedPrint;
  const saveRef = useRef<() => Promise<void>>(async () => undefined);

  // Ctrl/Cmd+S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Ask before leaving via any in-app link (sidebar, buttons) while there are unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || e.defaultPrevented) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      if (!confirm('Je hebt wijzigingen die nog niet zijn opgeslagen. Weet je zeker dat je deze pagina wilt verlaten?')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [dirty]);

  // Warn before closing/refreshing the tab with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const goBack = () => {
    if (dirty && !confirm('Je hebt wijzigingen die nog niet zijn opgeslagen. Toch teruggaan?')) return;
    nav(d && d.trigger !== 'chat' ? '/alerts' : '/commands');
  };

  useEffect(() => {
    if (isNew) return;
    api<Command[]>('/api/commands').then((all) => {
      const c = all.find((x) => x.id === Number(id));
      if (c) {
        setD(c);
        setSavedDraft(c);
        setSavedPrint(fingerprint(c));
      }
      else nav('/commands');
    });
  }, [id, isNew, nav]);

  if (!d) return <div className="card h-96 animate-pulse" />;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v });
  const style = <K extends keyof Draft['style']>(k: K, v: Draft['style'][K]) => setD({ ...d, style: { ...d.style, [k]: v } });

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await api<Command>(isNew ? '/api/commands' : `/api/commands/${id}`, { method: isNew ? 'POST' : 'PUT', json: { ...d, aliases: d.aliases.filter(Boolean) } });
      toast(`!${saved.name} opgeslagen`);
      void reload();
      setSavedPrint(fingerprint(saved));
      setSavedDraft(saved);
      if (isNew) nav(`/commands/${saved.id}`, { replace: true });
      else setD(saved);
    } catch (e) {
      setSaveError((e as Error).message);
      toast(`Niet opgeslagen: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = save;

  const isAlert = d.trigger !== 'chat';
  const alertInfo = ALERT_TYPES.find((a) => a.trigger === d.trigger);
  const tabs = (
    [
      ['visual', 'Animatie'],
      ['text', 'Tekst & stijl'],
      ['chat', 'Chat-antwoord'],
      ['rules', 'Cooldowns & rechten'],
      ['sound', 'Geluid'],
    ] as const
  ).filter(([k]) => !(isAlert && k === 'rules'));
  const varsHint = isAlert
    ? `Variabelen: ${alertInfo?.vars ?? '{user}'}`
    : 'Variabelen: {user} = kijker, {target} = @genoemde naam, {channel}, {count} = aantal keer gebruikt, {args} = tekst na het command, {random:1-100}.';

  return (
    <>
      <button onClick={goBack} className="mb-3 -ml-1 inline-flex cursor-pointer items-center gap-1 rounded-lg px-1 py-1 text-sm font-semibold text-zinc-400 transition hover:text-white">
        <Svg i="back" className="h-4 w-4" /> {isAlert ? 'Terug naar alerts' : 'Terug naar commands'}
      </button>
      <PageHeader
        title={isAlert ? `Alert: ${alertInfo?.label ?? d.trigger}${d.minAmount ? ` (vanaf ${d.minAmount} ${alertInfo?.amount ?? ''})` : ''}` : isNew ? 'Nieuw command' : `!${d.name}`}
        subtitle="Wijzigingen zie je direct in de preview. Klik of sleep in de preview om de positie te kiezen."
        actions={
          <>
            {dirty && <span className="chip self-center bg-amber-500/15 text-amber-300">niet opgeslagen</span>}
            <button className="btn-ghost" onClick={goBack}>
              Terug
            </button>
            {!isNew && (
              <button
                className="btn-ghost"
                onClick={async () => {
                  await save();
                  const r = await api<{ delivered: number }>(`/api/commands/${id}/test`, { method: 'POST' });
                  toast(r.delivered ? 'Afgespeeld in OBS' : 'Geen overlay open in OBS', r.delivered ? 'ok' : 'error');
                }}
              >
                <Svg i="play" className="h-3.5 w-3.5" /> Opslaan & test in OBS
              </button>
            )}
            <button className="btn-primary" disabled={saving} onClick={save}>
              {saving ? 'Opslaan…' : 'Opslaan'}
            </button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="space-y-5">
          {isAlert ? (
            <section className="card grid gap-4 p-5 sm:grid-cols-[1fr_auto]">
              {alertInfo?.amount ? (
                <Field label={`Vanaf hoeveel ${alertInfo.amount}?`} hint="Je kunt meerdere varianten maken; de variant met het hoogste passende minimum wordt afgespeeld.">
                  <input type="number" className="input" min={0} max={1000000} value={d.minAmount} onChange={(e) => set('minAmount', Math.max(0, Number(e.target.value) || 0))} />
                </Field>
              ) : (
                <p className="self-center text-sm text-zinc-400">Speelt af bij elke {alertInfo?.label.toLowerCase()} op Twitch.</p>
              )}
              <div className="flex items-end gap-3 pb-2">
                <span className="text-sm text-zinc-300">Ingeschakeld</span>
                <Toggle checked={d.enabled} onChange={(v) => set('enabled', v)} />
              </div>
            </section>
          ) : (
          <section className="card grid gap-4 p-5 sm:grid-cols-[1fr_auto]">
            <Field label="Commandnaam" hint="Kijkers typen dit in de chat. Optioneel met @naam erachter: {target}.">
              <div className="flex items-center rounded-xl border border-white/10 bg-ink-950/60 focus-within:border-brand-500/70">
                <span className="pl-3.5 font-mono text-brand-400">!</span>
                <input
                  className="w-full bg-transparent px-1 py-2.5 font-mono text-sm text-white outline-none"
                  value={d.name}
                  placeholder="knuffel"
                  maxLength={30}
                  onChange={(e) => set('name', e.target.value.replace(/^!/, '').replace(/\s/g, '').toLowerCase())}
                />
              </div>
            </Field>
            <div className="flex items-end gap-3 pb-2">
              <span className="text-sm text-zinc-300">Ingeschakeld</span>
              <Toggle checked={d.enabled} onChange={(v) => set('enabled', v)} />
            </div>
          </section>
          )}

          <div className="flex gap-1 overflow-x-auto rounded-xl border border-white/[.06] bg-ink-950/40 p-1">
            {tabs.map(([k, l]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`flex-1 cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition ${tab === k ? 'bg-white/[.08] text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                {l}
              </button>
            ))}
          </div>

          {tab === 'visual' && (
            <section className="card space-y-5 p-5">
              <div>
                <span className="label">Animatie</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {Object.entries(LABELS.animation).map(([k, l]) => (
                    <button
                      key={k}
                      onClick={() => set('animation', k)}
                      className={`cursor-pointer rounded-xl border px-3 py-3 text-left text-sm font-medium transition ${
                        d.animation === k ? 'border-brand-500 bg-brand-500/10 text-white' : 'border-white/10 text-zinc-300 hover:bg-white/[.04]'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              {WALKABLE.has(d.animation) && (
                <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-white">Naar elkaar toe lopen</div>
                    <div className="text-xs text-zinc-500">
                      De personages lopen eerst vanaf de zijkanten naar elkaar toe en {d.animation === 'hug' ? 'knuffelen' : d.animation === 'highfive' ? 'geven dan een high five' : 'gaan dan samen dansen'}. Duurt ca. 2 seconden extra.
                    </div>
                  </div>
                  <Toggle
                    checked={d.walkIn}
                    label="Naar elkaar toe lopen"
                    onChange={(v) => setD({ ...d, walkIn: v, durationMs: v && d.durationMs < 7000 ? 7000 : d.durationMs })}
                  />
                </div>
              )}
              {d.animation !== 'image' && (
                <div>
                  <span className="label">Stijl van de personages</span>
                  <div className="grid grid-cols-2 gap-2">
                    {(['anime', 'people'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={d.characterStyle === k}
                        onClick={() => set('characterStyle', k)}
                        className={`flex cursor-pointer items-center gap-3 rounded-xl border p-2 pr-3 text-left transition ${
                          d.characterStyle === k ? 'border-brand-500 bg-brand-500/10 text-white' : 'border-white/10 text-zinc-300 hover:bg-white/[.04]'
                        }`}
                      >
                        <span className="h-14 w-10 shrink-0" dangerouslySetInnerHTML={{ __html: figure(k, 0) }} />
                        <span>
                          <span className="block text-sm font-semibold">{LABELS.style[k]}</span>
                          <span className="block text-xs text-zinc-500">{k === 'anime' ? 'Schattige chibi-figuurtjes' : 'Poppetjes met echte verhoudingen'}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <span className="label">{d.animation === 'image' ? 'Afbeelding, GIF of video' : 'Extra afbeelding / GIF / video (optioneel)'}</span>
                <MediaPicker kind="image" value={d.imageUrl} onChange={(v) => set('imageUrl', v)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Binnenkomst-effect">
                  <select className="input" value={d.style.effect} onChange={(e) => style('effect', e.target.value as Draft['style']['effect'])}>
                    {Object.entries(LABELS.effect).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Deeltjes">
                  <select className="input" value={d.style.particles} onChange={(e) => style('particles', e.target.value as Draft['style']['particles'])}>
                    {Object.entries(LABELS.particles).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </Field>
                {isVideo(d.imageUrl) && (
                  <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 px-4 py-3 sm:col-span-2">
                    <div>
                      <div className="text-sm font-medium text-white">Duur = lengte van de video</div>
                      <div className="text-xs text-zinc-500">Uit: de video herhaalt zich tot de ingestelde duur voorbij is. Geluid: de video speelt zijn eigen geluid af, tenzij je bij Geluid iets anders kiest.</div>
                    </div>
                    <Toggle checked={d.useVideoLength} onChange={(v) => set('useVideoLength', v)} label="Duur = lengte van de video" />
                  </div>
                )}
                <Field label={d.useVideoLength && isVideo(d.imageUrl) ? 'Zichtbaar: zo lang als de video' : `Zichtbaar: ${(d.durationMs / 1000).toFixed(1)} seconden`}>
                  <input type="range" className="w-full disabled:opacity-40" disabled={d.useVideoLength && isVideo(d.imageUrl)} min={1500} max={20000} step={500} value={d.durationMs} onChange={(e) => set('durationMs', Number(e.target.value))} />
                </Field>
                <Field label={`Grootte: ${Math.round(d.style.scale * 100)}%`}>
                  <input type="range" className="w-full" min={0.3} max={2.5} step={0.05} value={d.style.scale} onChange={(e) => style('scale', Number(e.target.value))} />
                </Field>
                <Field label={`Positie X: ${d.style.x}%`}>
                  <input type="range" className="w-full" min={0} max={100} value={d.style.x} onChange={(e) => style('x', Number(e.target.value))} />
                </Field>
                <Field label={`Positie Y: ${d.style.y}%`}>
                  <input type="range" className="w-full" min={0} max={100} value={d.style.y} onChange={(e) => style('y', Number(e.target.value))} />
                </Field>
              </div>
            </section>
          )}

          {tab === 'text' && (
            <section className="card space-y-5 p-5">
              <div className="flex items-center justify-between rounded-xl border border-white/10 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-white">Tekst tonen</div>
                  <div className="text-xs text-zinc-500">Uit: alleen de animatie of GIF verschijnt, zonder tekstbalk.</div>
                </div>
                <Toggle checked={d.showText} onChange={(v) => set('showText', v)} label="Tekst tonen" />
              </div>
              <div className={`space-y-5 transition ${d.showText ? '' : 'pointer-events-none opacity-40'}`} aria-disabled={!d.showText}>
              <Field label="Tekst" hint={varsHint}>
                <input className="input" value={d.text} maxLength={200} onChange={(e) => set('text', e.target.value)} />
              </Field>
              <div className="flex items-center justify-between rounded-xl border border-white/10 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-white">Gebruikersnaam tonen</div>
                  <div className="text-xs text-zinc-500">Uit: {'{user}'} wordt “Iemand”.</div>
                </div>
                <Toggle checked={d.showUsername} onChange={(v) => set('showUsername', v)} />
              </div>
              {!isAlert && (
              <div className="rounded-xl border border-white/10 p-4">
                <span className="label">Naam van de ontvanger</span>
                <p className="mb-3 text-xs text-zinc-500">
                  Kijkers typen <code className="text-brand-400">!{d.name || 'knuffel'} @naam</code>. Die naam komt op de plek van <code>{'{target}'}</code> in de tekst.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ['optional', 'Optioneel'],
                      ['required', 'Verplicht'],
                      ['none', 'Geen naam'],
                    ] as const
                  ).map(([k, l]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => set('targetMode', k)}
                      className={`cursor-pointer rounded-xl border px-3 py-2.5 text-sm font-medium transition ${d.targetMode === k ? 'border-brand-500 bg-brand-500/10 text-white' : 'border-white/10 text-zinc-300 hover:bg-white/[.04]'}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  {d.targetMode === 'optional' && 'Zonder naam wordt de tekst hieronder gebruikt.'}
                  {d.targetMode === 'required' && 'Zonder naam gebeurt er niets (en gaat er geen cooldown af). In de preview zie je “Vriendje” als voorbeeld.'}
                  {d.targetMode === 'none' && 'Namen achter het command worden genegeerd; {target} wordt de tekst hieronder.'}
                </p>
                {d.targetMode !== 'required' && (
                  <div className="mt-3">
                    <Field label="Tekst als er geen naam is">
                      <input className="input" value={d.targetFallback} maxLength={40} onChange={(e) => set('targetFallback', e.target.value)} />
                    </Field>
                  </div>
                )}
              </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Lettertype">
                  <select className="input" value={d.style.fontFamily} onChange={(e) => style('fontFamily', e.target.value)}>
                    {FONTS.map((f) => <option key={f}>{f}</option>)}
                  </select>
                </Field>
                <Field label={`Lettergrootte: ${d.style.fontSize}px`}>
                  <input type="range" className="w-full" min={16} max={120} value={d.style.fontSize} onChange={(e) => style('fontSize', Number(e.target.value))} />
                </Field>
                <Field label="Tekstkleur">
                  <ColorInput value={d.style.textColor} onChange={(v) => style('textColor', v)} />
                </Field>
                <Field label="Accentkleur (label & namen)">
                  <ColorInput value={d.style.accentColor} onChange={(v) => style('accentColor', v)} />
                </Field>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 px-4 py-3">
                <span className="text-sm font-medium text-white">Tekstschaduw</span>
                <Toggle checked={d.style.textShadow} onChange={(v) => style('textShadow', v)} />
              </div>
              </div>
            </section>
          )}

          {tab === 'chat' && (
            <section className="card space-y-5 p-5">
              <Field
                label="Chat-antwoord (optioneel)"
                hint={`De bot (jouw Twitch-account) stuurt dit bericht in de chat. ${varsHint} Begint nooit met een chatcommando, behalve /me.`}
              >
                <textarea
                  className="input min-h-28"
                  maxLength={480}
                  value={d.reply ?? ''}
                  placeholder={isAlert ? 'Bijv. Welkom {user}, bedankt voor de follow!' : 'Bijv. Volg me ook op Instagram: @jouwnaam'}
                  onChange={(e) => set('reply', e.target.value || null)}
                />
              </Field>
              {!isAlert && (
                <Field label="Aliassen" hint="Andere namen voor hetzelfde command, gescheiden door komma's. Bijv. socials, links">
                  <input
                    className="input font-mono"
                    value={d.aliases.join(', ')}
                    onChange={(e) =>
                      set(
                        'aliases',
                        e.target.value
                          .split(',')
                          .map((a) => a.trim().replace(/^!/, '').toLowerCase())
                          .filter((a, i, all) => a || i === all.length - 1),
                      )
                    }
                  />
                </Field>
              )}
              {d.animation === 'none' && <p className="text-xs text-zinc-500">Animatie staat op “Geen”: dit command stuurt alleen dit chatbericht.</p>}
            </section>
          )}

          {tab === 'rules' && (
            <section className="card space-y-5 p-5">
              <Field label="Wie mag dit command gebruiken?">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {Object.entries(LABELS.permission).map(([k, l]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => set('permission', k as Draft['permission'])}
                      className={`cursor-pointer rounded-xl border px-3 py-2.5 text-sm font-medium transition ${d.permission === k ? 'border-brand-500 bg-brand-500/10 text-white' : 'border-white/10 text-zinc-300 hover:bg-white/[.04]'}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Cooldown per gebruiker (sec)" hint="Hoe vaak één kijker het mag gebruiken.">
                  <input type="number" className="input" min={0} max={86400} value={d.userCooldownSec} onChange={(e) => set('userCooldownSec', Number(e.target.value))} />
                </Field>
                <Field label="Globale cooldown (sec)" hint="Wachttijd voor iedereen na gebruik.">
                  <input type="number" className="input" min={0} max={86400} value={d.globalCooldownSec} onChange={(e) => set('globalCooldownSec', Number(e.target.value))} />
                </Field>
              </div>
              <p className="text-xs text-zinc-500">Als streamer negeer je cooldowns, zodat je altijd kunt testen. Events in een drukke chat worden netjes na elkaar afgespeeld (wachtrij).</p>
            </section>
          )}

          {tab === 'sound' && (
            <section className="card space-y-5 p-5">
              <MediaPicker kind="audio" value={d.soundUrl} onChange={(v) => set('soundUrl', v)} />
              <Field label={`Volume: ${d.soundVolume}%`}>
                <input type="range" className="w-full" min={0} max={100} value={d.soundVolume} onChange={(e) => set('soundVolume', Number(e.target.value))} />
              </Field>
              <p className="text-xs text-zinc-500">Tip: vink in OBS “Audio regelen via OBS” aan bij de Browser Source.</p>
            </section>
          )}
        </div>

        <div className="xl:sticky xl:top-6 xl:self-start">
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Live preview</h2>
              <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setReplay((r) => r + 1)}>
                <Svg i="refresh" className="h-3.5 w-3.5" /> Opnieuw
              </button>
            </div>
            {d.animation === 'none' ? (
              <div className="checker grid aspect-video place-items-center rounded-xl border border-white/10 p-6 text-center">
                <div>
                  <div className="text-sm text-zinc-400">Geen overlay-animatie, alleen een chatbericht:</div>
                  <div className="mx-auto mt-3 max-w-md rounded-2xl rounded-bl-sm bg-ink-700 px-4 py-2.5 text-left text-sm text-zinc-100">
                    <span className="font-semibold text-brand-400">{me.user.displayName}: </span>
                    {d.reply || <i className="text-zinc-500">vul een chat-antwoord in</i>}
                  </div>
                </div>
              </div>
            ) : (
            <OverlayPreview
              cmd={d}
              width={me.overlay.width}
              height={me.overlay.height}
              replayKey={replay}
              onMove={(x, y) => setD((cur) => (cur ? { ...cur, style: { ...cur.style, x, y } } : cur))}
            />
            )}
            <p className="mt-3 text-xs text-zinc-500">
              Zo ziet het eruit in je {me.overlay.width}×{me.overlay.height} overlay. Het geblokte vlak is transparant in OBS.
            </p>
          </div>
        </div>
      </div>
      {dirty && <div className="h-24" aria-hidden="true" />}
      {dirty &&
        createPortal(
        <div
          role="status"
          aria-live="polite"
          className="fade-in fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-amber-400/50 bg-ink-900/95 p-3 pl-4 shadow-[0_0_30px_-8px_rgb(251_191_36/.6),0_20px_40px_-12px_rgb(0_0_0/.8)] backdrop-blur-xl sm:flex-row sm:items-center lg:left-64"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-400/15 text-lg text-amber-300" aria-hidden="true">
              !
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-amber-200">Niet opgeslagen wijzigingen</div>
              <div className="truncate text-xs text-zinc-400">
                {saveError ? <span className="text-rose-300">Opslaan mislukt: {saveError}</span> : <>Nog niet actief in je stream. Opslaan kan ook met Ctrl+S.</>}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {savedDraft && (
              <button
                className="btn-ghost flex-1 py-2 sm:flex-none"
                onClick={() => {
                  setD(savedDraft);
                  setSaveError(null);
                }}
              >
                Ongedaan maken
              </button>
            )}
            <button className="btn-primary flex-1 py-2 sm:flex-none" disabled={saving} onClick={save}>
              {saving ? 'Opslaan…' : 'Opslaan'}
            </button>
          </div>
        </div>,
          // Portal: an animated ancestor would otherwise turn position:fixed into page-relative.
          document.body,
        )}
    </>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-ink-950/60 p-1.5 pr-3">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-10 cursor-pointer rounded-lg border-0 bg-transparent" />
      <input className="w-full bg-transparent font-mono text-sm text-zinc-200 outline-none" value={value} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && onChange(e.target.value)} />
    </div>
  );
}
