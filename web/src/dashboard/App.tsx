import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { usePoll } from './hooks';
import type { Me } from './api';
import { LanguageSwitch, Logo, StatusDot, Svg, type Icon } from './ui';
import { getLang, setLang, t, type Lang } from './i18n';
import { api } from './api';
import { Landing } from './pages/Landing';
import { Dashboard } from './pages/Dashboard';
import { Commands } from './pages/Commands';
import { CommandEditor } from './pages/CommandEditor';
import { OverlayPage } from './pages/Overlay';
import { OverlayEditor } from './pages/OverlayEditor';
import { ActivityPage } from './pages/Activity';
import { Settings } from './pages/Settings';
import { AlertsPage } from './pages/Alerts';
import { TimersPage } from './pages/Timers';
import { ImportPage } from './pages/Import';
import { DiscordPage } from './pages/Discord';

type MeCtx = { me: Me; reload: () => Promise<void> };
const Ctx = createContext<MeCtx | null>(null);
export const useMe = () => useContext(Ctx)!;

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route element={<Authed />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/commands" element={<Commands />} />
        <Route path="/commands/:id" element={<CommandEditor />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/timers" element={<TimersPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/discord" element={<DiscordPage />} />
        <Route path="/overlay" element={<OverlayPage />} />
        <Route path="/editor/:id" element={<OverlayEditor />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

const NAV: { label: string; items: { to: string; label: string; icon: keyof typeof Icon }[] }[] = [
  {
    label: 'Twitch',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: 'home' },
      { to: '/commands', label: 'Commands', icon: 'bolt' },
      { to: '/alerts', label: 'Alerts', icon: 'bell' },
      { to: '/timers', label: 'Timers', icon: 'clock' },
      { to: '/overlay', label: 'Overlay', icon: 'layers' },
      { to: '/activity', label: 'Activity', icon: 'activity' },
      { to: '/import', label: 'Import', icon: 'download' },
    ],
  },
  { label: 'Discord', items: [{ to: '/discord', label: 'Discord', icon: 'chat' }] },
  { label: 'General', items: [{ to: '/settings', label: 'Settings', icon: 'cog' }] },
];

function Authed() {
  const { data: me, error, reload } = usePoll<Me>('/api/me', 5000);
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  // The account's language wins over the browser's (so it follows you to other devices).
  useEffect(() => {
    if (me?.user.locale && me.user.locale !== getLang()) setLang(me.user.locale as Lang);
  }, [me?.user.locale]);
  const saveLang = (lang: Lang) => void api('/api/settings', { method: 'PATCH', json: { locale: lang } }).then(() => reload());

  if (error && (error as any).status === 401) return <Navigate to="/" replace />;
  if (!me)
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );

  // The overlay editor uses the whole screen, without the sidebar.
  if (loc.pathname.startsWith('/editor/'))
    return (
      <Ctx.Provider value={{ me, reload }}>
        <Outlet />
      </Ctx.Provider>
    );

  const chatTone = me.chat.status === 'connected' ? 'ok' : me.chat.status === 'connecting' ? 'warn' : me.chat.status === 'auth_failed' ? 'error' : 'off';

  const nav = (
    <nav className="flex flex-col gap-3">
      {NAV.map((group) => (
        <section key={group.label}>
          <h2 className="px-3 pb-1 text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">{t(group.label)}</h2>
          <div className="flex flex-col gap-1">
            {group.items.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                    isActive || (n.to === '/commands' && loc.pathname.startsWith('/commands'))
                      ? 'bg-gradient-to-r from-brand-500/30 to-brand-500/10 text-white shadow-[inset_0_0_0_1px_rgb(192_132_252/.55),0_0_22px_-6px_rgb(168_85_247/.8)]'
                      : 'text-zinc-400 hover:bg-white/[.04] hover:text-zinc-100'
                  }`
                }
              >
                <Svg i={n.icon} className="h-[18px] w-[18px]" />
                {t(n.label)}
              </NavLink>
            ))}
          </div>
        </section>
      ))}
    </nav>
  );

  const account = (
    <div className="card flex items-center gap-3 p-3">
      {me.user.profileImageUrl ? (
        <img src={me.user.profileImageUrl} alt="" className="h-9 w-9 rounded-full ring-2 ring-brand-500/40" />
      ) : (
        <div className="h-9 w-9 rounded-full bg-ink-600" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-white">{me.user.displayName}</div>
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          <StatusDot tone={chatTone} />
          <span className="font-semibold tracking-wider uppercase">{me.chat.status === 'connected' ? t('chat live') : me.chat.status === 'connecting' ? t('connecting') : t('offline')}</span>
        </div>
      </div>
    </div>
  );

  return (
    <Ctx.Provider value={{ me, reload }}>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-6 border-r border-white/[.06] bg-ink-950/50 p-5 backdrop-blur-xl lg:flex">
          <Logo tagline />
          {nav}
          <div className="mt-auto space-y-2">
            <a
              href="https://github.com/iitssjstn/stream-dashboard/blob/main/CHANGELOG.md"
              target="_blank"
              rel="noreferrer"
              className="block text-center text-[11px] text-zinc-500 hover:text-zinc-300"
              title={t("What's new?")}
            >
              Waviloop v{__APP_VERSION__}
            </a>
            <LanguageSwitch compact onChange={saveLang} />
            {account}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/[.06] bg-ink-900/80 px-4 py-3 backdrop-blur lg:hidden">
            <Logo />
            <button className="btn-ghost px-3" onClick={() => setOpen((o) => !o)} aria-label="Menu">
              <Svg i="menu" />
            </button>
          </header>
          {open && (
            <div className="fade-in border-b border-white/[.06] bg-ink-900/95 p-4 lg:hidden">
              {nav}
              <div className="mt-4 space-y-2">
                <LanguageSwitch compact onChange={saveLang} />
                {account}
              </div>
            </div>
          )}
          {me.user.authError && (
            <div className="mx-4 mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 sm:mx-8">
              {t(me.user.authError)}{' '}
              <a className="font-semibold underline" href="/auth/twitch/login">
                {t('Reconnect')}
              </a>
            </div>
          )}
          <main className="fade-in mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-8 sm:py-8" key={loc.pathname}>
            <Outlet />
          </main>
        </div>
      </div>
    </Ctx.Provider>
  );
}
