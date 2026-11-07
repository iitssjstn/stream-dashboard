import { Navigate, useSearchParams } from 'react-router-dom';
import { usePoll } from '../hooks';
import { LanguageSwitch, Logo, Svg } from '../ui';
import { t, Trans } from '../i18n';
import { OverlayPreview } from '../components/OverlayPreview';
import { TwitchAppForm } from '../components/TwitchAppForm';

const demo = {
  name: 'hug',
  animation: 'hug',
  imageUrl: null,
  soundUrl: null,
  soundVolume: 0,
  text: '{user} gives {target} a hug!',
  durationMs: 5000,
  showUsername: true,
  style: { fontFamily: 'Fredoka', fontSize: 46, textColor: '#ffffff', accentColor: '#ec4899', x: 50, y: 52, scale: 1.25, effect: 'pop' as const, particles: 'hearts' as const, textShadow: true },
};

export function Landing() {
  const { data, reload } = usePoll<{ twitchConfigured: boolean; setupRequired: boolean; redirectUri: string; loggedIn: boolean }>('/auth/status');
  const [params] = useSearchParams();
  const error = params.get('error');
  if (data?.loggedIn) return <Navigate to="/dashboard" replace />;
  if (data?.setupRequired)
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-5 py-10">
        <div className="flex items-center justify-between">
          <Logo />
          <LanguageSwitch compact />
        </div>
        <div className="card fade-in p-6">
          <h1 className="text-2xl font-bold text-white">{t('First-time setup')}</h1>
          <p className="mt-1 mb-5 text-sm text-zinc-400">{t('Link this installation to a Twitch app. You only need to do this once.')}</p>
          <TwitchAppForm mode="setup" redirectUri={data.redirectUri} onDone={reload} />
        </div>
      </div>
    );

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-6">
      <header className="flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-2">
          <LanguageSwitch compact />
          <a href="/auth/twitch/login" className="btn-ghost">
            {t('Log in')}
          </a>
        </div>
      </header>

      <section className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-2">
        <div className="fade-in">
          <span className="chip mb-5 border border-brand-500/30 bg-brand-500/10 text-brand-400">{t('Interactive OBS overlays for Twitch')}</span>
          <h1 className="font-display text-5xl leading-[1.02] font-semibold tracking-tight text-white sm:text-7xl">
            Make your stream <span className="bg-gradient-to-r from-brand-400 to-sky2-400 bg-clip-text text-transparent">come alive.</span>
          </h1>
          <p className="mt-5 text-xl font-semibold text-zinc-200 sm:text-2xl">
            {t('Let your chat bring your stream to life.')}
          </p>
          <p className="mt-3 max-w-lg text-lg text-zinc-400">
            <Trans
              text="Viewers type {cmd} and an anime animation instantly appears in OBS. Your own commands, GIFs, sounds, cooldowns and permissions."
              cmd={<code className="rounded bg-white/5 px-1.5 py-0.5 text-brand-400">{t('!hug')}</code>}
            />
          </p>
          {error && <div className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{t(error)}</div>}
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="/auth/twitch/login" className="btn-primary px-6 py-3 text-base">
              <Svg i="twitch" /> {t('Connect your Twitch account')}
            </a>
          </div>
          <ol className="mt-10 grid gap-3 text-sm text-zinc-400 sm:grid-cols-3">
            {[t('Connect Twitch'), t('Copy your overlay URL'), t('Add it in OBS')].map((s, i) => (
              <li key={s} className="card flex items-center gap-3 p-3">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-sky2-500 text-xs font-bold text-white">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        </div>
        <div className="card fade-in p-3">
          <div className="mb-2 flex items-center gap-2 px-1 text-xs text-zinc-500">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
            <span className="ml-2">OBS · Browser Source</span>
          </div>
          <OverlayPreview cmd={demo} width={1280} height={720} />
        </div>
      </section>
    </div>
  );
}
