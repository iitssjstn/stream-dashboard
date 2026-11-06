import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { CommandStyle } from '../db/schema.js';

export type OverlayCommandEvent = {
  type: 'command';
  eventId: string;
  createdAt: number;
  command: string;
  animation: string;
  characterStyle: string;
  walkIn: boolean;
  useVideoLength: boolean;
  imageUrl: string | null;
  soundUrl: string | null;
  soundVolume: number;
  text: string;
  viewer: string | null;
  target: string | null;
  durationMs: number;
  style: CommandStyle;
};

export type OverlayConfig = { type: 'config'; width: number; height: number; channel: string };

type ServerMessage = OverlayCommandEvent | OverlayConfig | { type: 'ping'; t: number } | { type: 'reload' };

type Client = { ws: WebSocket; alive: boolean; connectedAt: number };

const PENDING_TTL = 30_000;
const PENDING_MAX = 10;

/**
 * Routes events to the overlay browser sources of exactly one streamer. Sockets are keyed
 * by the streamer's user id (resolved from the secret overlay token at connect time), so
 * streamers can never receive each other's events.
 */
export class OverlayHub {
  private clients = new Map<number, Set<Client>>();
  /** Events emitted while no overlay was connected (e.g. OBS reloading), replayed on connect. */
  private pending = new Map<number, OverlayCommandEvent[]>();
  private heartbeat: NodeJS.Timeout;

  constructor() {
    this.heartbeat = setInterval(() => this.sweep(), 15_000);
  }

  add(userId: number, ws: WebSocket, initial: OverlayConfig) {
    const client: Client = { ws, alive: true, connectedAt: Date.now() };
    let set = this.clients.get(userId);
    if (!set) this.clients.set(userId, (set = new Set()));
    set.add(client);
    ws.on('pong', () => (client.alive = true));
    ws.on('message', (raw) => {
      client.alive = true;
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type === 'pong') client.alive = true;
      } catch {
        /* ignore */
      }
    });
    ws.on('close', () => {
      set!.delete(client);
      if (set!.size === 0) this.clients.delete(userId);
    });
    this.send(ws, initial);
    const queued = (this.pending.get(userId) ?? []).filter((e) => Date.now() - e.createdAt < PENDING_TTL);
    this.pending.delete(userId);
    for (const e of queued) this.send(ws, e);
  }

  emit(userId: number, event: Omit<OverlayCommandEvent, 'eventId' | 'createdAt' | 'type'>) {
    const full: OverlayCommandEvent = { type: 'command', eventId: randomUUID(), createdAt: Date.now(), ...event };
    const set = this.clients.get(userId);
    if (!set || set.size === 0) {
      const q = this.pending.get(userId) ?? [];
      q.push(full);
      this.pending.set(userId, q.slice(-PENDING_MAX));
      return { delivered: 0, eventId: full.eventId };
    }
    for (const c of set) this.send(c.ws, full);
    return { delivered: set.size, eventId: full.eventId };
  }

  broadcast(userId: number, msg: ServerMessage) {
    for (const c of this.clients.get(userId) ?? []) this.send(c.ws, msg);
  }

  /** Disconnect all overlays of a user (e.g. after the overlay URL was regenerated). */
  disconnect(userId: number, code = 4001, reason = 'token revoked') {
    for (const c of this.clients.get(userId) ?? []) c.ws.close(code, reason);
    this.clients.delete(userId);
    this.pending.delete(userId);
  }

  count(userId: number) {
    return this.clients.get(userId)?.size ?? 0;
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private sweep() {
    for (const set of this.clients.values()) {
      for (const c of set) {
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        c.ws.ping();
        this.send(c.ws, { type: 'ping', t: Date.now() });
      }
    }
  }

  close() {
    clearInterval(this.heartbeat);
    for (const set of this.clients.values()) for (const c of set) c.ws.close(1001, 'server shutdown');
  }
}
