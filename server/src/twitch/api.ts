import { config } from '../config.js';
import { twitchCredentials } from '../settings.js';

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string[];
  token_type: string;
};

export type TwitchUser = {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
};

export class TwitchAuthError extends Error {}

export function authorizeUrl(state: string): string {
  const u = new URL(`${config.twitch.idBase}/oauth2/authorize`);
  u.searchParams.set('client_id', twitchCredentials().clientId);
  u.searchParams.set('redirect_uri', config.twitch.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', config.twitch.scopes.join(' '));
  u.searchParams.set('state', state);
  u.searchParams.set('force_verify', 'true');
  return u.toString();
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${config.twitch.idBase}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: twitchCredentials().clientId,
      client_secret: twitchCredentials().clientSecret,
      ...params,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 400 || res.status === 401) throw new TwitchAuthError(`Twitch token error ${res.status}: ${body}`);
    throw new Error(`Twitch token error ${res.status}: ${body}`);
  }
  return (await res.json()) as TokenResponse;
}

export function exchangeCode(code: string) {
  return tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: config.twitch.redirectUri });
}

export function refreshAccessToken(refreshToken: string) {
  return tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' });
}

export async function getUser(accessToken: string): Promise<TwitchUser> {
  const res = await fetch(`${config.twitch.apiBase}/helix/users`, {
    headers: { authorization: `Bearer ${accessToken}`, 'client-id': twitchCredentials().clientId },
  });
  if (res.status === 401) throw new TwitchAuthError('Twitch rejected access token');
  if (!res.ok) throw new Error(`Helix /users failed: ${res.status}`);
  const json = (await res.json()) as { data: TwitchUser[] };
  if (!json.data[0]) throw new Error('Helix /users returned no user');
  return json.data[0];
}

export async function revokeToken(accessToken: string) {
  await fetch(`${config.twitch.idBase}/oauth2/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: twitchCredentials().clientId, token: accessToken }),
  }).catch(() => undefined);
}

/** Checks a client id/secret pair with Twitch (client-credentials grant) without storing anything. */
export async function verifyAppCredentials(clientId: string, clientSecret: string): Promise<boolean> {
  const res = await fetch(`${config.twitch.idBase}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
  });
  if (res.ok) {
    const { access_token } = (await res.json()) as { access_token: string };
    await fetch(`${config.twitch.idBase}/oauth2/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, token: access_token }),
    }).catch(() => undefined);
    return true;
  }
  if (res.status >= 400 && res.status < 500) return false;
  throw new Error(`Twitch is niet bereikbaar (${res.status})`);
}

async function helix(path: string, accessToken: string, init: RequestInit = {}) {
  const res = await fetch(`${config.twitch.apiBase}/helix/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, 'client-id': twitchCredentials().clientId, 'content-type': 'application/json', ...init.headers },
  });
  if (res.status === 401) throw new TwitchAuthError('Twitch rejected access token');
  return res;
}

/** True when the channel is live right now. */
export async function isLive(accessToken: string, twitchId: string): Promise<boolean> {
  const res = await helix(`streams?user_id=${encodeURIComponent(twitchId)}`, accessToken);
  if (!res.ok) throw new Error(`Helix /streams failed: ${res.status}`);
  const json = (await res.json()) as { data: unknown[] };
  return json.data.length > 0;
}

export async function createEventSubSubscription(accessToken: string, body: unknown) {
  const res = await helix('eventsub/subscriptions', accessToken, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok && res.status !== 409) throw new Error(`EventSub subscribe failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}
