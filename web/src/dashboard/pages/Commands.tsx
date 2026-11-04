import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, LABELS, type Command } from '../api';
import { usePoll } from '../hooks';
import { useMe } from '../App';
import { PageHeader, Svg, Toggle, useToast } from '../ui';
import { chibi, LOOKS } from '../../overlay/characters';
import '../../overlay/overlay.css';

type View = 'grid' | 'list';
const VIEW_KEY = 'lumio.commands.view';

function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

/** Shared actions for both views. */
function useCommandActions(setData: (fn: (d: Command[] | null) => Command[] | null) => void, reload: () => Promise<void>) {
  const { reload: reloadMe } = useMe();
  const toast = useToast();
  return {
    toggle: async (c: Command, enabled: boolean) => {
      const next = { ...c, enabled };
      setData((d) => d?.map((x) => (x.id === c.id ? next : x)) ?? null);
      try {
        await api(`/api/commands/${c.id}`, { method: 'PUT', json: next });
        void reloadMe();
      } catch (e) {
        toast((e as Error).message, 'error');
        void reload();
      }
    },
    test: async (c: Command) => {
      const r = await api<{ delivered: number }>(`/api/commands/${c.id}/test`, { method: 'POST' });
      toast(r.delivered ? `Test verstuurd naar ${r.delivered} overlay(s)` : 'Geen overlay open in OBS — event staat 30s in de wachtrij', r.delivered ? 'ok' : 'error');
    },
    remove: async (c: Command) => {
      if (!confirm(`!${c.name} verwijderen?`)) return;
      await api(`/api/commands/${c.id}`, { method: 'DELETE' });
      toast(`!${c.name} verwijderd`);
      void reload();
      void reloadMe();
    },
  };
}

export function Commands() {
  const { data, reload, setData } = usePoll<Command[]>('/api/commands');
  const [view, setView] = useState<View>(loadView);
  const actions = useCommandActions(setData, reload);

  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode: just don't remember */
    }
  };

  return (
    <>
      <PageHeader
        title="Commands"
        subtitle="Chatcommands die animaties in je overlay afspelen."
        actions={
          <>
            <div className="flex rounded-xl border border-white/10 bg-ink-950/50 p-1" role="group" aria-label="Weergave">
              {(
                [
                  ['grid', 'Grid', 'grid'],
                  ['list', 'Lijst', 'list'],
                ] as const
              ).map(([k, l, icon]) => (
                <button
                  key={k}
                  aria-pressed={view === k}
                  onClick={() => choose(k)}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${view === k ? 'bg-white/[.1] text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  <Svg i={icon} className="h-4 w-4" /> {l}
                </button>
              ))}
            </div>
            <Link to="/commands/new" className="btn-primary">
              <Svg i="plus" className="h-4 w-4" /> Nieuw command
            </Link>
          </>
        }
      />
      {!data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="card h-64 animate-pulse" />)}
        </div>
      ) : view === 'grid' ? (
        <HeroGrid commands={data} actions={actions} />
      ) : (
        <CommandList commands={data} actions={actions} />
      )}
    </>
  );
}

type Actions = ReturnType<typeof useCommandActions>;

const TWO_ACTORS = new Set(['hug', 'highfive', 'dance']);

/** Static visual of a command: its GIF, or the anime characters, on its accent colour. */
function CommandHero({ c }: { c: Command }) {
  const accent = c.style.accentColor;
  const showImage = c.imageUrl && (c.animation === 'image' || !TWO_ACTORS.has(c.animation));
  return (
    <div
      className="relative flex aspect-[16/9] items-end justify-center overflow-hidden"
      style={{ background: `radial-gradient(120% 90% at 50% 110%, ${accent}66, transparent 65%), linear-gradient(160deg, ${accent}26, rgb(16 14 28))` }}
    >
      {c.animation === 'image' && c.imageUrl ? (
        <img src={c.imageUrl} alt="" loading="lazy" className="absolute inset-0 m-auto max-h-[88%] max-w-[88%] object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,.45)] transition duration-300 group-hover:scale-105" />
      ) : (
        <div className="flex h-[92%] items-end transition duration-300 group-hover:scale-105">
          <div className="h-full" style={{ aspectRatio: '200 / 300' }} dangerouslySetInnerHTML={{ __html: chibi(c.animation === 'highfive' ? LOOKS.ren : LOOKS.miko) }} />
          {TWO_ACTORS.has(c.animation) && (
            <div className="-ml-[6%] h-full" style={{ aspectRatio: '200 / 300', transform: 'scaleX(-1)' }} dangerouslySetInnerHTML={{ __html: chibi(c.animation === 'highfive' ? LOOKS.miko : LOOKS.ren) }} />
          )}
          {showImage && c.animation !== 'image' && <img src={c.imageUrl!} alt="" className="absolute top-3 right-3 h-16 w-16 rounded-lg object-cover ring-2 ring-white/20" />}
        </div>
      )}
      <span className="absolute top-3 left-3 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">{LABELS.animation[c.animation] ?? c.animation}</span>
    </div>
  );
}

function Chips({ c }: { c: Command }) {
  return (
    <>
      <span className="chip bg-white/[.06] text-zinc-300">{LABELS.permission[c.permission]}</span>
      <span className="chip bg-white/[.06] text-zinc-300">{(c.durationMs / 1000).toFixed(1)}s</span>
      <span className="chip bg-white/[.06] text-zinc-300">⏱ {c.userCooldownSec}s / {c.globalCooldownSec}s</span>
      {c.targetMode === 'required' && <span className="chip bg-white/[.06] text-zinc-300">@naam verplicht</span>}
      {c.soundUrl && <span className="chip bg-white/[.06] text-zinc-300">🔊 geluid</span>}
    </>
  );
}

const textOf = (c: Command) => (c.showText ? c.text : 'Alleen animatie / GIF, geen tekst');

function HeroGrid({ commands, actions }: { commands: Command[]; actions: Actions }) {
  const nav = useNavigate();
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {commands.map((c) => (
        <article key={c.id} className={`card group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:border-brand-500/40 ${c.enabled ? '' : 'opacity-55'}`}>
          <button className="block cursor-pointer text-left" onClick={() => nav(`/commands/${c.id}`)} aria-label={`!${c.name} bewerken`}>
            <CommandHero c={c} />
          </button>
          <div className="flex flex-1 flex-col p-5">
            <div className="flex items-center justify-between gap-3">
              <Link to={`/commands/${c.id}`} className="truncate font-mono text-lg font-semibold text-white hover:text-brand-400">
                !{c.name}
              </Link>
              <Toggle checked={c.enabled} onChange={(v) => actions.toggle(c, v)} label={`!${c.name} aan/uit`} />
            </div>
            <p className={`mt-2 line-clamp-2 flex-1 text-sm ${c.showText ? 'text-zinc-300' : 'text-zinc-500 italic'}`}>{textOf(c)}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Chips c={c} />
            </div>
            <div className="mt-4 flex gap-2 border-t border-white/[.06] pt-4">
              <button className="btn-ghost flex-1 py-2" onClick={() => actions.test(c)}>
                <Svg i="play" className="h-3.5 w-3.5" /> Test
              </button>
              <Link to={`/commands/${c.id}`} className="btn-ghost flex-1 py-2">
                <Svg i="edit" className="h-4 w-4" /> Bewerken
              </Link>
              <button className="btn-danger px-3 py-2" title="Verwijderen" aria-label={`!${c.name} verwijderen`} onClick={() => actions.remove(c)}>
                <Svg i="trash" className="h-4 w-4" />
              </button>
            </div>
          </div>
        </article>
      ))}
      <Link to="/commands/new" className="card flex min-h-64 flex-col items-center justify-center gap-2 border-dashed text-zinc-400 transition hover:border-brand-500/40 hover:text-white">
        <Svg i="plus" className="h-6 w-6" />
        <span className="text-sm font-semibold">Command toevoegen</span>
      </Link>
    </div>
  );
}

function CommandList({ commands, actions }: { commands: Command[]; actions: Actions }) {
  return (
    <div className="card overflow-hidden">
      <div className="hidden grid-cols-[52px_minmax(130px,1fr)_minmax(0,1.6fr)_250px_196px] items-center gap-4 border-b border-white/[.06] px-5 py-3 text-[11px] font-semibold tracking-wider text-zinc-500 uppercase md:grid">
        <span>Aan</span>
        <span>Command</span>
        <span>Tekst</span>
        <span>Instellingen</span>
        <span className="text-right">Acties</span>
      </div>
      <ul className="divide-y divide-white/[.06]">
        {commands.map((c) => (
          <li
            key={c.id}
            className={`grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 transition hover:bg-white/[.025] md:grid-cols-[52px_minmax(130px,1fr)_minmax(0,1.6fr)_250px_196px] ${c.enabled ? '' : 'opacity-55'}`}
          >
            <Toggle checked={c.enabled} onChange={(v) => actions.toggle(c, v)} label={`!${c.name} aan/uit`} />
            <div className="min-w-0">
              <Link to={`/commands/${c.id}`} className="block truncate font-mono font-semibold text-white hover:text-brand-400">
                <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: c.style.accentColor }} aria-hidden="true" />
                !{c.name}
              </Link>
              <div className="truncate text-xs text-zinc-500">{LABELS.animation[c.animation] ?? c.animation}</div>
            </div>
            <p className={`col-span-3 truncate text-sm md:col-span-1 ${c.showText ? 'text-zinc-300' : 'text-zinc-500 italic'}`}>{textOf(c)}</p>
            <div className="col-span-3 flex flex-wrap gap-1.5 md:col-span-1">
              <Chips c={c} />
            </div>
            <div className="col-start-3 row-start-1 flex justify-end gap-2 md:col-start-auto md:row-start-auto">
              <button className="btn-ghost px-3 py-2" title="Test in OBS" aria-label={`!${c.name} testen`} onClick={() => actions.test(c)}>
                <Svg i="play" className="h-3.5 w-3.5" />
              </button>
              <Link to={`/commands/${c.id}`} className="btn-ghost px-3 py-2">
                <Svg i="edit" className="h-4 w-4" /> <span className="hidden xl:inline">Bewerken</span>
              </Link>
              <button className="btn-danger px-3 py-2" title="Verwijderen" aria-label={`!${c.name} verwijderen`} onClick={() => actions.remove(c)}>
                <Svg i="trash" className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Link to="/commands/new" className="flex items-center justify-center gap-2 border-t border-white/[.06] px-5 py-3.5 text-sm font-semibold text-zinc-400 transition hover:bg-white/[.025] hover:text-white">
        <Svg i="plus" className="h-4 w-4" /> Command toevoegen
      </Link>
    </div>
  );
}
