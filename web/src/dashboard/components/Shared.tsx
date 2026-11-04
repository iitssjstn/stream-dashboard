import { useRef, useState } from 'react';
import { api, type Activity, type Upload } from '../api';
import { timeAgo, usePoll } from '../hooks';
import { Svg, useToast } from '../ui';

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
  triggered: { label: 'afgespeeld', cls: 'bg-emerald-500/15 text-emerald-300' },
  test: { label: 'test', cls: 'bg-sky-500/15 text-sky-300' },
  cooldown: { label: 'cooldown', cls: 'bg-amber-500/15 text-amber-300' },
  denied: { label: 'geweigerd', cls: 'bg-rose-500/15 text-rose-300' },
};

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
    <ul className="divide-y divide-white/[.05]">
      {data.map((a) => {
        const s = STATUS[a.status] ?? { label: a.status, cls: 'bg-white/10 text-zinc-300' };
        return (
          <li key={a.id} className={`flex items-center gap-3 ${compact ? 'py-2.5' : 'py-3'}`}>
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500/25 to-sky2-500/20 text-brand-400">
              <Svg i="bolt" className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-zinc-200">
                <span className="font-semibold text-white">{a.viewer}</span> gebruikte <code className="text-brand-400">!{a.commandName}</code>
              </div>
              <div className="text-xs text-zinc-500">
                {timeAgo(a.createdAt)}
                {a.detail && ` · ${a.detail}`}
              </div>
            </div>
            <span className={`chip ${s.cls}`}>{s.label}</span>
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
  const input = useRef<HTMLInputElement>(null);
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
