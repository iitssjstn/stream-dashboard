import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, FONTS, LABELS, type Command } from '../api';
import { useMe } from '../App';
import { OverlayPreview } from '../components/OverlayPreview';
import { MediaPicker } from '../components/Shared';
import { Field, PageHeader, Svg, Toggle, useToast } from '../ui';

type Draft = Omit<Command, 'id'> & { id?: number };

const blank: Draft = {
  name: '',
  enabled: true,
  animation: 'hug',
  imageUrl: null,
  soundUrl: null,
  soundVolume: 70,
  text: '{user} geeft {target} een knuffel!',
  durationMs: 5000,
  userCooldownSec: 30,
  globalCooldownSec: 5,
  permission: 'everyone',
  showUsername: true,
  style: { fontFamily: 'Fredoka', fontSize: 44, textColor: '#ffffff', accentColor: '#a855f7', x: 50, y: 62, scale: 1, effect: 'pop', particles: 'hearts', textShadow: true },
};

export function CommandEditor() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const toast = useToast();
  const { me, reload } = useMe();
  const [d, setD] = useState<Draft | null>(isNew ? blank : null);
  const [saving, setSaving] = useState(false);
  const [replay, setReplay] = useState(0);
  const [tab, setTab] = useState<'visual' | 'text' | 'rules' | 'sound'>('visual');

  useEffect(() => {
    if (isNew) return;
    api<Command[]>('/api/commands').then((all) => {
      const c = all.find((x) => x.id === Number(id));
      if (c) setD(c);
      else nav('/commands');
    });
  }, [id, isNew, nav]);

  if (!d) return <div className="card h-96 animate-pulse" />;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v });
  const style = <K extends keyof Draft['style']>(k: K, v: Draft['style'][K]) => setD({ ...d, style: { ...d.style, [k]: v } });

  const save = async () => {
    setSaving(true);
    try {
      const saved = await api<Command>(isNew ? '/api/commands' : `/api/commands/${id}`, { method: isNew ? 'POST' : 'PUT', json: d });
      toast(`!${saved.name} opgeslagen`);
      void reload();
      if (isNew) nav(`/commands/${saved.id}`, { replace: true });
      else setD(saved);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    ['visual', 'Animatie'],
    ['text', 'Tekst & stijl'],
    ['rules', 'Cooldowns & rechten'],
    ['sound', 'Geluid'],
  ] as const;

  return (
    <>
      <PageHeader
        title={isNew ? 'Nieuw command' : `!${d.name}`}
        subtitle="Wijzigingen zie je direct in de preview. Klik of sleep in de preview om de positie te kiezen."
        actions={
          <>
            <button className="btn-ghost" onClick={() => nav('/commands')}>
              Annuleren
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
              <div>
                <span className="label">{d.animation === 'image' ? 'Afbeelding of GIF' : 'Extra afbeelding / GIF (optioneel)'}</span>
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
                <Field label={`Zichtbaar: ${(d.durationMs / 1000).toFixed(1)} seconden`}>
                  <input type="range" className="w-full" min={1500} max={20000} step={500} value={d.durationMs} onChange={(e) => set('durationMs', Number(e.target.value))} />
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
              <Field label="Tekst" hint="Variabelen: {user} = kijker, {target} = @genoemde naam (anders “de streamer”), {channel} = jouw kanaal.">
                <input className="input" value={d.text} maxLength={200} onChange={(e) => set('text', e.target.value)} />
              </Field>
              <div className="flex items-center justify-between rounded-xl border border-white/10 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-white">Gebruikersnaam tonen</div>
                  <div className="text-xs text-zinc-500">Uit: {'{user}'} wordt “Iemand”.</div>
                </div>
                <Toggle checked={d.showUsername} onChange={(v) => set('showUsername', v)} />
              </div>
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
            <OverlayPreview
              cmd={d}
              width={me.overlay.width}
              height={me.overlay.height}
              replayKey={replay}
              onMove={(x, y) => setD((cur) => (cur ? { ...cur, style: { ...cur.style, x, y } } : cur))}
            />
            <p className="mt-3 text-xs text-zinc-500">
              Zo ziet het eruit in je {me.overlay.width}×{me.overlay.height} overlay. Het geblokte vlak is transparant in OBS.
            </p>
          </div>
        </div>
      </div>
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
