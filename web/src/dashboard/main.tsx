import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ToastProvider } from './ui';
import { useLang } from './i18n';
import './index.css';

/** Re-renders the whole app when the language changes. */
function Root() {
  const lang = useLang();
  return (
    <ToastProvider>
      <App key={lang} />
    </ToastProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </StrictMode>,
);
