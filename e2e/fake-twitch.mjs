// TEST-ONLY stand-in for id.twitch.tv, api.twitch.tv and irc-ws.chat.twitch.tv.
// Speaks the same OAuth / Helix / IRC-over-WebSocket protocol so the real application
// code path can be exercised end-to-end where the real Twitch is unreachable (CI, sandbox).
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../server/package.json', import.meta.url));
const { WebSocketServer } = require('ws');

export function startFakeTwitch(port) {
  const accounts = {
    streamer1: { id: '1001', login: 'knuffelstreamer', display_name: 'KnuffelStreamer' },
    streamer2: { id: '1002', login: 'anderestreamer', display_name: 'AndereStreamer' },
  };
  const state = { nextAccount: 'streamer1', tokens: new Map(), sockets: new Map(), log: [] };
  let n = 0;
  const issue = (acct) => {
    const access = `at_${acct}_${++n}`;
    state.tokens.set(access, acct);
    state.tokens.set(`rt_${acct}`, acct);
    return { access_token: access, refresh_token: `rt_${acct}`, expires_in: 14400, scope: ['chat:read', 'chat:edit', 'user:read:email'], token_type: 'bearer' };
  };
  const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(new URLSearchParams(b))); });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    state.log.push(`${req.method} ${url.pathname}`);
    if (url.pathname === '/oauth2/authorize') {
      // Real Twitch shows a consent screen; we approve immediately for the selected test account.
      const code = `code_${state.nextAccount}`;
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state'));
      res.writeHead(302, { location: back.toString() }).end();
    } else if (url.pathname === '/oauth2/token' && req.method === 'POST') {
      const p = await body(req);
      if (!p.get('client_id') || !p.get('client_secret')) return res.writeHead(400).end('{"message":"missing client"}');
      let acct;
      if (p.get('grant_type') === 'authorization_code') acct = p.get('code')?.replace('code_', '');
      else if (p.get('grant_type') === 'refresh_token') acct = state.tokens.get(p.get('refresh_token'));
      if (!accounts[acct]) return res.writeHead(400).end('{"message":"Invalid authorization code"}');
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(issue(acct)));
    } else if (url.pathname === '/helix/users') {
      const acct = state.tokens.get((req.headers.authorization ?? '').replace('Bearer ', ''));
      if (!acct) return res.writeHead(401).end();
      const a = accounts[acct];
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ ...a, profile_image_url: '' }] }));
    } else if (url.pathname === '/oauth2/revoke') {
      res.writeHead(200).end();
    } else res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server, path: '/irc' });
  wss.on('connection', (ws) => {
    let acct = null;
    ws.on('message', (raw) => {
      for (const line of raw.toString().split('\r\n').filter(Boolean)) {
        state.log.push(`IRC< ${line.startsWith('PASS') ? 'PASS ***' : line}`);
        if (line.startsWith('PASS oauth:')) acct = state.tokens.get(line.slice(11));
        else if (line.startsWith('NICK ')) {
          if (!acct) { ws.send(':tmi.twitch.tv NOTICE * :Login authentication failed\r\n'); continue; }
          ws.send(`:tmi.twitch.tv 001 ${accounts[acct].login} :Welcome, GLHF!\r\n`);
        } else if (line.startsWith('JOIN #')) {
          const ch = line.slice(6);
          if (ch !== accounts[acct].login) continue;
          state.sockets.set(ch, ws);
          ws.send(`:${ch}!${ch}@${ch}.tmi.twitch.tv JOIN #${ch}\r\n`);
        }
      }
    });
    ws.on('close', () => { for (const [k, v] of state.sockets) if (v === ws) state.sockets.delete(k); });
  });

  /** Inject a chat message exactly as Twitch would deliver it. */
  const chat = (channel, { login, display, text, id, badges = '', userId }) => {
    const ws = state.sockets.get(channel);
    if (!ws) throw new Error(`nobody joined #${channel}`);
    const tags = `@badge-info=;badges=${badges};color=#8A2BE2;display-name=${display};emotes=;first-msg=0;flags=;id=${id};mod=${badges.includes('moderator') ? 1 : 0};room-id=1001;subscriber=0;tmi-sent-ts=${Date.now()};turbo=0;user-id=${userId};user-type=`;
    ws.send(`${tags} :${login}!${login}@${login}.tmi.twitch.tv PRIVMSG #${channel} :${text}\r\n`);
  };

  return new Promise((resolve) => server.listen(port, () => resolve({ state, chat, close: () => { wss.close(); server.close(); } })));
}
