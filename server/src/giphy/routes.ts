import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { requireUser } from '../auth/session.js';
import { giphyKey, ownerUserId, saveGiphyKey } from '../settings.js';

type GiphyImage = { url?: string; webp?: string; width?: string; height?: string };
type GiphyGif = { id: string; title: string; images: Record<string, GiphyImage> };

export type GifResult = { id: string; title: string; preview: string; url: string; width: number; height: number };

function toResult(g: GiphyGif): GifResult | null {
  const preview = g.images.fixed_width_downsampled ?? g.images.fixed_width;
  // downsized_medium stays < 5 MB: light enough for an OBS browser source.
  const full = g.images.downsized_medium ?? g.images.original;
  if (!preview?.url || !full?.url) return null;
  return {
    id: g.id,
    title: g.title,
    preview: preview.webp ?? preview.url,
    url: full.url,
    width: Number(full.width) || 0,
    height: Number(full.height) || 0,
  };
}

async function giphy(path: string, params: Record<string, string>, key: string) {
  const u = new URL(`${config.giphy.apiBase}/v1/gifs/${path}`);
  u.searchParams.set('api_key', key);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, { signal: AbortSignal.timeout(8000) });
  return res;
}

export async function giphyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  /** Search proxy: the API key never reaches the browser. Empty query returns trending GIFs. */
  app.get<{ Querystring: { q?: string; offset?: string } }>(
    '/api/giphy/search',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { key } = giphyKey();
      if (!key) return reply.code(409).send({ error: 'GIPHY is nog niet ingesteld (Instellingen → GIPHY).' });
      const q = (req.query.q ?? '').trim().slice(0, 50);
      const offset = String(Math.min(4975, Math.max(0, Number(req.query.offset) || 0)));
      const params = { limit: '24', offset, rating: 'pg-13', bundle: 'messaging_non_clips', ...(q ? { q, lang: 'nl' } : {}) };
      const res = await giphy(q ? 'search' : 'trending', params, key);
      if (res.status === 401 || res.status === 403) return reply.code(502).send({ error: 'GIPHY weigert de API-sleutel.' });
      if (res.status === 429) return reply.code(429).send({ error: 'GIPHY-limiet bereikt, probeer het straks opnieuw.' });
      if (!res.ok) return reply.code(502).send({ error: `GIPHY gaf een fout (${res.status}).` });
      const json = (await res.json()) as { data: GiphyGif[]; pagination?: { total_count: number; offset: number; count: number } };
      const results = json.data.map(toResult).filter((r): r is GifResult => r !== null);
      const p = json.pagination;
      return { results, nextOffset: p && p.offset + p.count < Math.min(p.total_count, 5000) ? p.offset + p.count : null };
    },
  );

  // ---- owner-only key management (the key itself is never returned) ----
  const ownerOnly = async (req: { user: { id: number } }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (req.user.id !== ownerUserId()) return reply.code(403).send({ error: 'Alleen de eigenaar mag dit wijzigen.' });
  };

  app.get('/api/admin/giphy', { preHandler: ownerOnly }, async () => ({ source: giphyKey().source }));

  app.put<{ Body: { apiKey?: string } }>(
    '/api/admin/giphy',
    { preHandler: ownerOnly, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (giphyKey().source === 'secret') return reply.code(409).send({ error: 'De sleutel wordt beheerd via Docker secrets.' });
      const key = (req.body?.apiKey ?? '').trim();
      if (!/^[a-zA-Z0-9]{16,64}$/.test(key)) return reply.code(400).send({ error: 'Ongeldige GIPHY API-sleutel' });
      const res = await giphy('trending', { limit: '1' }, key).catch(() => null);
      if (!res) return reply.code(502).send({ error: 'GIPHY is niet bereikbaar.' });
      if (!res.ok) return reply.code(400).send({ error: 'GIPHY accepteert deze API-sleutel niet.' });
      saveGiphyKey(key);
      req.log.info({ userId: req.user.id }, 'GIPHY key saved');
      return { ok: true };
    },
  );

  app.delete('/api/admin/giphy', { preHandler: ownerOnly }, async (_req, reply) => {
    if (giphyKey().source === 'secret') return reply.code(409).send({ error: 'De sleutel wordt beheerd via Docker secrets.' });
    saveGiphyKey(null);
    return { ok: true };
  });
}
