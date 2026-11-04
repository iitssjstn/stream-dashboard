import { useNavigate } from 'react-router-dom';
import { useMe } from '../App';
import { api } from '../api';
import { usePoll } from '../hooks';
import { TwitchAppForm } from '../components/TwitchAppForm';
import { PageHeader, Svg, Toggle, useToast } from '../ui';

export function Settings() {
  const { me, reload } = useMe();
  const toast = useToast();
  const nav = useNavigate();
  return (
    <>
      <PageHeader title="Instellingen" />
      <div className="grid max-w-3xl gap-6">
        <section className="card p-5">
          <h2 className="mb-4 font-semibold text-white">Twitch-account</h2>
          <div className="flex items-center gap-4">
            {me.user.profileImageUrl && <img src={me.user.profileImageUrl} alt="" className="h-14 w-14 rounded-full ring-2 ring-brand-500/40" />}
            <div className="flex-1">
              <div className="font-semibold text-white">{me.user.displayName}</div>
              <div className="text-sm text-zinc-400">twitch.tv/{me.user.login}</div>
              <div className="mt-1 text-xs text-zinc-500">Rechten: {me.user.scopes.join(', ') || '–'}</div>
            </div>
            <a href="/auth/twitch/login" className="btn-ghost">
              <Svg i="twitch" className="h-4 w-4" /> Opnieuw koppelen
            </a>
          </div>
        </section>

        <section className="card flex items-center justify-between gap-4 p-5">
          <div>
            <h2 className="font-semibold text-white">Chat beluisteren</h2>
            <p className="text-sm text-zinc-400">Zet uit om alle commands tijdelijk te pauzeren. De server luistert 24/7, ook als dit dashboard dicht is.</p>
          </div>
          <Toggle
            checked={me.chat.enabled}
            onChange={async (v) => {
              await api('/api/settings', { method: 'PATCH', json: { chatEnabled: v } });
              toast(v ? 'Commands staan aan' : 'Commands gepauzeerd');
              void reload();
            }}
          />
        </section>

        {me.isOwner && <TwitchAppSettings />}

        <section className="card flex flex-wrap gap-3 p-5">
          <button
            className="btn-ghost"
            onClick={async () => {
              await api('/auth/logout', { method: 'POST' });
              nav('/');
            }}
          >
            Uitloggen
          </button>
          <button
            className="btn-danger"
            onClick={async () => {
              if (!confirm('Twitch volledig ontkoppelen? Commands werken dan niet meer tot je opnieuw koppelt.')) return;
              await api('/auth/disconnect', { method: 'POST' });
              nav('/');
            }}
          >
            Twitch ontkoppelen
          </button>
        </section>
      </div>
    </>
  );
}

function TwitchAppSettings() {
  const { data, reload } = usePoll<{ source: 'secret' | 'setup' | 'none'; clientId: string; secretSet: boolean }>('/api/admin/twitch-app');
  const { data: status } = usePoll<{ redirectUri: string }>('/auth/status');
  if (!data || !status) return null;
  return (
    <section className="card p-5">
      <h2 className="font-semibold text-white">Twitch-app (eigenaar)</h2>
      <p className="mt-1 mb-4 text-sm text-zinc-400">
        Client ID <code className="text-brand-400">{data.clientId}</code> · secret {data.secretSet ? 'versleuteld opgeslagen' : 'ontbreekt'}. Gelekt? Maak in de Twitch-console een nieuw secret aan en vul het hier in.
      </p>
      {data.source === 'secret' ? (
        <p className="text-sm text-zinc-400">Deze gegevens komen uit Docker secrets en worden daar beheerd.</p>
      ) : (
        <TwitchAppForm mode="update" redirectUri={status.redirectUri} initialClientId={data.clientId} onDone={reload} />
      )}
    </section>
  );
}
