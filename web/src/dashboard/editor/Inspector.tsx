import { useState, type ReactNode } from 'react';
import { ALERT_TYPES, FONTS, LABELS, type Command } from '../api';
import { MediaPicker } from '../components/Shared';
import { isVideo, WALKABLE } from '../../overlay/renderer';
import { Svg, Toggle } from '../ui';
import { t } from '../i18n';
import { EVENT_LABELS, WIDGET_EVENTS, WIDGET_TYPES, type Widget } from './model';

/** Collapsible block of settings; the arrow shows whether it is open. */
export function Section({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-white/[.06]">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left text-sm font-semibold text-zinc-200 hover:bg-white/[.03]">
        {title}
        <Svg i="chevron" className={`h-4 w-4 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="space-y-3.5 px-4 pt-1 pb-4">{children}</div>}
    </section>
  );
}

const Row = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="block">
    <span className="mb-1 block text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-[11px] leading-snug text-zinc-500">{hint}</span>}
  </label>
);
const Switch = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-sm text-zinc-300">{label}</span>
    <Toggle checked={checked} onChange={onChange} label={label} />
  </div>
);
const inp = 'input px-2.5 py-1.5';
const Num = ({ value, onChange, min, max, step = 1 }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) => (
  <input type="number" className={inp} value={value} min={min} max={max} step={step} onChange={(e) => e.target.value !== '' && onChange(Math.min(max, Math.max(min, Number(e.target.value))))} />
);
const Colour = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-ink-950/60 p-1 pr-2.5">
    <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-9 cursor-pointer rounded-lg border-0 bg-transparent" />
    <input className="w-full bg-transparent font-mono text-xs text-zinc-200 outline-none" value={value} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && onChange(e.target.value)} />
  </div>
);
const Choice = <T extends string>({ value, options, onChange }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) => (
  <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(3, options.length)}, minmax(0, 1fr))` }}>
    {options.map(([k, l]) => (
      <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)} className={`cursor-pointer rounded-lg border px-2 py-1.5 text-xs font-semibold transition ${value === k ? 'border-brand-500 bg-brand-500/15 text-white' : 'border-white/10 text-zinc-300 hover:bg-white/[.05]'}`}>
        {l}
      </button>
    ))}
  </div>
);

type Pos = { x: number; y: number; scale: number };

/** Position and size with arrow buttons; the same works with the arrow keys on the canvas. */
function PositionSection({ pos, width, height, maxScale, onChange }: { pos: Pos; width: number; height: number; maxScale: number; onChange: (p: Partial<Pos>) => void }) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const nudge = (dx: number, dy: number, e: React.MouseEvent) => {
    const step = e.shiftKey ? 10 : 1;
    onChange({ x: r2(pos.x + ((dx * step) / width) * 100), y: r2(pos.y + ((dy * step) / height) * 100) });
  };
  const arrow = (label: string, dx: number, dy: number, rot: string, cell: string) => (
    <button type="button" title={label} aria-label={label} onClick={(e) => nudge(dx, dy, e)} className={`${cell} grid h-8 w-8 cursor-pointer place-items-center rounded-lg border border-white/10 bg-white/[.04] text-zinc-200 hover:bg-white/10`}>
      <Svg i="up" className={`h-4 w-4 ${rot}`} />
    </button>
  );
  return (
    <Section title={t('Position & size')} defaultOpen>
      <div className="flex items-center gap-4">
        <div className="grid grid-cols-3 grid-rows-3 gap-1" role="group" aria-label={t('Move')}>
          {arrow(t('Move up'), 0, -1, '', 'col-start-2 row-start-1')}
          {arrow(t('Move left'), -1, 0, '-rotate-90', 'col-start-1 row-start-2')}
          <button type="button" title={t('Centre')} aria-label={t('Centre')} onClick={() => onChange({ x: 50, y: 50 })} className="col-start-2 row-start-2 grid h-8 w-8 cursor-pointer place-items-center rounded-lg border border-brand-500/40 bg-brand-500/10 text-brand-400 hover:bg-brand-500/20">
            <Svg i="target" className="h-4 w-4" />
          </button>
          {arrow(t('Move right'), 1, 0, 'rotate-90', 'col-start-3 row-start-2')}
          {arrow(t('Move down'), 0, 1, 'rotate-180', 'col-start-2 row-start-3')}
        </div>
        <div className="grid flex-1 grid-cols-2 gap-2">
          <Row label="X %"><Num value={pos.x} min={-20} max={120} step={0.5} onChange={(x) => onChange({ x })} /></Row>
          <Row label="Y %"><Num value={pos.y} min={-20} max={120} step={0.5} onChange={(y) => onChange({ y })} /></Row>
        </div>
      </div>
      <p className="text-[11px] text-zinc-500">{t('Tip: drag on the canvas, or use the arrow keys (hold Shift for bigger steps).')}</p>
      <Row label={t('Size: {n}%', { n: Math.round(pos.scale * 100) })}>
        <input type="range" className="w-full" min={0.2} max={maxScale} step={0.05} value={pos.scale} onChange={(e) => onChange({ scale: Number(e.target.value) })} />
      </Row>
      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" className="btn-ghost px-2 py-1.5 text-xs" onClick={() => onChange({ x: 50 })}>{t('Centre horizontally')}</button>
        <button type="button" className="btn-ghost px-2 py-1.5 text-xs" onClick={() => onChange({ y: 50 })}>{t('Centre vertically')}</button>
      </div>
    </Section>
  );
}

function TextStyle({ c, set, accentLabel }: { c: Record<string, any>; set: (k: string, v: unknown) => void; accentLabel?: string }) {
  return (
    <Section title={t('Text style')}>
      <Row label={t('Font')}>
        <select className={inp} value={c.fontFamily} onChange={(e) => set('fontFamily', e.target.value)}>
          {FONTS.map((f) => <option key={f}>{f}</option>)}
        </select>
      </Row>
      <Row label={t('Font size: {n}px', { n: c.fontSize })}>
        <input type="range" className="w-full" min={12} max={240} value={c.fontSize} onChange={(e) => set('fontSize', Number(e.target.value))} />
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <Row label={t('Text colour')}><Colour value={c.color} onChange={(v) => set('color', v)} /></Row>
        <Row label={accentLabel ?? t('Accent colour')}><Colour value={c.accentColor} onChange={(v) => set('accentColor', v)} /></Row>
      </div>
      <Row label={t('Background')}>
        <Choice value={c.background as string} options={[['none', t('None')], ['pill', t('Banner')], ['box', t('Box')]]} onChange={(v) => set('background', v)} />
      </Row>
      <Switch label={t('Text shadow')} checked={c.shadow} onChange={(v) => set('shadow', v)} />
    </Section>
  );
}

export function WidgetInspector({ w, width, height, onChange }: { w: Widget; width: number; height: number; onChange: (patch: Partial<Widget>, key?: string) => void }) {
  const c = w.config;
  const set = (k: string, v: unknown) => onChange({ config: { ...c, [k]: v } }, `cfg-${k}`);
  const type = WIDGET_TYPES.find((x) => x.type === w.type)!;
  const eventOptions = WIDGET_EVENTS.map((e) => [e, t(EVENT_LABELS[e])] as const);
  return (
    <>
      <div className="space-y-3 border-b border-white/[.06] p-4">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-brand-400 uppercase">
          <Svg i={type.icon} className="h-4 w-4" /> {t(type.label)}
        </div>
        <Row label={t('Name (only for you)')}>
          <input className={inp} maxLength={60} value={w.name} onChange={(e) => onChange({ name: e.target.value }, 'name')} />
        </Row>
        <Switch label={t('Visible')} checked={w.enabled} onChange={(v) => onChange({ enabled: v })} />
      </div>
      <PositionSection pos={w} width={width} height={height} maxScale={4} onChange={(p) => onChange(p, 'pos')} />
      <Section title={t('Content')} defaultOpen>
        {w.type === 'text' && (
          <Row label={t('Text')}>
            <textarea className={`${inp} min-h-20`} maxLength={300} value={c.text} onChange={(e) => set('text', e.target.value)} />
          </Row>
        )}
        {w.type === 'image' && (
          <>
            <MediaPicker kind="image" value={c.url || null} onChange={(v) => set('url', v ?? '')} />
            <Row label={t('Width: {n}px', { n: c.width })}>
              <input type="range" className="w-full" min={40} max={1920} step={10} value={c.width} onChange={(e) => set('width', Number(e.target.value))} />
            </Row>
          </>
        )}
        {w.type === 'latest' && (
          <>
            <Row label={t('Which event?')}>
              <select className={inp} value={c.event} onChange={(e) => set('event', e.target.value)}>
                {eventOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Row>
            <Row label={t('Text')} hint={t('{user} = name, {amount} = number of bits, subs or viewers.')}>
              <input className={inp} maxLength={200} value={c.template} onChange={(e) => set('template', e.target.value)} />
            </Row>
            <Row label={t('Text while there is none yet (optional)')}>
              <input className={inp} maxLength={80} value={c.empty} onChange={(e) => set('empty', e.target.value)} />
            </Row>
          </>
        )}
        {w.type === 'rotator' && (
          <>
            <Row label={t('Switch every {n} seconds', { n: c.intervalSec })}>
              <input type="range" className="w-full" min={2} max={60} value={c.intervalSec} onChange={(e) => set('intervalSec', Number(e.target.value))} />
            </Row>
            <p className="text-[11px] text-zinc-500">{t('{user} = name, {amount} = number of bits, subs or viewers.')}</p>
            {eventOptions.map(([k, l]) => {
              const on = (c.events as string[]).includes(k);
              return (
                <div key={k} className="space-y-1.5 rounded-xl border border-white/[.08] p-2.5">
                  <Switch label={l} checked={on} onChange={(v) => set('events', WIDGET_EVENTS.filter((e) => (e === k ? v : (c.events as string[]).includes(e))))} />
                  {on && <input className={inp} aria-label={t('Text for {event}', { event: l })} maxLength={200} value={c.templates[k] ?? ''} onChange={(e) => set('templates', { ...c.templates, [k]: e.target.value })} />}
                </div>
              );
            })}
          </>
        )}
        {w.type === 'goal' && (
          <>
            <Row label={t('What do you count?')}>
              <Choice value={c.metric as string} options={[['follow', t('Followers')], ['sub', t('Subs')], ['bits', t('Bits')]]} onChange={(v) => set('metric', v)} />
            </Row>
            <Row label={t('Title')}>
              <input className={inp} maxLength={80} value={c.title} onChange={(e) => set('title', e.target.value)} />
            </Row>
            <div className="grid grid-cols-2 gap-2">
              <Row label={t('Goal')}><Num value={c.target} min={1} max={1_000_000_000} onChange={(v) => set('target', v)} /></Row>
              <Row label={t('Start at')}><Num value={c.start} min={0} max={1_000_000_000} onChange={(v) => set('start', v)} /></Row>
            </div>
            <p className="text-[11px] text-zinc-500">{t('New followers, subs or bits are added to the start value automatically.')}</p>
            <button type="button" className="btn-ghost w-full px-2 py-1.5 text-xs" onClick={() => set('since', Date.now())}>
              <Svg i="refresh" className="h-3.5 w-3.5" /> {t('Start counting again from now')}
            </button>
            <Row label={t('Width: {n}px', { n: c.width })}>
              <input type="range" className="w-full" min={200} max={1920} step={10} value={c.width} onChange={(e) => set('width', Number(e.target.value))} />
            </Row>
            <Row label={t('Bar colour')}><Colour value={c.barColor} onChange={(v) => set('barColor', v)} /></Row>
          </>
        )}
        {w.type === 'countdown' && (
          <>
            <Row label={t('Label (optional)')}>
              <input className={inp} maxLength={80} value={c.label} onChange={(e) => set('label', e.target.value)} />
            </Row>
            <Row label={t('Minutes')}>
              <Num value={Math.round((c.seconds / 60) * 10) / 10} min={0.1} max={1440} step={0.5} onChange={(v) => set('seconds', Math.round(v * 60))} />
            </Row>
            <Row label={t('Text when it reaches zero (optional)')}>
              <input className={inp} maxLength={80} value={c.endText} onChange={(e) => set('endText', e.target.value)} />
            </Row>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" className="btn-primary px-2 py-1.5 text-xs" onClick={() => set('endsAt', Date.now() + c.seconds * 1000)}>
                <Svg i="play" className="h-3 w-3" /> {c.endsAt ? t('Restart') : t('Start')}
              </button>
              <button type="button" className="btn-ghost px-2 py-1.5 text-xs" disabled={!c.endsAt} onClick={() => set('endsAt', null)}>{t('Reset')}</button>
            </div>
            <p className="text-[11px] text-zinc-500">{t('Press Start and then Save: the countdown starts running in OBS.')}</p>
          </>
        )}
      </Section>
      {w.type !== 'image' && <TextStyle c={c} set={set} accentLabel={w.type === 'text' || w.type === 'goal' || w.type === 'countdown' ? t('Background colour') : t('Name colour')} />}
    </>
  );
}

export function CommandInspector({ c, width, height, onChange }: { c: Command; width: number; height: number; onChange: (patch: Partial<Command>, key?: string) => void }) {
  const isAlert = c.trigger !== 'chat';
  const info = ALERT_TYPES.find((a) => a.trigger === c.trigger);
  const style = (patch: Partial<Command['style']>, key: string) => onChange({ style: { ...c.style, ...patch } }, key);
  const video = isVideo(c.imageUrl);
  const vars = isAlert ? t('Variables: {list}', { list: info?.vars ?? '{user}' }) : t('Variables: {user} = viewer, {target} = @mentioned name, {channel}, {count} = times used, {args} = text after the command, {random:1-100}.');
  return (
    <>
      <div className="space-y-3 border-b border-white/[.06] p-4">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-brand-400 uppercase">
          <Svg i={isAlert ? 'bell' : 'bolt'} className="h-4 w-4" /> {isAlert ? `${t('Alert')}: ${info?.label ?? c.trigger}` : t('Chat command')}
        </div>
        {isAlert ? (
          <>
            <Row label={t('Name (only for you)')}>
              <input className={inp} maxLength={80} value={c.label ?? ''} placeholder={info?.label} onChange={(e) => onChange({ label: e.target.value || null }, 'label')} />
            </Row>
            {info?.amount && (
              <Row label={t('From how many {unit}?', { unit: info.amount })} hint={t('You can create several variants; the one with the highest matching minimum is played.')}>
                <Num value={c.minAmount} min={0} max={1_000_000} onChange={(v) => onChange({ minAmount: v }, 'min')} />
              </Row>
            )}
          </>
        ) : (
          <Row label={t('Command name')} hint={t('Viewers type this in chat. Optionally followed by @name: {target}.')}>
            <div className="flex items-center rounded-xl border border-white/10 bg-ink-950/60 focus-within:border-brand-500/70">
              <span className="pl-3 font-mono text-brand-400">!</span>
              <input className="w-full bg-transparent px-1 py-1.5 font-mono text-sm text-white outline-none" maxLength={30} value={c.name} onChange={(e) => onChange({ name: e.target.value.replace(/^!/, '').replace(/\s/g, '').toLowerCase() }, 'name')} />
            </div>
          </Row>
        )}
        <Switch label={t('Enabled')} checked={c.enabled} onChange={(v) => onChange({ enabled: v })} />
      </div>
      <PositionSection pos={{ x: c.style.x, y: c.style.y, scale: c.style.scale }} width={width} height={height} maxScale={2.5} onChange={(p) => style({ ...p, ...(p.x !== undefined ? { x: Math.min(100, Math.max(0, p.x)) } : {}), ...(p.y !== undefined ? { y: Math.min(100, Math.max(0, p.y)) } : {}) }, 'pos')} />
      <Section title={t('Animation')} defaultOpen>
        <Row label={t('Animation')}>
          <select className={inp} value={c.animation} onChange={(e) => onChange({ animation: e.target.value })}>
            {Object.entries(LABELS.animation).filter(([k]) => k !== 'none').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Row>
        {c.animation !== 'image' && (
          <Row label={t('Character style')}>
            <Choice value={c.characterStyle} options={[['anime', LABELS.style.anime], ['people', LABELS.style.people]]} onChange={(v) => onChange({ characterStyle: v })} />
          </Row>
        )}
        {WALKABLE.has(c.animation) && <Switch label={t('Walk towards each other')} checked={c.walkIn} onChange={(v) => onChange({ walkIn: v, durationMs: v && c.durationMs < 7000 ? 7000 : c.durationMs })} />}
        <Row label={c.animation === 'image' ? t('Image, GIF or video') : t('Extra image / GIF / video (optional)')}>
          <MediaPicker kind="image" value={c.imageUrl} onChange={(v) => onChange({ imageUrl: v })} />
        </Row>
        <div className="grid grid-cols-2 gap-2">
          <Row label={t('Entrance effect')}>
            <select className={inp} value={c.style.effect} onChange={(e) => style({ effect: e.target.value as Command['style']['effect'] }, 'effect')}>
              {Object.entries(LABELS.effect).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Row>
          <Row label={t('Particles')}>
            <select className={inp} value={c.style.particles} onChange={(e) => style({ particles: e.target.value as Command['style']['particles'] }, 'particles')}>
              {Object.entries(LABELS.particles).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Row>
        </div>
        {video && <Switch label={t('Duration = video length')} checked={c.useVideoLength} onChange={(v) => onChange({ useVideoLength: v })} />}
        <Row label={c.useVideoLength && video ? t('Visible: as long as the video') : t('Visible: {n} seconds', { n: (c.durationMs / 1000).toFixed(1) })}>
          <input type="range" className="w-full disabled:opacity-40" disabled={c.useVideoLength && video} min={1500} max={20000} step={500} value={c.durationMs} onChange={(e) => onChange({ durationMs: Number(e.target.value) }, 'duration')} />
        </Row>
      </Section>
      <Section title={t('Text & style')}>
        <Switch label={t('Show text')} checked={c.showText} onChange={(v) => onChange({ showText: v })} />
        <Row label={t('Text')} hint={vars}>
          <input className={inp} maxLength={200} value={c.text} onChange={(e) => onChange({ text: e.target.value }, 'text')} />
        </Row>
        <Switch label={t('Show username')} checked={c.showUsername} onChange={(v) => onChange({ showUsername: v })} />
        {!isAlert && (
          <>
            <Row label={t('Name of the recipient')}>
              <Choice value={c.targetMode} options={[['optional', t('Optional')], ['required', t('Required')], ['none', t('No name')]]} onChange={(v) => onChange({ targetMode: v })} />
            </Row>
            {c.targetMode !== 'required' && (
              <Row label={t('Text when there is no name')}>
                <input className={inp} maxLength={40} value={c.targetFallback} onChange={(e) => onChange({ targetFallback: e.target.value }, 'fallback')} />
              </Row>
            )}
          </>
        )}
        <Row label={t('Font')}>
          <select className={inp} value={c.style.fontFamily} onChange={(e) => style({ fontFamily: e.target.value }, 'font')}>
            {FONTS.map((f) => <option key={f}>{f}</option>)}
          </select>
        </Row>
        <Row label={t('Font size: {n}px', { n: c.style.fontSize })}>
          <input type="range" className="w-full" min={16} max={120} value={c.style.fontSize} onChange={(e) => style({ fontSize: Number(e.target.value) }, 'fontSize')} />
        </Row>
        <div className="grid grid-cols-2 gap-2">
          <Row label={t('Text colour')}><Colour value={c.style.textColor} onChange={(v) => style({ textColor: v }, 'textColor')} /></Row>
          <Row label={t('Accent colour')}><Colour value={c.style.accentColor} onChange={(v) => style({ accentColor: v }, 'accent')} /></Row>
        </div>
        <Switch label={t('Text shadow')} checked={c.style.textShadow} onChange={(v) => style({ textShadow: v }, 'shadow')} />
      </Section>
      <Section title={t('Chat reply')}>
        <Row label={t('Chat reply (optional)')} hint={t('The bot (your Twitch account) sends this message in chat.')}>
          <textarea className={`${inp} min-h-20`} maxLength={480} value={c.reply ?? ''} onChange={(e) => onChange({ reply: e.target.value || null }, 'reply')} />
        </Row>
        {!isAlert && (
          <Row label={t('Aliases')} hint={t('Other names for the same command, separated by commas. E.g. socials, links')}>
            <input className={`${inp} font-mono`} value={c.aliases.join(', ')} onChange={(e) => onChange({ aliases: e.target.value.split(',').map((a) => a.trim().replace(/^!/, '').toLowerCase()).filter((a, i, all) => a || i === all.length - 1) }, 'aliases')} />
          </Row>
        )}
      </Section>
      {!isAlert && (
        <Section title={t('Cooldowns & permissions')}>
          <Row label={t('Who can use this command?')}>
            <select className={inp} value={c.permission} onChange={(e) => onChange({ permission: e.target.value as Command['permission'] })}>
              {Object.entries(LABELS.permission).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Row>
          <div className="grid grid-cols-2 gap-2">
            <Row label={t('Cooldown per user (sec)')}><Num value={c.userCooldownSec} min={0} max={86400} onChange={(v) => onChange({ userCooldownSec: v }, 'ucd')} /></Row>
            <Row label={t('Global cooldown (sec)')}><Num value={c.globalCooldownSec} min={0} max={86400} onChange={(v) => onChange({ globalCooldownSec: v }, 'gcd')} /></Row>
          </div>
        </Section>
      )}
      <Section title={t('Sound')}>
        <MediaPicker kind="audio" value={c.soundUrl} onChange={(v) => onChange({ soundUrl: v })} />
        <Row label={`Volume: ${c.soundVolume}%`}>
          <input type="range" className="w-full" min={0} max={100} value={c.soundVolume} onChange={(e) => onChange({ soundVolume: Number(e.target.value) }, 'volume')} />
        </Row>
      </Section>
    </>
  );
}
