import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ALERT_TYPES, api, LABELS } from '../api';
import { PageHeader, Svg, Toggle, useToast } from '../ui';
import { MediaThumb } from '../components/Shared';

type Cmd = { key: string; name: string; aliases: string[]; reply: string; permission: string; userCooldownSec: number; globalCooldownSec: number; enabled: boolean; warnings: string[] };
type Tmr = { key: string; name: string; messages: string[]; intervalMin: number; offlineIntervalMin: number; minChatLines: number; enabled: boolean; warnings: string[] };
type Alr = { key: string; label: string; overlay: string; trigger: string; enabled: boolean; minAmount: number; text: string; imageUrl: string | null; soundUrl: string | null; durationMs: number; warnings: string[] };
type Preview = { channel: { name: string }; commands: Cmd[]; timers: Tmr[]; alerts: Alr[]; skipped: { what: string; reason: string }[]; existingCommands: string[] };
type Result = { created: number; updated: number; skipped: number; timers: number; alerts: number; errors: string[] };

export function ImportPage() {
  const [jwt, setJwt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const toast = useToast();

  const load = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const p = await api<Preview>('/api/import/streamelements/preview', { method: 'POST', json: { jwt } });
      setPreview(p);
      setPicked(new Set([...p.commands, ...p.timers, ...p.alerts].map((i) => i.key)));
      setJwt(''); // not needed any more
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await api<Result>('/api/import/streamelements/apply', {
        method: 'POST',
        json: {
          overwrite,
          commands: preview.commands.filter((c) => picked.has(c.key)),
          timers: preview.timers.filter((t) => picked.has(t.key)),
          alerts: preview.alerts.filter((a) => picked.has(a.key)),
        },
      });
      setResult(r);
      setPreview(null);
      toast('Import klaar');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: string) => setPicked((s) => (s.has(key) ? new Set([...s].filter((k) => k !== key)) : new Set(s).add(key)));
  const setAll = (keys: string[], on: boolean) => setPicked((s) => (on ? new Set([...s, ...keys]) : new Set([...s].filter((k) => !keys.includes(k)))));
  const count = picked.size;

  return (
    <>
      <PageHeader title="Importeren uit StreamElements" subtitle="Neem je chat-commands, timers en alerts in één keer over." />

      {result && (
        <section className="card mb-6 border-emerald-400/30 p-5" role="status">
          <h2 className="font-semibold text-emerald-300">Import voltooid</h2>
          <ul className="mt-2 space-y-1 text-sm text-zinc-300">
            <li>
              {result.created} commands toegevoegd, {result.updated} bijgewerkt{result.skipped ? `, ${result.skipped} overgeslagen (bestonden al)` : ''}
            </li>
            <li>{result.timers} timers</li>
            <li>{result.alerts} alerts (de standaard-Waviloop-alerts van die types zijn uitgezet)</li>
          </ul>
          {result.errors.length > 0 && (
            <ul className="mt-3 list-inside list-disc text-sm text-rose-300">
              {result.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/commands" className="btn-ghost">Commands bekijken</Link>
            <Link to="/timers" className="btn-ghost">Timers bekijken</Link>
            <Link to="/alerts" className="btn-ghost">Alerts bekijken</Link>
          </div>
        </section>
      )}

      {!preview && (
        <section className="card max-w-3xl p-5">
          <ol className="mb-5 space-y-2 text-sm text-zinc-300">
            <li>
              1. Open{' '}
              <a className="font-semibold text-brand-400 underline" href="https://streamelements.com/dashboard/account/channels" target="_blank" rel="noreferrer">
                StreamElements → Account → Channels
              </a>
              .
            </li>
            <li>2. Klik op <b>Show secrets</b> en kopieer het <b>JWT Token</b>.</li>
            <li>3. Plak het hieronder. Het wordt alleen gebruikt om je gegevens op te halen en wordt nergens opgeslagen.</li>
          </ol>
          <form onSubmit={load} className="flex flex-col gap-2 sm:flex-row" autoComplete="off">
            <input className="input font-mono" type="password" aria-label="StreamElements JWT-token" placeholder="eyJhbGciOi…" value={jwt} onChange={(e) => setJwt(e.target.value.trim())} required />
            <button className="btn-primary" disabled={busy || !jwt}>
              <Svg i="download" className="h-4 w-4" /> {busy ? 'Ophalen…' : 'Ophalen'}
            </button>
          </form>
          {error && <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
          <p className="mt-4 text-xs text-zinc-500">Tip: maak na de import in StreamElements een nieuw JWT-token aan (Account → Channels), dan is het oude token ongeldig.</p>
        </section>
      )}

      {preview && (
        <>
          <section className="card mb-5 flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
            <div className="flex-1 text-sm text-zinc-300">
              Gevonden in <b className="text-white">{preview.channel.name}</b>: {preview.commands.length} commands, {preview.timers.length} timers, {preview.alerts.length} alerts.
              {preview.existingCommands.length > 0 && <span className="block text-amber-300">{preview.existingCommands.length} command(s) bestaan al in Waviloop.</span>}
            </div>
            <label className="flex items-center gap-3 text-sm text-zinc-300">
              <Toggle checked={overwrite} onChange={setOverwrite} label="Bestaande overschrijven" /> Bestaande overschrijven
            </label>
          </section>

          <Group title="Chat-commands" keys={preview.commands.map((c) => c.key)} picked={picked} setAll={setAll}>
            {preview.commands.map((c) => (
              <Row key={c.key} k={c.key} picked={picked} toggle={toggle} warnings={c.warnings} badge={preview.existingCommands.includes(c.name) ? (overwrite ? 'wordt overschreven' : 'bestaat al, wordt overgeslagen') : null}>
                <span className="font-mono font-semibold text-white">!{c.name}</span>
                {c.aliases.length > 0 && <span className="ml-2 text-xs text-zinc-500">({c.aliases.map((a) => `!${a}`).join(', ')})</span>}
                <span className="block truncate text-sm text-zinc-400">{c.reply}</span>
                <span className="text-xs text-zinc-500">
                  {LABELS.permission[c.permission]} · cooldown {c.userCooldownSec}s / {c.globalCooldownSec}s{c.enabled ? '' : ' · uit'}
                </span>
              </Row>
            ))}
          </Group>

          <Group title="Timers" keys={preview.timers.map((t) => t.key)} picked={picked} setAll={setAll}>
            {preview.timers.map((t) => (
              <Row key={t.key} k={t.key} picked={picked} toggle={toggle} warnings={t.warnings}>
                <span className="font-semibold text-white">{t.name}</span>
                <span className="block truncate text-sm text-zinc-400">{t.messages.join(' · ')}</span>
                <span className="text-xs text-zinc-500">
                  elke {t.intervalMin} min · min. {t.minChatLines} chatberichten{t.enabled ? '' : ' · uit'}
                </span>
              </Row>
            ))}
          </Group>

          <Group title="Alerts" keys={preview.alerts.map((a) => a.key)} picked={picked} setAll={setAll}>
            {preview.alerts.map((a) => (
              <Row key={a.key} k={a.key} picked={picked} toggle={toggle} warnings={a.warnings}>
                <span className="flex items-center gap-3">
                  {a.imageUrl ? <MediaThumb src={a.imageUrl} alt="" className="checker h-10 w-10 rounded-lg object-contain" /> : <span className="grid h-10 w-10 place-items-center rounded-lg bg-white/5 text-lg">🔔</span>}
                  <span className="min-w-0">
                    <span className="font-semibold text-white">
                      {a.overlay ? `${a.overlay} — ` : ''}
                      {a.label}
                    </span>
                    <span className="ml-2 text-xs text-zinc-500">
                      ({ALERT_TYPES.find((t) => t.trigger === a.trigger)?.label}
                      {a.minAmount ? ` vanaf ${a.minAmount}` : ''})
                    </span>
                    <span className="block truncate text-sm text-zinc-400">{a.text || <i>geen tekst</i>}</span>
                    <span className="text-xs text-zinc-500">
                      {(a.durationMs / 1000).toFixed(0)}s{a.soundUrl ? ' · 🔊' : ''}{a.enabled ? '' : ' · uit'}
                    </span>
                  </span>
                </span>
              </Row>
            ))}
          </Group>

          {preview.skipped.length > 0 && (
            <section className="card mb-5 p-5">
              <h2 className="mb-2 font-semibold text-white">Niet over te nemen</h2>
              <ul className="space-y-1 text-sm text-zinc-400">
                {preview.skipped.map((s, i) => (
                  <li key={i}>
                    <b className="text-zinc-300">{s.what}</b>: {s.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="sticky bottom-3 z-10 flex justify-end gap-2 rounded-2xl border border-white/10 bg-ink-900/90 p-3 backdrop-blur">
            <button className="btn-ghost" onClick={() => setPreview(null)}>
              Annuleren
            </button>
            <button className="btn-primary" disabled={busy || count === 0} onClick={apply}>
              {busy ? 'Importeren…' : `${count} onderdelen importeren`}
            </button>
          </div>
        </>
      )}
    </>
  );
}

function Group({ title, keys, picked, setAll, children }: { title: string; keys: string[]; picked: Set<string>; setAll: (k: string[], on: boolean) => void; children: React.ReactNode }) {
  if (!keys.length) return null;
  const all = keys.every((k) => picked.has(k));
  return (
    <section className="card mb-5 p-5" aria-label={title}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-white">
          {title} <span className="text-sm font-normal text-zinc-500">({keys.filter((k) => picked.has(k)).length}/{keys.length})</span>
        </h2>
        <button className="text-xs font-semibold text-brand-400 hover:text-brand-300" onClick={() => setAll(keys, !all)}>
          {all ? 'Niets selecteren' : 'Alles selecteren'}
        </button>
      </div>
      <ul className="divide-y divide-white/[.06]">{children}</ul>
    </section>
  );
}

function Row({ k, picked, toggle, warnings, badge, children }: { k: string; picked: Set<string>; toggle: (k: string) => void; warnings: string[]; badge?: string | null; children: React.ReactNode }) {
  return (
    <li className="py-2.5">
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-[#a855f7]" checked={picked.has(k)} onChange={() => toggle(k)} />
        <span className="min-w-0 flex-1">
          {children}
          {badge && <span className="chip mt-1 border border-amber-400/40 bg-amber-400/10 text-amber-300">{badge}</span>}
          {warnings.map((w) => (
            <span key={w} className="mt-1 block text-xs text-amber-300/90">
              ⚠ {w}
            </span>
          ))}
        </span>
      </label>
    </li>
  );
}
