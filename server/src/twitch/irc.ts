/** Minimal IRCv3 parser for Twitch chat messages. */
export type IrcMessage = {
  raw: string;
  tags: Record<string, string>;
  prefix: string | null;
  command: string;
  params: string[];
};

function unescapeTag(v: string): string {
  return v.replace(/\\(.)/g, (_, c: string) =>
    c === 's' ? ' ' : c === ':' ? ';' : c === 'r' ? '\r' : c === 'n' ? '\n' : c,
  );
}

export function parseIrcLine(line: string): IrcMessage | null {
  let rest = line.trim();
  if (!rest) return null;
  const tags: Record<string, string> = {};
  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    for (const part of rest.slice(1, sp).split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) tags[part] = '';
      else tags[part.slice(0, eq)] = unescapeTag(part.slice(eq + 1));
    }
    rest = rest.slice(sp + 1).trimStart();
  }
  let prefix: string | null = null;
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ');
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1).trimStart();
  }
  const params: string[] = [];
  const trailingIdx = rest.indexOf(' :');
  let trailing: string | null = null;
  if (trailingIdx !== -1) {
    trailing = rest.slice(trailingIdx + 2);
    rest = rest.slice(0, trailingIdx);
  }
  const parts = rest.split(' ').filter(Boolean);
  const command = parts.shift() ?? '';
  params.push(...parts);
  if (trailing !== null) params.push(trailing);
  return { raw: line, tags, prefix, command: command.toUpperCase(), params };
}

export type ChatRole = 'broadcaster' | 'moderator' | 'vip' | 'subscriber';

export type ChatMessage = {
  id: string;
  channel: string;
  userId: string;
  login: string;
  displayName: string;
  text: string;
  roles: Set<ChatRole>;
  color: string | null;
};

export function toChatMessage(msg: IrcMessage): ChatMessage | null {
  if (msg.command !== 'PRIVMSG' || msg.params.length < 2) return null;
  const login = (msg.prefix ?? '').split('!')[0];
  const badges = (msg.tags['badges'] ?? '')
    .split(',')
    .filter(Boolean)
    .map((b) => b.split('/')[0]);
  const roles = new Set<ChatRole>();
  if (badges.includes('broadcaster')) roles.add('broadcaster');
  if (badges.includes('moderator') || msg.tags['mod'] === '1') roles.add('moderator');
  if (badges.includes('vip') || 'vip' in msg.tags) roles.add('vip');
  if (badges.includes('subscriber') || badges.includes('founder') || msg.tags['subscriber'] === '1') roles.add('subscriber');
  let text = msg.params[1];
  // Strip CTCP ACTION (/me)
  if (text.startsWith('\u0001ACTION ') && text.endsWith('\u0001')) text = text.slice(8, -1);
  return {
    id: msg.tags['id'] ?? '',
    channel: msg.params[0].replace(/^#/, ''),
    userId: msg.tags['user-id'] ?? '',
    login,
    displayName: msg.tags['display-name'] || login,
    text,
    roles,
    color: msg.tags['color'] || null,
  };
}
