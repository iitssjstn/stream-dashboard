import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMe } from '../App';
import { ALERT_TYPES, api, LABELS, type Command, type OverlayProfile } from '../api';
import { usePoll } from '../hooks';
import { CopyUrl } from '../components/Shared';
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
  const { data: allCmds, reload: reloadCmds, setData } = usePoll<Command[]>('/api/commands');
  const { data: overlays, reload: reloadOverlays } = usePoll<OverlayProfile[]>('/api/overlays');
  const [activeId, setActiveId] = useState<number | null>(null);
  const activeOverlay = overlays?.find((overlay) => overlay.id === activeId) ?? overlays?.[0] ?? null;
  const cmds = allCmds?.filter((c) => c.animation !== 'none' && c.overlayId === activeOverlay?.id) ?? null;
  const [managing, setManaging] = useState(false);
  const [connectedOnly, setConnectedOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<'recent' | 'name' | 'resolution'>('recent');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [dialogMode, setDialogMode] = useState<'create' | 'rename' | null>(null);
  const [overlayName, setOverlayName] = useState('');
  const [newWidth, setNewWidth] = useState(me.overlay.width);
  const [newHeight, setNewHeight] = useState(me.overlay.height);
  const [savingOverlay, setSavingOverlay] = useState(false);
  const overlayNameInput = useRef<HTMLInputElement>(null);
  const [w, setW] = useState(me.overlay.width);
  const [h, setH] = useState(me.overlay.height);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    if (!activeOverlay) return;
    setW(activeOverlay.width);
    setH(activeOverlay.height);
    setSelected(null);
  }, [activeOverlay?.id, activeOverlay?.width, activeOverlay?.height]);

  useEffect(() => {
    if (!dialogMode) return;
    overlayNameInput.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDialogMode(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [dialogMode]);

  const saveRes = async (width: number, height: number) => {
    if (!activeOverlay) return;
    setW(width);
    setH(height);
    await api(`/api/overlays/${activeOverlay.id}`, { method: 'PATCH', json: { width, height } });
    toast(t('Resolution set to {w}×{h}. Also update the Browser Source in OBS.', { w: width, h: height }));
    void reloadOverlays();
  };

  const sel = cmds?.find((c) => c.id === selected) ?? null;
  const listedOverlays = (overlays ?? [])
    .filter((overlay) => (!connectedOnly || overlay.connectedClients > 0) && overlay.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => {
      if (sortMode === 'name') return a.name.localeCompare(b.name);
      if (sortMode === 'resolution') return b.width * b.height - a.width * a.height;
      return b.id - a.id;
    });

  const openCreateDialog = () => {
    setOverlayName(t('Overlay {n}', { n: (overlays?.length ?? 0) + 1 }));
    setNewWidth(activeOverlay?.width ?? me.overlay.width);
    setNewHeight(activeOverlay?.height ?? me.overlay.height);
    setDialogMode('create');
  };

  const submitOverlayDialog = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = overlayName.trim();
    if (!name || savingOverlay) return;
    setSavingOverlay(true);
    try {
      if (dialogMode === 'create') {
        const created = await api<OverlayProfile>('/api/overlays', {
          method: 'POST',
          json: { name, width: newWidth, height: newHeight },
        });
        await reloadOverlays();
        setActiveId(created.id);
        setManaging(true);
      } else if (dialogMode === 'rename' && activeOverlay) {
        await api(`/api/overlays/${activeOverlay.id}`, { method: 'PATCH', json: { name } });
        void reloadOverlays();
      }
      setDialogMode(null);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setSavingOverlay(false);
    }
  };

  return (
    <>
      <PageHeader
        title={managing ? activeOverlay?.name ?? t('Overlays') : t('Overlays')}
        subtitle={managing ? undefined : t('Keep your commands and alerts organized across separate overlays.')}
        actions={managing ? (
          <button className="btn-ghost" onClick={() => setManaging(false)}>
            <Svg i="back" className="h-4 w-4" /> {t('Back to overlays')}
          </button>
        ) : (
          <button className="btn-primary" onClick={openCreateDialog}>
            <Svg i="plus" className="h-4 w-4" /> {t('New overlay')}
          </button>
        )}
      />

      {!managing ? (
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
          onEdit={(id) => {
            setActiveId(id);
            setManaging(true);
          }}
          onCopy={async (overlay) => {
            await navigator.clipboard.writeText(overlay.url);
            toast(t('Overlay URL copied. Paste it into OBS as a Browser Source.'));
          }}
        />
      ) : activeOverlay ? (
      <>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card space-y-4 p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold text-white">{t('Your overlay URL')}</h2>
              {activeOverlay && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => {
                setOverlayName(activeOverlay.name);
                setDialogMode('rename');
              }}>{t('Rename')}</button>}
            </div>
            <span className="flex items-center gap-2 text-sm text-zinc-300">
              <StatusDot tone={activeOverlay?.connectedClients ? 'ok' : 'off'} />
              {activeOverlay?.connectedClients ? t('{n} browser source(s) connected', { n: activeOverlay.connectedClients }) : t('Not opened in OBS yet')}
            </span>
          </div>
          {activeOverlay && <CopyUrl url={activeOverlay.url} />}
          <p className="text-xs text-zinc-500">
            {t('This URL is secret: anyone who has it can see your overlay. Leaked? Create a new one; the old one stops working immediately. Add ?debug to the URL to show the connection status on screen.')}
          </p>
          <button
            className="btn-danger"
            onClick={async () => {
              if (!confirm(t('Create a new URL? You will need to update the Browser Source in OBS afterwards.'))) return;
              if (!activeOverlay) return;
              await api(`/api/overlays/${activeOverlay.id}/regenerate`, { method: 'POST' });
              toast(t('New overlay URL created'));
              void reloadOverlays();
            }}
          >
            <Svg i="refresh" className="h-4 w-4" /> {t('Generate new URL')}
          </button>
          {overlays && overlays.length > 1 && activeOverlay && <button
            className="btn-danger ml-2"
            onClick={async () => {
              if (!confirm(t('Delete this overlay? Its commands will move to another overlay.'))) return;
              await api(`/api/overlays/${activeOverlay.id}`, { method: 'DELETE' });
              setActiveId(null);
              setManaging(false);
              void reloadOverlays();
              void reloadCmds();
            }}
          >
            <Svg i="trash" className="h-4 w-4" /> {t('Delete overlay')}
          </button>}
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-semibold text-white">{t('Resolution')}</h2>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map(([pw, ph, l]) => (
              <button
                key={l}
                onClick={() => saveRes(pw, ph)}
                className={`cursor-pointer rounded-xl border px-3 py-2.5 text-sm transition ${w === pw && h === ph ? 'border-brand-500 bg-brand-500/10 text-white' : 'border-white/10 text-zinc-300 hover:bg-white/[.04]'}`}
              >
                <div className="font-semibold">{t(l)}</div>
                <div className="text-xs text-zinc-500">{pw}×{ph}</div>
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="label">{t('Width')}</span>
              <input className="input" type="number" value={w} onChange={(e) => setW(Number(e.target.value))} />
            </label>
            <label className="flex-1">
              <span className="label">{t('Height')}</span>
              <input className="input" type="number" value={h} onChange={(e) => setH(Number(e.target.value))} />
            </label>
            <button className="btn-ghost" onClick={() => saveRes(w, h)}>
              {t('Save')}
            </button>
          </div>
        </section>
      </div>

      <section className="card mt-6 p-5">
        <div className="mb-4">
          <h2 className="font-semibold text-white">{t('Layout')}</h2>
          <p className="text-sm text-zinc-400">{t('Pick a command or alert on the right, or click a box, and drag it into place. The selected item plays in the preview.')}</p>
        </div>
        {activeOverlay && allCmds && allCmds.some((c) => c.animation !== 'none' && c.overlayId !== activeOverlay.id) && (
          <label className="mb-4 block max-w-md">
            <span className="label">{t('Move a command or alert to this overlay')}</span>
            <select
              className="input"
              value=""
              onChange={async (event) => {
                const commandId = Number(event.target.value);
                if (!commandId) return;
                await api(`/api/commands/${commandId}/overlay`, { method: 'PATCH', json: { overlayId: activeOverlay.id } });
                void reloadCmds();
              }}
            >
              <option value="">{t('Choose a command or alert')}</option>
              {(['chat', 'alert'] as const).map((group) => {
                const items = allCmds.filter((c) => c.animation !== 'none' && c.overlayId !== activeOverlay.id && (c.trigger === 'chat') === (group === 'chat'));
                return items.length ? (
                  <optgroup key={group} label={group === 'chat' ? t('Commands') : t('Alerts')}>
                    {items.map((c) => (
                      <option key={c.id} value={c.id}>{itemLabel(c)}</option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </select>
          </label>
        )}
        {cmds && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
            <LayoutCanvas
              width={activeOverlay?.width ?? me.overlay.width}
              height={activeOverlay?.height ?? me.overlay.height}
              commands={cmds}
              selected={selected}
              hovered={hovered}
              onSelect={setSelected}
              onMove={(id, x, y) => setData((all) => all?.map((c) => (c.id === id ? { ...c, style: { ...c.style, x, y } } : c)) ?? null)}
              onDrop={async (id) => {
                const c = cmds.find((x) => x.id === id);
                if (!c) return;
                try {
                  await api(`/api/commands/${id}`, { method: 'PUT', json: c });
                } catch (e) {
                  toast((e as Error).message, 'error');
                  void reloadCmds();
                }
              }}
              preview={sel}
            />
            <ul className="flex max-h-[520px] flex-col gap-1.5 overflow-y-auto pr-1" aria-label={t('Commands and alerts in the overlay')}>
              {cmds.map((c, i) => {
                const active = c.id === selected;
                return (
                  <li key={c.id}>
                    <div
                      onMouseEnter={() => setHovered(c.id)}
                      onMouseLeave={() => setHovered(null)}
                      className={`rounded-xl border transition ${
                        active ? 'border-brand-500/60 bg-brand-500/10' : 'border-white/[.06] bg-white/[.02] hover:border-white/15 hover:bg-white/[.04]'
                      } ${c.enabled ? '' : 'opacity-50'}`}
                    >
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setSelected(active ? null : c.id)}
                        className="block w-full cursor-pointer px-3 pt-2.5 pb-2.5 text-left"
                      >
                      <div className="flex items-center gap-2.5">
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: colorFor(i) }} />
                        <span className="truncate font-mono text-sm font-semibold text-white">{itemLabel(c, true)}</span>
                        {!c.enabled && <span className="chip ml-auto bg-white/[.06] px-2 py-0.5 text-[10px] text-zinc-400">{t('off')}</span>}
                      </div>
                      <div className="mt-0.5 pl-[22px] text-xs text-zinc-500">
                        {LABELS.animation[c.animation] ?? c.animation} · x {c.style.x}% · y {c.style.y}%
                      </div>
                      </button>
                      {active && (
                        <div className="-mt-0.5 flex gap-2 px-3 pb-2.5 pl-[34px]">
                          <button
                            className="btn-ghost px-2.5 py-1.5 text-xs"
                            onClick={async () => {
                              const r = await api<{ delivered: number }>(`/api/commands/${c.id}/test`, { method: 'POST' });
                              toast(r.delivered ? t('Played in OBS') : t('No overlay open in OBS'), r.delivered ? 'ok' : 'error');
                            }}
                          >
                            <Svg i="play" className="h-3 w-3" /> {t('Test in OBS')}
                          </button>
                          <Link to={`/commands/${c.id}`} className="btn-ghost px-2.5 py-1.5 text-xs">
                            <Svg i="edit" className="h-3.5 w-3.5" /> {t('Edit')}
                          </Link>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
      </>
      ) : null}
      {dialogMode && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/80 p-0 backdrop-blur-md sm:items-center sm:p-6"
          onClick={() => setDialogMode(null)}
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
              {t(dialogMode === 'create' ? 'New overlay' : 'Rename overlay')}
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
            {dialogMode === 'create' && (
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
              <button type="button" className="btn-ghost" disabled={savingOverlay} onClick={() => setDialogMode(null)}>
                {t('Cancel')}
              </button>
              <button type="submit" className="btn-primary" disabled={savingOverlay || !overlayName.trim()}>
                {savingOverlay ? t('Saving…') : t(dialogMode === 'create' ? 'Create overlay' : 'Save')}
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

const PALETTE = ['#a855f7', '#3b82f6', '#ec4899', '#22d3ee', '#f59e0b', '#10b981', '#f43f5e', '#8b5cf6', '#84cc16', '#06b6d4'];
const colorFor = (i: number) => PALETTE[i % PALETTE.length];

function itemLabel(c: Command, withIcon = false) {
  if (c.trigger === 'chat') return `!${c.name}`;
  const type = ALERT_TYPES.find((a) => a.trigger === c.trigger);
  const name = `${type?.label ?? c.trigger}${c.minAmount ? ` ${c.minAmount}+` : ''}`;
  return withIcon ? `🔔 ${name}` : name;
}

function LayoutCanvas(props: {
  width: number;
  height: number;
  commands: Command[];
  selected: number | null;
  hovered: number | null;
  preview: Command | null;
  onSelect: (id: number) => void;
  onMove: (id: number, x: number, y: number) => void;
  onDrop: (id: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / props.width));
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [props.width]);

  const pos = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return [
      Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))),
      Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100))),
    ] as const;
  };

  return (
    <div className="relative">
      {props.preview && (
        <div className="pointer-events-none absolute inset-0 z-0">
          <OverlayPreview cmd={props.preview} width={props.width} height={props.height} />
        </div>
      )}
      <div
        ref={box}
        className={`relative z-10 w-full touch-none overflow-hidden rounded-xl border border-white/10 ${props.preview ? '' : 'checker'}`}
        style={{ aspectRatio: `${props.width} / ${props.height}` }}
        onPointerMove={(e) => {
          if (drag.current === null) return;
          const [x, y] = pos(e);
          props.onMove(drag.current, x, y);
        }}
        onPointerUp={() => {
          if (drag.current !== null) props.onDrop(drag.current);
          drag.current = null;
        }}
      >
        {props.commands
          .map((c, i) => ({ c, color: colorFor(i) }))
          // The selected element is drawn last so it is always on top and can be grabbed.
          .sort((a, b) => Number(a.c.id === props.selected) - Number(b.c.id === props.selected))
          .map(({ c, color }) => {
            const bw = (c.animation === 'image' ? 440 : 680) * c.style.scale * scale;
            const bh = (c.animation === 'image' ? 380 : 500) * c.style.scale * scale;
            const active = props.selected === c.id;
            const hot = active || props.hovered === c.id;
            const dimmed = props.selected !== null && !active && props.hovered !== c.id;
            return (
              <div
                key={c.id}
                onPointerDown={(e) => {
                  e.preventDefault();
                  (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
                  drag.current = c.id;
                  props.onSelect(c.id);
                }}
                className={`absolute flex cursor-grab items-start justify-start rounded-lg border-2 p-1 text-[11px] font-semibold transition-[opacity,background-color,border-style] active:cursor-grabbing ${
                  hot ? 'border-solid' : 'border-dashed'
                } ${dimmed ? 'opacity-30' : ''} ${c.enabled ? '' : 'opacity-40'}`}
                style={{
                  left: `${c.style.x}%`,
                  top: `${c.style.y}%`,
                  width: bw,
                  height: bh,
                  transform: 'translate(-50%, -50%)',
                  borderColor: color,
                  background: hot ? `${color}26` : `${color}0d`,
                  zIndex: active ? 20 : hot ? 10 : 1,
                }}
                title={LABELS.animation[c.animation]}
              >
                <span className={`rounded px-1.5 py-0.5 font-mono text-white shadow ${dimmed ? 'invisible' : ''}`} style={{ background: color }}>
                  {itemLabel(c, true)}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}
