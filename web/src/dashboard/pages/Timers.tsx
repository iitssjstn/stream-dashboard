import { useState } from 'react';
import { api, type Timer } from '../api';
import { usePoll } from '../hooks';
import { Field, PageHeader, Svg, Toggle, useToast } from '../ui';

type Draft = Omit<Timer, 'id'> & { id?: number };
const empty: Draft = { name: '', enabled: true, messages: [''], intervalMin: 15, offlineIntervalMin: 0, minChatLines: 5 };

export function TimersPage() {
  const { data, reload } = usePoll<Timer[]>('/api/timers');
  const [edit, setEdit] = useState<Draft | null>(null);
  const toast = useToast();

  const save = async () => {
    if (!edit) return;
    try {
      const body = { ...edit, messages: edit.messages.filter((m) => m.trim()) };
      await api(edit.id ? `/api/timers/${edit.id}` : '/api/timers', { method: edit.id ? 'PUT' : 'POST', json: body });
      toast(`Timer “${edit.name}” opgeslagen`);
      setEdit(null);
      void reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <>
      <PageHeader
        title="Timers"
        subtitle="Berichten die automatisch in je chat verschijnen, bijvoorbeeld je socials of een reminder."
        actions={
          <button className="btn-primary" onClick={() => setEdit({ ...empty, messages: [''] })}>
            <Svg i="plus" className="h-4 w-4" /> Nieuwe timer
          </button>
        }
      />

      {edit && (
        <section className="card mb-6 space-y-4 border-brand-500/40 p-5" aria-label="Timer bewerken">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <Field label="Naam">
              <input className="input" value={edit.name} maxLength={60} placeholder="Socials" onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <div className="flex items-end gap-3 pb-2">
              <span className="text-sm text-zinc-300">Ingeschakeld</span>
              <Toggle checked={edit.enabled} onChange={(v) => setEdit({ ...edit, enabled: v })} />
            </div>
          </div>
          <div>
            <span className="label">Berichten (worden om de beurt verstuurd)</span>
            <div className="space-y-2">
              {edit.messages.map((m, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className="input"
                    value={m}
                    maxLength={480}
                    aria-label={`Bericht ${i + 1}`}
                    placeholder="Volg me ook op Instagram: @jouwnaam"
                    onChange={(e) => setEdit({ ...edit, messages: edit.messages.map((x, j) => (j === i ? e.target.value : x)) })}
                  />
                  {edit.messages.length > 1 && (
                    <button className="btn-ghost px-3" aria-label="Bericht verwijderen" onClick={() => setEdit({ ...edit, messages: edit.messages.filter((_, j) => j !== i) })}>
                      <Svg i="trash" className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              {edit.messages.length < 20 && (
                <button className="btn-ghost py-2 text-xs" onClick={() => setEdit({ ...edit, messages: [...edit.messages, ''] })}>
                  <Svg i="plus" className="h-3.5 w-3.5" /> Bericht toevoegen
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-zinc-500">Variabelen: {'{channel}'}, {'{random:1-100}'}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Elke … minuten (live)">
              <input type="number" className="input" min={1} max={1440} value={edit.intervalMin} onChange={(e) => setEdit({ ...edit, intervalMin: Number(e.target.value) })} />
            </Field>
            <Field label="Elke … minuten (offline)" hint="0 = niet als je offline bent">
              <input type="number" className="input" min={0} max={1440} value={edit.offlineIntervalMin} onChange={(e) => setEdit({ ...edit, offlineIntervalMin: Number(e.target.value) })} />
            </Field>
            <Field label="Minimaal aantal chatberichten" hint="Zo spamt hij niet in een stille chat">
              <input type="number" className="input" min={0} max={1000} value={edit.minChatLines} onChange={(e) => setEdit({ ...edit, minChatLines: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setEdit(null)}>
              Annuleren
            </button>
            <button className="btn-primary" onClick={save}>
              Timer opslaan
            </button>
          </div>
        </section>
      )}

      {!data ? (
        <div className="card h-40 animate-pulse" />
      ) : data.length === 0 && !edit ? (
        <div className="card p-10 text-center text-sm text-zinc-500">Nog geen timers. Maak er een aan, of importeer ze uit StreamElements.</div>
      ) : (
        <ul className="space-y-3">
          {data.map((t) => (
            <li key={t.id} className={`card flex flex-col gap-3 p-4 sm:flex-row sm:items-center ${t.enabled ? '' : 'opacity-55'}`}>
              <Toggle
                checked={t.enabled}
                label={`${t.name} aan/uit`}
                onChange={async (v) => {
                  await api(`/api/timers/${t.id}`, { method: 'PUT', json: { ...t, enabled: v } });
                  void reload();
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-white">{t.name}</div>
                <div className="truncate text-sm text-zinc-400">{t.messages[0]}{t.messages.length > 1 ? ` (+${t.messages.length - 1})` : ''}</div>
                <div className="mt-1 text-xs text-zinc-500">
                  elke {t.intervalMin} min live · {t.offlineIntervalMin ? `elke ${t.offlineIntervalMin} min offline` : 'niet offline'} · min. {t.minChatLines} chatberichten
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  className="btn-ghost px-3 py-2"
                  title="Nu versturen"
                  aria-label={`${t.name} nu versturen`}
                  onClick={async () => {
                    await api(`/api/timers/${t.id}/test`, { method: 'POST' });
                    toast('Bericht verstuurd in je chat');
                  }}
                >
                  <Svg i="play" className="h-3.5 w-3.5" />
                </button>
                <button className="btn-ghost px-3 py-2" aria-label={`${t.name} bewerken`} onClick={() => setEdit({ ...t })}>
                  <Svg i="edit" className="h-4 w-4" />
                </button>
                <button
                  className="btn-danger px-3 py-2"
                  aria-label={`${t.name} verwijderen`}
                  onClick={async () => {
                    if (!confirm(`Timer “${t.name}” verwijderen?`)) return;
                    await api(`/api/timers/${t.id}`, { method: 'DELETE' });
                    void reload();
                  }}
                >
                  <Svg i="trash" className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
