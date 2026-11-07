import { Fragment, useSyncExternalStore } from 'react';
import { nl } from './locales/nl';

/**
 * Tiny i18n: English is the source language and the key; Dutch comes from locales/nl.ts.
 * Keys may contain {placeholders}; t() also translates dynamic server messages by matching
 * them against those patterns (e.g. "Cooldown per user must be between 0 and 86400").
 */
export type Lang = 'en' | 'nl';
export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'nl', label: 'Nederlands', flag: '🇳🇱' },
];

const STORAGE_KEY = 'waviloop.lang';
const dicts: Record<Lang, Record<string, string>> = { en: {}, nl };

function detect(): Lang {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s === 'en' || s === 'nl') return s;
  } catch {
    /* storage unavailable */
  }
  return 'en';
}

let current: Lang = detect();
const listeners = new Set<() => void>();
document.documentElement.lang = current;

export const getLang = () => current;

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  // Read by the server when an account is created, so its default commands are in this language.
  document.cookie = `waviloop_lang=${lang}; path=/; max-age=31536000; samesite=lax`;
  document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => current,
  );
}

type Pattern = { re: RegExp; names: string[]; target: string };
const patternCache: Partial<Record<Lang, Pattern[]>> = {};
const escape = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');

function patterns(lang: Lang): Pattern[] {
  if (patternCache[lang]) return patternCache[lang]!;
  const list: Pattern[] = [];
  for (const [key, target] of Object.entries(dicts[lang])) {
    const names: string[] = [];
    if (!/\{\w+\}/.test(key)) continue;
    const re = new RegExp(
      '^' +
        key
          .split(/(\{\w+\})/)
          .map((part) => {
            const m = /^\{(\w+)\}$/.exec(part);
            if (!m) return escape(part);
            names.push(m[1]);
            return '([\\s\\S]+?)';
          })
          .join('') +
        '$',
    );
    list.push({ re, names, target });
  }
  // Longest keys first: the most specific pattern wins.
  list.sort((a, b) => b.re.source.length - a.re.source.length);
  return (patternCache[lang] = list);
}

const fill = (s: string, params: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));

/** Translate an English text. Unknown texts are returned unchanged (English). */
export function t(text: string, params?: Record<string, string | number>): string {
  if (current === 'en' || !text) return params ? fill(text, params) : text;
  const dict = dicts[current];
  const direct = dict[text];
  if (direct !== undefined) return params ? fill(direct, params) : direct;
  if (!params) {
    // Dynamic text (e.g. from the server): match against keys with placeholders.
    for (const p of patterns(current)) {
      const m = p.re.exec(text);
      if (!m) continue;
      const values: Record<string, string> = {};
      p.names.forEach((n, i) => (values[n] = dict[m[i + 1]] ?? m[i + 1]));
      return fill(p.target, values);
    }
  }
  return params ? fill(text, params) : text;
}

/**
 * Translated sentence with React elements in it, e.g.
 * <Trans text="Type {cmd} in your chat" cmd={<code>!hug</code>} />
 * so the word order can differ per language.
 */
export function Trans({ text, ...nodes }: { text: string } & Record<string, React.ReactNode>) {
  const parts = t(text).split(/(\{\w+\})/);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\{(\w+)\}$/.exec(p);
        return m && m[1] in nodes ? <Fragment key={i}>{nodes[m[1]]}</Fragment> : <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}
