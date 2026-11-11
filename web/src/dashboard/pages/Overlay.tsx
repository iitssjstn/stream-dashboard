import { useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMe } from '../App';
import { ALERT_TYPES, api, LABELS, type Command, type OverlayProfile } from '../api';
import { usePoll } from '../hooks';
import { OverlayPreview } from '../components/OverlayPreview';
import { PageHeader, StatusDot, Svg, useToast } from '../ui';
import { t } from '../i18n';

const PRESETS = [
  [1920, 1080, '1080p'],
  [1280, 720, '720p'],
  [2560, 1440, '1440p'],
  [1080, 1920, 'Vertical'],
] as const;

export function OverlayPage() {
  const { me } = useMe();
  const toast = useToast();
  const nav = useNavigate();
  const { data: allCmds } = usePoll<Command[]>('/api/commands');
  const { data: overlays } = usePoll<OverlayProfile[]>('/api/overlays');
  const [connectedOnly, setConnectedOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<'recent' | 'name' | 'resolution'>('recent');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [overlayName, setOverlayName] = useState('');
  const [newWidth, setNewWidth] = useState(me.overlay.width);
  const [newHeight, setNewHeight] = useState(me.overlay.height);
  const [savingOverlay, setSavingOverlay] = useState(false);
  const overlayNameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!dialogOpen) return;
    overlayNameInput.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDialogOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [dialogOpen]);

  const listedOverlays = (overlays ?? [])
    .filter((overlay) => (!connectedOnly || overlay.connectedClients > 0) && overlay.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => {
      if (sortMode === 'name') return a.name.localeCompare(b.name);
      if (sortMode === 'resolution') return b.width * b.height - a.width * a.height;
      return b.id - a.id;
    });

  const openCreateDialog = () => {
    setOverlayName(t('Overlay {n}', { n: (overlays?.length ?? 0) + 1 }));
    setNewWidth(overlays?.[0]?.width ?? me.overlay.width);
    setNewHeight(overlays?.[0]?.height ?? me.overlay.height);
    setDialogOpen(true);
  };

  const submitOverlayDialog = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = overlayName.trim();
    if (!name || savingOverlay) return;
    setSavingOverlay(true);
    try {
      const created = await api<OverlayProfile>('/api/overlays', { method: 'POST', json: { name, width: newWidth, height: newHeight } });
      nav(`/editor/${created.id}`);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setSavingOverlay(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t('Overlays')}
        subtitle={t('Build your stream overlays: widgets, alerts and chat commands, each in its own place.')}
        actions={
          <button className="btn-primary" onClick={openCreateDialog}>
            <Svg i="plus" className="h-4 w-4" /> {t('New overlay')}
          </button>
        }
      />

      <OverlayLibrary
        overlays={listedOverlays}
        total={overlays?.length ?? 0}
        connectedTotal={overlays?.filter((overlay) => overlay.connectedClients > 0).length ?? 0}
        commands={allCmds ?? []}
        connectedOnly={connectedOnly}
        search={search}
        sortMode={sortMode}
        viewMode={viewMode}
        onConnectedOnly={setConnectedOnly}
        onSearch={setSearch}
        onSort={setSortMode}
        onView={setViewMode}
        onCreate={openCreateDialog}
        onEdit={(id) => nav(`/editor/${id}`)}
        onCopy={async (overlay) => {
          await navigator.clipboard.writeText(overlay.url);
          toast(t('Overlay URL copied. Paste it into OBS as a Browser Source.'));
        }}
      />
      {dialogOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/80 p-0 backdrop-blur-md sm:items-center sm:p-6"
          onClick={() => setDialogOpen(false)}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="overlay-dialog-title"
            onSubmit={submitOverlayDialog}
            onClick={(event) => event.stopPropagation()}
            className="fade-in w-full max-w-lg rounded-t-2xl border border-white/10 bg-ink-850 p-5 shadow-2xl shadow-black/60 sm:rounded-2xl sm:p-6"
          >
            <h2 id="overlay-dialog-title" className="text-lg font-semibold text-white">
              {t('New overlay')}
            </h2>
            <label className="mt-5 block">
              <span className="label">{t('Overlay name')}</span>
              <input
                ref={overlayNameInput}
                className="input"
                value={overlayName}
                onChange={(event) => setOverlayName(event.target.value)}
                maxLength={40}
                required
              />
            </label>
            {(
              <fieldset className="mt-5">
                <legend className="label">{t('Resolution')}</legend>
                <div className="grid grid-cols-2 gap-2">
                  {PRESETS.map(([presetWidth, presetHeight, label]) => {
                    const selectedPreset = newWidth === presetWidth && newHeight === presetHeight;
                    return (
                      <button
                        key={label}
                        type="button"
                        aria-pressed={selectedPreset}
                        onClick={() => {
                          setNewWidth(presetWidth);
                          setNewHeight(presetHeight);
                        }}
                        className={`rounded-lg border px-3 py-2.5 text-sm transition ${selectedPreset ? 'border-brand-500 bg-brand-500/10 text-white' : 'border-white/10 text-zinc-300 hover:bg-white/[.04]'}`}
                      >
                        <span className="block font-semibold">{t(label)}</span>
                        <span className="block text-xs text-zinc-500">{presetWidth}×{presetHeight}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className="btn-ghost" disabled={savingOverlay} onClick={() => setDialogOpen(false)}>
                {t('Cancel')}
              </button>
              <button type="submit" className="btn-primary" disabled={savingOverlay || !overlayName.trim()}>
                {savingOverlay ? t('Saving…') : t('Create overlay')}
              </button>
            </div>
          </form>
        </div>,
        document.body,
      )}
    </>
  );
}

type OverlayLibraryProps = {
  overlays: OverlayProfile[];
  total: number;
  connectedTotal: number;
  commands: Command[];
  connectedOnly: boolean;
  search: string;
  sortMode: 'recent' | 'name' | 'resolution';
  viewMode: 'grid' | 'list';
  onConnectedOnly: (value: boolean) => void;
  onSearch: (value: string) => void;
  onSort: (value: 'recent' | 'name' | 'resolution') => void;
  onView: (value: 'grid' | 'list') => void;
  onCreate: () => void;
  onEdit: (id: number) => void;
  onCopy: (overlay: OverlayProfile) => void;
};

function OverlayLibrary(props: OverlayLibraryProps) {
  const [previewedId, setPreviewedId] = useState<number | null>(null);

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-2" role="group" aria-label={t('Filter overlays')}>
          <button
            type="button"
            aria-pressed={!props.connectedOnly}
            onClick={() => props.onConnectedOnly(false)}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${!props.connectedOnly ? 'border-brand-500/60 bg-brand-500/10 text-white' : 'border-white/10 text-zinc-400 hover:text-white'}`}
          >
            {t('All')} <span className="ml-1 text-zinc-500">{props.total}</span>
          </button>
          <button
            type="button"
            aria-pressed={props.connectedOnly}
            onClick={() => props.onConnectedOnly(true)}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${props.connectedOnly ? 'border-brand-500/60 bg-brand-500/10 text-white' : 'border-white/10 text-zinc-400 hover:text-white'}`}
          >
            {t('Connected')} <span className="ml-1 text-zinc-500">{props.connectedTotal}</span>
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-48 flex-1 xl:w-56 xl:flex-none">
            <span className="sr-only">{t('Search overlays')}</span>
            <input className="input py-2 pr-9" value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder={t('Search overlays')} />
            <Svg i="search" className="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-zinc-500" />
          </label>
          <label>
            <span className="sr-only">{t('Sort overlays')}</span>
            <select className="input w-auto py-2" value={props.sortMode} onChange={(event) => props.onSort(event.target.value as OverlayLibraryProps['sortMode'])}>
              <option value="recent">{t('Recently created')}</option>
              <option value="name">{t('Name')}</option>
              <option value="resolution">{t('Resolution')}</option>
            </select>
          </label>
          <div className="flex rounded-xl border border-white/10 bg-white/[.03] p-1" role="group" aria-label={t('View mode')}>
            <button type="button" title={t('Grid view')} aria-label={t('Grid view')} aria-pressed={props.viewMode === 'grid'} onClick={() => props.onView('grid')} className={`rounded-lg p-2 ${props.viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-white'}`}>
              <Svg i="grid" className="h-4 w-4" />
            </button>
            <button type="button" title={t('List view')} aria-label={t('List view')} aria-pressed={props.viewMode === 'list'} onClick={() => props.onView('list')} className={`rounded-lg p-2 ${props.viewMode === 'list' ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-white'}`}>
              <Svg i="list" className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      {props.overlays.length ? (
        <div className={props.viewMode === 'grid' ? 'grid gap-4 sm:grid-cols-2 2xl:grid-cols-3' : 'flex flex-col gap-3'}>
          {props.overlays.map((overlay) => {
            const assigned = props.commands.filter((command) => command.overlayId === overlay.id && command.animation !== 'none');
            const preview = assigned[0];
            const previewWidth = Math.min(100, (overlay.width / overlay.height / (16 / 9)) * 100);
            const previewText = preview?.showText
              ? preview.text.replace(/\{user\}/gi, 'Viewer').replace(/\{target\}/gi, 'the streamer').slice(0, 100)
              : preview ? LABELS.animation[preview.animation] ?? preview.animation : '';
            return (
              <article
                key={overlay.id}
                onMouseEnter={() => setPreviewedId(overlay.id)}
                onMouseLeave={() => setPreviewedId(null)}
                className={`card overflow-hidden p-0 transition hover:border-brand-500/30 ${props.viewMode === 'list' ? 'flex flex-col sm:flex-row' : ''}`}
              >
                <div className={`relative aspect-video overflow-hidden bg-ink-950 ${props.viewMode === 'list' ? 'sm:w-56 sm:shrink-0' : ''}`}>
                  {preview && previewedId === overlay.id ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div style={{ width: `${previewWidth}%` }}>
                        <OverlayPreview cmd={preview} width={overlay.width} height={overlay.height} />
                      </div>
                    </div>
                  ) : (
                    <div className="checker flex h-full min-h-28 items-center justify-center">
                      {preview ? (
                        <div className="max-w-[85%] rounded-lg border bg-ink-950/75 px-4 py-3 text-center shadow-xl" style={{ borderColor: `${preview.style.accentColor}80` }}>
                          <div className="text-xs font-bold" style={{ color: preview.style.accentColor }}>
                            {itemLabel(preview, true)}
                          </div>
                          <p className="mt-1 truncate text-sm font-semibold text-white">{previewText}</p>
                        </div>
                      ) : (
                        <div className="text-center text-zinc-500">
                          <Svg i="layers" className="mx-auto mb-2 h-7 w-7 text-brand-400/70" />
                          <span className="text-xs">{t('No commands or alerts yet')}</span>
                        </div>
                      )}
                    </div>
                  )}
                  <span className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-full border border-black/20 bg-ink-950/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 backdrop-blur">
                    <StatusDot tone={overlay.connectedClients ? 'ok' : 'off'} />
                    {overlay.connectedClients ? t('Connected') : t('Offline')}
                  </span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col p-4">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold text-white">{overlay.name}</h2>
                    <p className="mt-1 text-xs text-zinc-500">{overlay.width}×{overlay.height} · {t('{n} animated items', { n: assigned.length })}</p>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-2 sm:mt-auto sm:pt-5">
                    <button type="button" className="btn-ghost px-3 py-2" title={t('Copy URL')} aria-label={t('Copy URL')} onClick={() => void props.onCopy(overlay)}>
                      <Svg i="copy" className="h-4 w-4" />
                    </button>
                    <button type="button" className="btn-primary px-4 py-2" onClick={() => props.onEdit(overlay.id)}>
                      <Svg i="edit" className="h-4 w-4" /> {t('Edit')}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="card flex flex-col items-center px-6 py-14 text-center">
          <Svg i="search" className="mb-3 h-8 w-8 text-zinc-500" />
          <h2 className="font-semibold text-white">{props.total ? t('No overlays match your search') : t('No overlays yet')}</h2>
          {!props.total && <button className="btn-primary mt-4" onClick={props.onCreate}><Svg i="plus" className="h-4 w-4" /> {t('New overlay')}</button>}
        </section>
      )}
    </>
  );
}

function itemLabel(c: Command, withIcon = false) {
  if (c.trigger === 'chat') return `!${c.name}`;
  const type = ALERT_TYPES.find((a) => a.trigger === c.trigger);
  const name = `${type?.label ?? c.trigger}${c.minAmount ? ` ${c.minAmount}+` : ''}`;
  return withIcon ? `🔔 ${name}` : name;
}
