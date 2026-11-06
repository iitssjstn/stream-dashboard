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
  const state = { nextAccount: 'streamer1', tokens: new Map(), sockets: new Map(), log: [], sent: [], subs: [], eventsub: new Set(), discordPosts: [], discordGw: new Set(), discordLeft: [] };
  let n = 0;
  const issue = (acct) => {
    const access = `at_${acct}_${++n}`;
    state.tokens.set(access, acct);
    state.tokens.set(`rt_${acct}`, acct);
    return { access_token: access, refresh_token: `rt_${acct}`, expires_in: 14400, scope: ['chat:read', 'chat:edit', 'user:read:email', 'moderator:read:followers', 'channel:read:subscriptions', 'bits:read'], token_type: 'bearer' };
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
      if (p.get('client_id') !== 'testclient123' || p.get('client_secret') !== 'testsecret456') return res.writeHead(403).end('{"message":"invalid client secret"}');
      if (p.get('grant_type') === 'client_credentials') {
        return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'app_token', expires_in: 5000000, token_type: 'bearer' }));
      }
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
    } else if (url.pathname === '/v1/gifs/search' || url.pathname === '/v1/gifs/trending') {
      // TEST-ONLY stand-in for api.giphy.com
      if (url.searchParams.get('api_key') !== 'giphytestkey1234567890') return res.writeHead(401).end('{"message":"Unauthorized"}');
      const q = url.searchParams.get('q') ?? 'trending';
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const data = Array.from({ length: Number(url.searchParams.get('limit') ?? 24) }, (_, i) => ({
        id: `${q}-${offset + i}`,
        title: `${q} gif ${offset + i}`,
        images: {
          fixed_width_downsampled: { url: `http://localhost:${port}/gif.gif`, width: '200', height: '150' },
          downsized_medium: { url: `https://media.giphy.com/media/${q}-${offset + i}/giphy.gif`, width: '480', height: '360' },
        },
      }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data, pagination: { total_count: 100, count: data.length, offset } }));
    } else if (url.pathname === '/gif.gif') {
      res.writeHead(200, { 'content-type': 'image/gif' }).end(Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64'));
    } else if (url.pathname === '/helix/streams') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ type: 'live' }] }));
    } else if (url.pathname === '/helix/eventsub/subscriptions' && req.method === 'POST') {
      let b = '';
      for await (const c of req) b += c;
      state.subs.push(JSON.parse(b));
      res.writeHead(202, { 'content-type': 'application/json' }).end('{"data":[]}');
    } else if (url.pathname === '/discord/oauth2/authorize') {
      // TEST-ONLY stand-in for Discord's "add bot to server" consent screen
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('code', 'discord-code');
      back.searchParams.set('state', url.searchParams.get('state'));
      back.searchParams.set('guild_id', '999000111222333444');
      back.searchParams.set('permissions', url.searchParams.get('permissions'));
      res.writeHead(302, { location: back.toString() }).end();
    } else if (url.pathname.startsWith('/discord/api/')) {
      // TEST-ONLY stand-in for discord.com/api/v10
      const p = url.pathname.slice('/discord/api'.length);
      const auth = req.headers.authorization ?? '';
      const json = (code, body) => res.writeHead(code, { 'content-type': 'application/json' }).end(body === undefined ? '' : JSON.stringify(body));
      if (p === '/oauth2/token' && req.method === 'POST') {
        const b = await body(req);
        if (b.get('code') !== 'discord-code' || b.get('client_secret') !== 'discordsecret1234567890') return json(400, { error: 'invalid_grant' });
        return json(200, { access_token: 'x', token_type: 'Bearer', guild: { id: '999000111222333444', name: 'Knuffel Discord', icon: null } });
      }
      if (auth !== `Bot ${'d'.repeat(30)}.discord.${'t'.repeat(30)}`) return json(401, { message: '401: Unauthorized' });
      if (p === '/users/@me') return json(200, { id: '123456789012345678', username: 'LumioBot', global_name: 'LumioBot', avatar: null, bot: true });
      if (p === '/guilds/999000111222333444/channels') return json(200, [{ id: '111', name: 'welkom', type: 0, position: 1 }, { id: '113', name: 'algemeen', type: 0, position: 0 }, { id: '112', name: 'Voice', type: 2, position: 2 }]);
      if (p === '/users/@me/guilds/999000111222333444' && req.method === 'DELETE') return state.discordLeft.push('999000111222333444'), json(204);
      const m = /^\/channels\/(\d+)\/messages$/.exec(p);
      if (m && req.method === 'POST') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const raw = Buffer.concat(chunks);
        const boundary = /boundary=(.+)$/.exec(req.headers['content-type'])[1];
        const parts = raw.toString('latin1').split(`--${boundary}`);
        const payloadPart = parts.find((x) => x.includes('name="payload_json"'));
        const filePart = parts.find((x) => x.includes('name="files[0]"'));
        const payload = JSON.parse(Buffer.from(payloadPart.slice(payloadPart.indexOf('\r\n\r\n') + 4).trim(), 'latin1').toString('utf8'));
        const file = Buffer.from(filePart.slice(filePart.indexOf('\r\n\r\n') + 4, -2), 'latin1');
        state.discordPosts.push({ channel: m[1], payload, file });
        return json(200, { id: String(Date.now()) });
      }
      return json(404, { message: 'Unknown' });
    } else if (url.pathname.startsWith('/se/')) {
      // TEST-ONLY stand-in for api.streamelements.com/kappa/v2, shaped like their published API spec
      if (req.headers.authorization !== 'Bearer aaa.bbb.ccc') return res.writeHead(401).end('{"message":"Unauthorized"}');
      const CH = '5b2e2007760aeb7729487dab';
      const routes = {
        '/se/channels/me': { _id: CH, username: 'knuffelstreamer', displayName: 'KnuffelStreamer' },
        [`/se/bot/commands/${CH}`]: [
          { cooldown: { user: 15, global: 5 }, aliases: ['links', 'dc'], keywords: [], enabled: true, enabledOnline: true, enabledOffline: true, hidden: false, cost: 0, type: 'say', accessLevel: 100, _id: 'c1', reply: 'Socials van ${channel}: discord.gg/test (aangeroepen door ${user})', command: 'socials' },
          { cooldown: { user: 0, global: 10 }, aliases: [], keywords: [], enabled: true, type: 'say', accessLevel: 500, _id: 'c2', reply: '${user} geeft ${touser} ${random.1-10} koekjes! Live sinds ${uptime}', command: 'koekje' },
          { cooldown: { user: 0, global: 0 }, aliases: [], keywords: [], enabled: true, type: 'say', accessLevel: 100, _id: 'c3', reply: 'dit heeft een rare naam', command: 'raar commando!' },
        ],
        [`/se/bot/timers/${CH}`]: [
          { online: { enabled: true, interval: 20 }, offline: { enabled: false, interval: 30 }, enabled: true, chatLines: 5, _id: 't1', name: 'Socials timer', message: 'Volg me op Insta: @knuffel' },
        ],
        [`/se/overlays/${CH}`]: { total: 1, docs: [{ _id: 'o1', name: 'Alerts' }] },
        [`/se/overlays/${CH}/o1`]: {
          _id: 'o1',
          widgets: [
            { type: 'se-widget-custom-event-list' },
            {
              type: 'se-widget-alert-box',
              variables: {
                follower: { enabled: true, duration: 8, text: { css: { 'font-family': 'Roboto', 'font-size': 42, color: '#ffffff', highlights: { color: '#3F51B5' } }, message: '{name} volgt nu!' }, graphics: { src: 'https://cdn.streamelements.com/static/alertbox/default.gif', type: 'image' }, audio: { src: 'https://cdn.streamelements.com/static/alertbox/default.ogg', volume: 0.5 }, variations: [] },
                subscriber: { enabled: true, duration: 8, text: { message: '{name} is sub!' }, graphics: { src: 'https://cdn.streamelements.com/static/alertbox/default.gif', type: 'image' }, audio: { src: null, volume: 0.5 },
                  variations: [
                    { name: 'Subscriber default', type: 'amount', condition: 'ATLEAST', requirement: 2, settings: { text: { message: '{name} resubt al {amount} maanden!' } } },
                    { name: 'Subscriber gift', type: 'gift', settings: { text: { message: '{sender} gifted {name} a subscription!' }, graphics: { src: null, type: 'image' } } },
                  ] },
                cheer: { enabled: true, duration: 6, text: { message: '{name} cheert {amount} bits: {message}' }, graphics: { src: 'https://cdn.example.com/cheer.webm', type: 'video' }, audio: { src: null }, variations: [] },
                tip: { enabled: true, duration: 8, text: { message: '{name} tipped {currency}{amount}!' }, graphics: { src: null }, variations: [] },
                host: { enabled: true, duration: 8, text: { message: '{name} host' }, graphics: { src: null }, variations: [] },
                raid: { enabled: true, duration: 8, minAmount: 5, text: { message: '{name} raidt met {amount}!' }, graphics: { src: null }, variations: [] },
              },
            },
          ],
        },
      };
      const body = routes[url.pathname];
      if (body === undefined) return res.writeHead(404).end('{}');
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
    } else if (url.pathname === '/oauth2/revoke') {
      res.writeHead(200).end();
    } else res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true });
  // TEST-ONLY stand-in for eventsub.wss.twitch.tv
  const ess = new WebSocketServer({ noServer: true });
  // TEST-ONLY stand-in for the Discord Gateway
  const dgw = new WebSocketServer({ noServer: true });
  let dseq = 0;
  dgw.on('connection', (ws) => {
    ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 30000 } }));
    ws.on('message', (raw) => {
      const p = JSON.parse(raw.toString());
      if (p.op === 1) ws.send(JSON.stringify({ op: 11 }));
      if (p.op === 2) {
        if (p.d.token !== `${'d'.repeat(30)}.discord.${'t'.repeat(30)}`) return ws.close(4004, 'Authentication failed');
        if ((p.d.intents & 2) !== 2) return ws.close(4014, 'Disallowed intent');
        state.discordGw.add(ws);
        ws.send(JSON.stringify({ op: 0, s: ++dseq, t: 'READY', d: { session_id: 'sess', resume_gateway_url: 'ws://localhost:' + port + '/discord-gw', user: { id: '123456789012345678', username: 'LumioBot' }, guilds: [{ id: '999000111222333444', unavailable: true }] } }));
        ws.send(JSON.stringify({ op: 0, s: ++dseq, t: 'GUILD_CREATE', d: { id: '999000111222333444', name: 'Knuffel Discord', icon: null, member_count: 41 } }));
      }
    });
    ws.on('close', () => state.discordGw.delete(ws));
  });
  /** Someone joins the Discord server. */
  const discordJoin = (user) => {
    for (const ws of state.discordGw) ws.send(JSON.stringify({ op: 0, s: ++dseq, t: 'GUILD_MEMBER_ADD', d: { guild_id: '999000111222333444', user, joined_at: new Date().toISOString() } }));
  };
  server.on('upgrade', (req, socket, head) => {
    const target = req.url.startsWith('/eventsub') ? ess : req.url.startsWith('/irc') ? wss : req.url.startsWith('/discord-gw') ? dgw : null;
    if (!target) return socket.destroy();
    target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
  });
  let sid = 0;
  ess.on('connection', (ws) => {
    state.eventsub.add(ws);
    ws.on('close', () => state.eventsub.delete(ws));
    const meta = (type) => ({ message_id: `m-${Date.now()}-${Math.random()}`, message_type: type, message_timestamp: new Date().toISOString() });
    ws.send(JSON.stringify({ metadata: meta('session_welcome'), payload: { session: { id: `session-${++sid}`, status: 'connected', keepalive_timeout_seconds: 10 } } }));
    const ka = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ metadata: meta('session_keepalive'), payload: {} })), 5000);
    ws.on('close', () => clearInterval(ka));
  });
  /** Push an EventSub notification exactly like Twitch does. */
  const event = (subscriptionType, ev, messageId = `n-${Date.now()}-${Math.random()}`) => {
    for (const ws of state.eventsub)
      ws.send(JSON.stringify({ metadata: { message_id: messageId, message_type: 'notification', message_timestamp: new Date().toISOString(), subscription_type: subscriptionType, subscription_version: '1' }, payload: { subscription: { type: subscriptionType }, event: ev } }));
  };
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
        } else if (line.startsWith('PRIVMSG #')) {
          state.sent.push(line);
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

  return new Promise((resolve) => server.listen(port, () => resolve({ state, chat, event, discordJoin, close: () => { for (const ws of state.eventsub) ws.terminate(); for (const ws of state.discordGw) ws.terminate(); dgw.close(); ess.close(); wss.close(); server.close(); } })));
}
