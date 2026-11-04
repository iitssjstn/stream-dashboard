import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import { config } from '../config.js';
import { parseIrcLine, toChatMessage, type ChatMessage } from './irc.js';

export type ChatStatus = 'disconnected' | 'connecting' | 'connected' | 'auth_failed';

type Options = {
  channel: string;
  login: string;
  getToken: (forceRefresh: boolean) => Promise<string>;
  log: (level: 'info' | 'warn' | 'error', msg: string) => void;
};

/**
 * One authenticated Twitch IRC (WebSocket) connection for one streamer's channel.
 * Handles PING/PONG, keepalive, RECONNECT notices, token refresh and exponential backoff.
 */
export class TwitchChatConnection extends EventEmitter<{
  message: [ChatMessage];
  status: [ChatStatus];
}> {
  status: ChatStatus = 'disconnected';
  lastError: string | null = null;
  connectedAt: number | null = null;
  private ws: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private lastSeen = 0;
  private authFailures = 0;

  constructor(private opts: Options) {
    super();
  }

  start() {
    this.stopped = false;
    void this.connect(false);
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    this.ws?.removeAllListeners();
    this.ws?.terminate();
    this.ws = null;
    this.setStatus('disconnected');
  }

  private setStatus(s: ChatStatus) {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }

  private clearTimers() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.reconnectTimer = this.keepaliveTimer = null;
  }

  private async connect(forceRefresh: boolean) {
    if (this.stopped) return;
    this.clearTimers();
    this.setStatus('connecting');
    let token: string;
    try {
      token = await this.opts.getToken(forceRefresh);
    } catch (err) {
      this.lastError = (err as Error).message;
      this.opts.log('error', `token unavailable for #${this.opts.channel}: ${this.lastError}`);
      this.setStatus('auth_failed');
      // Retry slowly in case it was a transient Twitch outage.
      return this.scheduleReconnect(60_000);
    }
    if (this.stopped) return;

    const ws = new WebSocket(config.twitch.ircUrl);
    this.ws = ws;
    this.lastSeen = Date.now();

    ws.on('open', () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send(`PASS oauth:${token}`);
      ws.send(`NICK ${this.opts.login}`);
    });

    ws.on('message', (data) => {
      this.lastSeen = Date.now();
      for (const line of data.toString().split('\r\n')) this.handleLine(line);
    });

    ws.on('close', (code) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.connectedAt = null;
      if (this.stopped) return;
      if (this.status !== 'auth_failed') this.setStatus('disconnected');
      this.opts.log('warn', `chat #${this.opts.channel} closed (${code}), reconnecting`);
      this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      this.lastError = err.message;
      this.opts.log('warn', `chat #${this.opts.channel} socket error: ${err.message}`);
    });

    // Twitch sends PING roughly every 5 minutes; if we hear nothing for a while, probe and then recycle.
    this.keepaliveTimer = setInterval(() => {
      const idle = Date.now() - this.lastSeen;
      if (idle > 6 * 60_000 + 10_000) ws.terminate();
      else if (idle > 4 * 60_000 && ws.readyState === WebSocket.OPEN) ws.send('PING :lumio');
    }, 30_000);
  }

  private handleLine(line: string) {
    const msg = parseIrcLine(line);
    if (!msg) return;
    switch (msg.command) {
      case 'PING':
        this.ws?.send(`PONG :${msg.params[0] ?? 'tmi.twitch.tv'}`);
        break;
      case '001':
        this.ws?.send(`JOIN #${this.opts.channel}`);
        break;
      case 'JOIN':
        if ((msg.prefix ?? '').startsWith(`${this.opts.login}!`)) {
          this.attempt = 0;
          this.authFailures = 0;
          this.lastError = null;
          this.connectedAt = Date.now();
          this.setStatus('connected');
          this.opts.log('info', `joined #${this.opts.channel}`);
        }
        break;
      case 'NOTICE': {
        const text = msg.params[msg.params.length - 1] ?? '';
        if (/Login authentication failed|Improperly formatted auth/i.test(text)) {
          this.authFailures++;
          this.lastError = text;
          this.opts.log('warn', `auth failed for #${this.opts.channel}, refreshing token`);
          this.setStatus('auth_failed');
          this.ws?.removeAllListeners('close');
          this.ws?.terminate();
          this.ws = null;
          if (this.authFailures > 2) return this.scheduleReconnect(5 * 60_000);
          this.reconnectTimer = setTimeout(() => void this.connect(true), 1000);
        }
        break;
      }
      case 'RECONNECT':
        this.ws?.terminate();
        break;
      case 'PRIVMSG': {
        const chat = toChatMessage(msg);
        if (chat) this.emit('message', chat);
        break;
      }
    }
  }

  private scheduleReconnect(delay?: number) {
    if (this.stopped) return;
    this.clearTimers();
    const d = delay ?? Math.min(30_000, 1000 * 2 ** this.attempt) + Math.random() * 500;
    this.attempt++;
    this.reconnectTimer = setTimeout(() => void this.connect(false), d);
  }
}
