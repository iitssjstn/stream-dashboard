import { EventQueue } from './renderer';
import type { OverlayEvent } from './types';

/**
 * OBS Browser Source entry. No framework, no dashboard dependency:
 * connect -> receive events -> queue -> animate. Reconnects forever.
 */
const token = location.pathname.split('/').filter(Boolean).pop() ?? '';
const params = new URLSearchParams(location.search);
const debug = params.has('debug');

const stage = document.getElementById('stage')!;
const queue = new EventQueue(stage);
let width = Number(params.get('w')) || 1920;
let height = Number(params.get('h')) || 1080;
const fixedSize = params.has('w') || params.has('h');

function fit() {
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  const scale = Math.min(window.innerWidth / width, window.innerHeight / height);
  stage.style.transform = `scale(${scale})`;
}
window.addEventListener('resize', fit);
fit();

const status = document.getElementById('status')!;
function setStatus(s: string, ok: boolean) {
  if (!debug) return;
  status.hidden = false;
  status.textContent = s;
  status.dataset.ok = String(ok);
}

let attempt = 0;
let lastMessage = 0;
let ws: WebSocket | null = null;
let watchdog: number | undefined;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws/overlay/${encodeURIComponent(token)}`);
  setStatus('verbinden…', false);

  ws.onopen = () => {
    attempt = 0;
    lastMessage = Date.now();
    setStatus('verbonden', true);
  };

  ws.onmessage = (e) => {
    lastMessage = Date.now();
    let msg: any;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.type === 'command') queue.push(msg as OverlayEvent);
    else if (msg.type === 'config' && !fixedSize) {
      width = msg.width;
      height = msg.height;
      fit();
    } else if (msg.type === 'ping') ws?.send(JSON.stringify({ type: 'pong', t: msg.t }));
    else if (msg.type === 'reload') location.reload();
  };

  ws.onclose = (e) => {
    ws = null;
    if (e.code === 4004 || e.code === 4001) {
      // Token unknown or revoked: keep retrying slowly in case it was restored, but never spam.
      setStatus('overlay-URL ongeldig', false);
      return void setTimeout(connect, 30_000);
    }
    const delay = Math.min(15_000, 500 * 2 ** attempt++) + Math.random() * 400;
    setStatus(`verbinding verbroken, opnieuw over ${Math.round(delay / 1000)}s`, false);
    setTimeout(connect, delay);
  };

  ws.onerror = () => ws?.close();
}

// The server pings every 15s; if we hear nothing for 40s the socket is silently dead (e.g. sleep, network switch).
watchdog = window.setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN && Date.now() - lastMessage > 40_000) ws.close();
}, 5_000);

connect();
void watchdog;
