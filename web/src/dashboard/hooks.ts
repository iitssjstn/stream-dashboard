import { getLang, t } from './i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/** Fetches `path` and re-fetches every `intervalMs` while the tab is visible. */
export function usePoll<T>(path: string | null, intervalMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      if (alive.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(e as Error);
    }
  }, [path]);

  useEffect(() => {
    alive.current = true;
    void reload();
    if (!intervalMs) return () => void (alive.current = false);
    const id = setInterval(() => document.visibilityState === 'visible' && reload(), intervalMs);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [reload, intervalMs]);

  return { data, error, reload, setData };
}

export function timeAgo(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return t('just now');
  if (s < 60) return t('{n}s ago', { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return t('{n} min ago', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('{n} h ago', { n: h });
  return new Date(ts).toLocaleDateString(getLang() === 'nl' ? 'nl-NL' : 'en-GB', { day: 'numeric', month: 'short' });
}
