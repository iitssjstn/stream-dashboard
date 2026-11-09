import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMe } from '../App';
import { api } from '../api';
import { usePoll } from '../hooks';
import { TwitchAppForm } from '../components/TwitchAppForm';
import { DiscordSetup } from './Discord';
import { LanguageSwitch, PageHeader, Svg, Toggle, useToast } from '../ui';
import { t, Trans } from '../i18n';

export function Settings() {
  const { me, reload } = useMe();
  const toast = useToast();
  const nav = useNavigate();
  return (
    <>
      <PageHeader title={t('Settings')} />
      <div className="grid max-w-3xl gap-6">
        <div className="space-y-3">
          <h2 className="px-1 text-xs font-bold tracking-wider text-zinc-500 uppercase">{t('General')}</h2>
          <section className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold text-white">{t('Language')}</h3>
              <p className="text-sm text-zinc-400">{t('The language of the dashboard. New default commands and alerts are also created in this language.')}</p>
            </div>
            <div className="w-full sm:w-64">
              <LanguageSwitch onChange={(lang) => void api('/api/settings', { method: 'PATCH', json: { locale: lang } }).then(() => reload())} />
            </div>
          </section>
          <section className="card p-5">
            <button
              className="btn-ghost"
              onClick={async () => {
                await api('/auth/logout', { method: 'POST' });
                nav('/');
              }}
            >
              {t('Log out')}
            </button>
          </section>
        </div>

        <div className="space-y-3">
          <h2 className="px-1 text-xs font-bold tracking-wider text-zinc-500 uppercase">{t('Twitch')}</h2>
          <section className="card p-5">
            <h3 className="mb-4 font-semibold text-white">{t('Twitch account')}</h3>
            <div className="flex items-center gap-4">
              {me.user.profileImageUrl && <img src={me.user.profileImageUrl} alt="" className="h-14 w-14 rounded-full ring-2 ring-brand-500/40" />}
              <div className="flex-1">
                <div className="font-semibold text-white">{me.user.displayName}</div>
                <div className="text-sm text-zinc-400">twitch.tv/{me.user.login}</div>
                <div className="mt-1 text-xs text-zinc-500">{t('Permissions')}: {me.user.scopes.join(', ') || '–'}</div>
              </div>
              <a href="/auth/twitch/login" className="btn-ghost">
                <Svg i="twitch" className="h-4 w-4" /> {t('Reconnect')}
              </a>
            </div>
          </section>

          <section className="card flex items-center justify-between gap-4 p-5">
            <div>
              <h3 className="font-semibold text-white">{t('Listen to chat')}</h3>
              <p className="text-sm text-zinc-400">{t('Turn off to pause all commands. The server listens 24/7, even when this dashboard is closed.')}</p>
            </div>
            <Toggle
              checked={me.chat.enabled}
              onChange={async (v) => {
                await api('/api/settings', { method: 'PATCH', json: { chatEnabled: v } });
                toast(v ? t('Commands are on') : t('Commands paused'));
                void reload();
              }}
            />
          </section>

          {me.isOwner && <TwitchAppSettings />}
          {me.isOwner && <GiphySettings onChange={reload} />}

          <section className="card p-5">
            <button
              className="btn-danger"
              onClick={async () => {
                if (!confirm(t('Fully disconnect Twitch? Commands stop working until you reconnect.'))) return;
                await api('/auth/disconnect', { method: 'POST' });
                nav('/');
              }}
            >
              {t('Disconnect Twitch')}
            </button>
          </section>
        </div>

        {me.isOwner && (
          <div className="space-y-3">
            <h2 className="px-1 text-xs font-bold tracking-wider text-zinc-500 uppercase">{t('Discord')}</h2>
            <p className="px-1 text-sm text-zinc-400">{t('Discord has its own bot and connection, separate from Twitch.')}</p>
            <DiscordSetup onDone={reload} />
          </div>
        )}
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
      <h2 className="font-semibold text-white">{t('Twitch app (owner)')}</h2>
      <p className="mt-1 mb-4 text-sm text-zinc-400">
        Client ID <code className="text-brand-400">{data.clientId}</code> · secret {data.secretSet ? t('stored encrypted') : t('missing')}. {t('Leaked? Create a new secret in the Twitch console and enter it here.')}
      </p>
      {data.source === 'secret' ? (
        <p className="text-sm text-zinc-400">{t('These credentials come from Docker secrets and are managed there.')}</p>
      ) : (
        <TwitchAppForm mode="update" redirectUri={status.redirectUri} initialClientId={data.clientId} onDone={reload} />
      )}
    </section>
  );
}

function GiphySettings({ onChange }: { onChange: () => void }) {
  const { data, reload } = usePoll<{ source: 'secret' | 'setup' | 'none' }>('/api/admin/giphy');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (!data) return null;
  const done = () => {
    setKey('');
    void reload();
    onChange();
  };
  return (
    <section className="card p-5">
      <h2 className="font-semibold text-white">{t('GIPHY (owner)')}</h2>
      <p className="mt-1 mb-4 text-sm text-zinc-400">
        <Trans
          text="Lets you search GIFs in the command editor. Create a free API key on {site} (choose {api}). The key is stored encrypted and never shown."
          site={
            <a className="font-semibold text-brand-400 underline" href="https://developers.giphy.com/dashboard/" target="_blank" rel="noreferrer">
              developers.giphy.com
            </a>
          }
          api={<i>API</i>}
        />
      </p>
      {data.source === 'secret' ? (
        <p className="text-sm text-zinc-400">{t('The key comes from Docker secrets and is managed there.')}</p>
      ) : (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api('/api/admin/giphy', { method: 'PUT', json: { apiKey: key } });
              toast(t('GIPHY set up'));
              done();
            } catch (err) {
              toast((err as Error).message, 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            className="input font-mono"
            type="password"
            autoComplete="off"
            aria-label={t('GIPHY API key')}
            placeholder={data.source === 'setup' ? t('•••••••• (set, fill in to replace)') : t('GIPHY API key')}
            value={key}
            onChange={(e) => setKey(e.target.value.trim())}
            required
          />
          <button className="btn-primary" disabled={busy}>
            {busy ? t('Checking…') : t('Save')}
          </button>
          {data.source === 'setup' && (
            <button
              type="button"
              className="btn-danger"
              onClick={async () => {
                if (!confirm(t('Turn off GIPHY? GIFs you already picked keep working.'))) return;
                await api('/api/admin/giphy', { method: 'DELETE' });
                toast(t('GIPHY turned off'));
                done();
              }}
            >
              {t('Remove')}
            </button>
          )}
        </form>
      )}
    </section>
  );
}
