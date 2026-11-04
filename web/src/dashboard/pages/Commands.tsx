import { Link, useNavigate } from 'react-router-dom';
import { api, LABELS, type Command } from '../api';
import { usePoll } from '../hooks';
import { useMe } from '../App';
import { PageHeader, Svg, Toggle, useToast } from '../ui';

export function Commands() {
  const { data, reload, setData } = usePoll<Command[]>('/api/commands');
  const { reload: reloadMe } = useMe();
  const toast = useToast();
  const nav = useNavigate();

  const save = async (c: Command, patch: Partial<Command>) => {
    const next = { ...c, ...patch };
    setData((d) => d?.map((x) => (x.id === c.id ? next : x)) ?? null);
    try {
      await api(`/api/commands/${c.id}`, { method: 'PUT', json: next });
      void reloadMe();
    } catch (e) {
      toast((e as Error).message, 'error');
      void reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Commands"
        subtitle="Chatcommands die animaties in je overlay afspelen."
        actions={
          <Link to="/commands/new" className="btn-primary">
            <Svg i="plus" className="h-4 w-4" /> Nieuw command
          </Link>
        }
      />
      {!data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="card h-44 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((c) => (
            <div key={c.id} className={`card group flex flex-col p-5 transition hover:border-brand-500/30 ${c.enabled ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <button onClick={() => nav(`/commands/${c.id}`)} className="cursor-pointer font-mono text-lg font-semibold text-white hover:text-brand-400">
                    !{c.name}
                  </button>
                  <div className="mt-0.5 text-xs text-zinc-500">{LABELS.animation[c.animation] ?? c.animation}</div>
                </div>
                <Toggle checked={c.enabled} onChange={(v) => save(c, { enabled: v })} label={`!${c.name} aan/uit`} />
              </div>
              <p className={`mt-3 line-clamp-2 flex-1 text-sm ${c.showText ? 'text-zinc-300' : 'text-zinc-500 italic'}`}>{c.showText ? c.text : 'Alleen animatie / GIF, geen tekst'}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                <span className="chip bg-white/[.05] text-zinc-300">{LABELS.permission[c.permission]}</span>
                <span className="chip bg-white/[.05] text-zinc-300">{(c.durationMs / 1000).toFixed(1)}s</span>
                <span className="chip bg-white/[.05] text-zinc-300">⏱ {c.userCooldownSec}s / {c.globalCooldownSec}s</span>
                {c.targetMode === 'required' && <span className="chip bg-white/[.05] text-zinc-300">@naam verplicht</span>}
                {c.soundUrl && <span className="chip bg-white/[.05] text-zinc-300">🔊 geluid</span>}
              </div>
              <div className="mt-4 flex gap-2 border-t border-white/[.05] pt-4">
                <button
                  className="btn-ghost flex-1 py-2"
                  onClick={async () => {
                    const r = await api<{ delivered: number }>(`/api/commands/${c.id}/test`, { method: 'POST' });
                    toast(r.delivered ? `Test verstuurd naar ${r.delivered} overlay(s)` : 'Geen overlay open in OBS — event staat 30s in de wachtrij', r.delivered ? 'ok' : 'error');
                  }}
                >
                  <Svg i="play" className="h-3.5 w-3.5" /> Test
                </button>
                <Link to={`/commands/${c.id}`} className="btn-ghost flex-1 py-2">
                  <Svg i="edit" className="h-4 w-4" /> Bewerken
                </Link>
                <button
                  className="btn-danger px-3 py-2"
                  title="Verwijderen"
                  onClick={async () => {
                    if (!confirm(`!${c.name} verwijderen?`)) return;
                    await api(`/api/commands/${c.id}`, { method: 'DELETE' });
                    toast(`!${c.name} verwijderd`);
                    void reload();
                    void reloadMe();
                  }}
                >
                  <Svg i="trash" className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          <Link to="/commands/new" className="card flex min-h-44 flex-col items-center justify-center gap-2 border-dashed text-zinc-400 transition hover:border-brand-500/40 hover:text-white">
            <Svg i="plus" className="h-6 w-6" />
            <span className="text-sm font-semibold">Command toevoegen</span>
          </Link>
        </div>
      )}
    </>
  );
}
