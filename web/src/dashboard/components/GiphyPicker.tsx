import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Svg } from '../ui';

type Gif = { id: string; title: string; preview: string; url: string; width: number; height: number };
type Page = { results: Gif[]; nextOffset: number | null };

/** Search dialog backed by the server-side GIPHY proxy. Shows trending GIFs until the user types. */
export function GiphyPicker({ onPick, onClose }: { onPick: (url: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const load = async (query: string, offset: number) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const page = await api<Page>(`/api/giphy/search?q=${encodeURIComponent(query)}&offset=${offset}`);
      if (id !== reqId.current) return;
      setGifs((cur) => (offset ? [...cur, ...page.results.filter((g) => !cur.some((c) => c.id === g.id))] : page.results));
      setNext(page.nextOffset);
    } catch (e) {
      if (id === reqId.current) setError((e as Error).message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  };

  // Debounced search as you type.
  useEffect(() => {
    const t = setTimeout(() => void load(q.trim(), 0), q ? 350 : 0);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    input.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-label="GIF zoeken op GIPHY"
        className="card fade-in flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-b-none sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-white/[.06] p-4">
          <input
            ref={input}
            className="input"
            placeholder="Zoek een GIF, bijv. hug, high five, dance…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={50}
          />
          <button className="btn-ghost px-3" onClick={onClose} aria-label="Sluiten">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {error && <div className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
          {!q && !error && <div className="mb-3 text-xs font-semibold tracking-wider text-zinc-500 uppercase">Trending</div>}
          <div className="columns-2 gap-2 sm:columns-3 md:columns-4">
            {gifs.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => onPick(g.url)}
                className="checker mb-2 block w-full cursor-pointer overflow-hidden rounded-lg border-2 border-transparent transition hover:border-brand-500 focus-visible:border-brand-500 focus-visible:outline-none"
                title={g.title}
              >
                <img src={g.preview} alt={g.title} loading="lazy" className="block w-full" style={g.width && g.height ? { aspectRatio: `${g.width} / ${g.height}` } : undefined} />
              </button>
            ))}
          </div>
          {!loading && !error && gifs.length === 0 && <div className="py-10 text-center text-sm text-zinc-500">Niets gevonden voor “{q}”.</div>}
          {loading && <div className="py-6 text-center text-sm text-zinc-500">Laden…</div>}
          {!loading && next !== null && gifs.length > 0 && (
            <div className="pt-2 text-center">
              <button className="btn-ghost" onClick={() => void load(q.trim(), next)}>
                Meer laden
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end border-t border-white/[.06] px-4 py-2.5">
          <PoweredByGiphy />
        </div>
      </div>
    </div>
  );
}

/** GIPHY requires visible attribution wherever its content is shown. */
export function PoweredByGiphy() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-zinc-400">
      <Svg i="giphy" className="h-3.5 w-3.5" /> Powered by GIPHY
    </span>
  );
}
