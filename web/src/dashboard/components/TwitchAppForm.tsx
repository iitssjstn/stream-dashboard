import { useState } from 'react';
import { api } from '../api';
import { Field, Svg, useToast } from '../ui';

/** Shared by the first-run setup wizard and the owner's settings page. The secret is never sent back to the browser. */
export function TwitchAppForm({ mode, redirectUri, initialClientId = '', onDone }: { mode: 'setup' | 'update'; redirectUri: string; initialClientId?: string; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [clientId, setClientId] = useState(initialClientId);
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(mode === 'setup' ? '/setup/twitch' : '/api/admin/twitch-app', {
        method: mode === 'setup' ? 'POST' : 'PUT',
        json: { code, clientId, clientSecret },
      });
      setClientSecret('');
      toast(mode === 'setup' ? 'Twitch is ingesteld!' : 'Twitch-app bijgewerkt');
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" autoComplete="off">
      <ol className="space-y-2 text-sm text-zinc-300">
        <li>
          1. Maak een app op{' '}
          <a className="font-semibold text-brand-400 underline" href="https://dev.twitch.tv/console/apps/create" target="_blank" rel="noreferrer">
            dev.twitch.tv
          </a>{' '}
          (categorie <i>Broadcasting Suite</i>) met deze OAuth Redirect URL:
        </li>
        <li className="flex gap-2">
          <code className="input flex-1 truncate font-mono text-[13px] text-brand-400 select-all">{redirectUri}</code>
          <button type="button" className="btn-ghost px-3" title="Kopieer" onClick={() => navigator.clipboard.writeText(redirectUri).then(() => toast('Gekopieerd'))}>
            <Svg i="copy" className="h-4 w-4" />
          </button>
        </li>
        <li>2. Kopieer de Client ID en maak een nieuw Client Secret aan.</li>
      </ol>
      {mode === 'setup' && (
        <Field label="Setup-code" hint="Staat in de serverlogs: docker logs stream-dashboard">
          <input className="input font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX" required spellCheck={false} />
        </Field>
      )}
      <Field label="Client ID">
        <input className="input font-mono" value={clientId} onChange={(e) => setClientId(e.target.value.trim())} required spellCheck={false} />
      </Field>
      <Field label="Client Secret" hint="Wordt versleuteld opgeslagen en nooit meer getoond.">
        <input className="input font-mono" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value.trim())} required autoComplete="new-password" />
      </Field>
      {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? 'Controleren bij Twitch…' : mode === 'setup' ? 'Opslaan en doorgaan' : 'Nieuwe gegevens opslaan'}
      </button>
    </form>
  );
}
