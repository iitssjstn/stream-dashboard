import { useRef, useState } from 'react';
import { api, type Activity, type Upload } from '../api';
import { timeAgo, usePoll } from '../hooks';
import { Svg, useToast } from '../ui';
import { useMe } from '../App';
import { GiphyPicker, PoweredByGiphy } from './GiphyPicker';

export function CopyUrl({ url }: { url: string }) {
  const [shown, setShown] = useState(false);
  const toast = useToast();
  const masked = url.replace(/\/overlay\/(.{4}).+$/, '/overlay/$1••••••••••••••••');
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <code className="input flex-1 truncate font-mono text-[13px] text-brand-400 select-all">{shown ? url : masked}</code>
      <div className="flex gap-2">
        <button className="btn-ghost px-3" onClick={() => setShown((s) => !s)} title={shown ? 'Verbergen' : 'Tonen'}>
          <Svg i="eye" className="h-4 w-4" />
        </button>
        <button
          className="btn-primary"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            toast('Overlay-URL gekopieerd. Plak hem in OBS als Browser Source.');
          }}
        >
          <Svg i="copy" className="h-4 w-4" /> Kopieer URL
        </button>
      </div>
    </div>
  );
}

const STATUS: Record<string, { label: string; cls: string }> = {
  triggered: { label: 'afgespeeld', cls: 'border-emerald-400/50 bg-emerald-400/10 text-emerald-300' },
  test: { label: 'test', cls: 'border-cyan-400/50 bg-cyan-400/10 text-cyan-300' },
  cooldown: { label: 'cooldown', cls: 'border-amber-400/50 bg-amber-400/10 text-amber-300' },
  denied: { label: 'geweigerd', cls: 'border-rose-400/50 bg-rose-400/10 text-rose-300' },
};

const AVATAR_GRADIENTS = [
  'from-fuchsia-500 to-purple-600',
  'from-sky-400 to-indigo-600',
  'from-emerald-400 to-teal-600',
  'from-amber-400 to-rose-500',
  'from-violet-400 to-blue-600',
  'from-pink-400 to-fuchsia-600',
];

/** Deterministic initial avatar per viewer, so the same viewer always gets the same colour. */
function ViewerAvatar({ name }: { name: string }) {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <div
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br text-sm font-bold text-white uppercase ring-2 ring-white/10 ${AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]}`}
      aria-hidden="true"
    >
      {name.replace(/[^\p{L}\p{N}]/gu, '').charAt(0) || '?'}
    </div>
  );
}

export function ActivityList({ limit = 10, compact = false }: { limit?: number; compact?: boolean }) {
  const { data } = usePoll<Activity[]>(`/api/activity?limit=${limit}`, 3000);
  if (!data) return <div className="h-24 animate-pulse rounded-xl bg-white/[.03]" />;
  if (!data.length)
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">
        Nog geen activiteit. Typ <code className="text-brand-400">!knuffel</code> in je Twitch-chat om het te testen.
      </div>
    );
  return (
    <ul className="divide-y divide-white/[.06]">
      {data.map((a) => {
        const s = STATUS[a.status] ?? { label: a.status, cls: 'border-white/20 bg-white/5 text-zinc-300' };
        return (
          <li key={a.id} className={`flex items-center gap-3 ${compact ? 'py-2.5' : 'py-3'}`}>
            <ViewerAvatar name={a.viewer} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-zinc-200">
                <span className="font-semibold text-white">{a.viewer}</span> gebruikte <code className="font-semibold text-brand-400">!{a.commandName}</code>
              </div>
              <div className="text-xs text-zinc-500">
                {timeAgo(a.createdAt)}
                {a.detail && ` · ${a.detail}`}
              </div>
            </div>
            <span className={`chip border ${s.cls}`}>{s.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Upload + pick images/GIFs/sounds from the streamer's media library. */
export function MediaPicker({ kind, value, onChange }: { kind: 'image' | 'audio'; value: string | null; onChange: (url: string | null) => void }) {
  const { data, reload } = usePoll<Upload[]>('/api/uploads');
  const [busy, setBusy] = useState(false);
  const [giphyOpen, setGiphyOpen] = useState(false);
  const { me } = useMe();
  const input = useRef<HTMLInputElement>(null);
  const external = kind === 'image' && value && !value.startsWith('/uploads/') ? value : null;
  const toast = useToast();
  const items = (data ?? []).filter((u) => u.mime.startsWith(kind === 'image' ? 'image/' : 'audio/'));

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api<Upload>('/api/uploads', { method: 'POST', body: fd });
      await reload();
      onChange(res.url);
      toast('Bestand geüpload');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => input.current?.click()}>
          <Svg i="upload" className="h-4 w-4" /> {busy ? 'Uploaden…' : kind === 'image' ? 'Afbeelding / GIF uploaden' : 'Geluid uploaden'}
        </button>
        {kind === 'image' && me.giphyEnabled && (
          <button type="button" className="btn-ghost" onClick={() => setGiphyOpen(true)}>
            <Svg i="giphy" className="h-4 w-4" /> Zoek op GIPHY
          </button>
        )}
        {value && (
          <button type="button" className="btn-ghost" onClick={() => onChange(null)}>
            Verwijderen
          </button>
        )}
        <input
          ref={input}
          type="file"
          hidden
          accept={kind === 'image' ? 'image/png,image/jpeg,image/gif,image/webp' : 'audio/mpeg,audio/wav,audio/ogg'}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = '';
          }}
        />
      </div>
      {kind === 'image' && !me.giphyEnabled && me.isOwner && (
        <p className="text-xs text-zinc-500">Tip: stel onder Instellingen een GIPHY-sleutel in om GIF's te zoeken.</p>
      )}
      {giphyOpen && (
        <GiphyPicker
          onClose={() => setGiphyOpen(false)}
          onPick={(url) => {
            onChange(url);
            setGiphyOpen(false);
            toast('GIF gekozen');
          }}
        />
      )}
      {external && (
        <div className="flex items-center gap-3 rounded-xl border border-brand-500/40 bg-brand-500/5 p-2">
          <img src={external} alt="Gekozen GIF" className="checker h-16 w-16 rounded-lg object-contain" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-semibold text-white">Gekozen GIF</div>
            {external.includes('giphy.com') && <PoweredByGiphy />}
          </div>
        </div>
      )}
      {items.length > 0 && (
        <div className={kind === 'image' ? 'grid grid-cols-4 gap-2 sm:grid-cols-6' : 'flex flex-col gap-1.5'}>
          {items.map((u) =>
            kind === 'image' ? (
              <button
                type="button"
                key={u.id}
                onClick={() => onChange(u.url)}
                className={`checker aspect-square overflow-hidden rounded-lg border-2 transition ${value === u.url ? 'border-brand-500' : 'border-transparent hover:border-white/20'}`}
                title={u.originalName}
              >
                <img src={u.url} alt={u.originalName} className="h-full w-full object-contain" loading="lazy" />
              </button>
            ) : (
              <button
                type="button"
                key={u.id}
                onClick={() => onChange(u.url)}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${value === u.url ? 'border-brand-500 bg-brand-500/10' : 'border-white/10 hover:bg-white/[.04]'}`}
              >
                <span className="truncate">{u.originalName}</span>
                <span
                  className="ml-2 text-brand-400"
                  onClick={(e) => {
                    e.stopPropagation();
                    void new Audio(u.url).play();
                  }}
                >
                  <Svg i="play" className="h-4 w-4" />
                </span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
