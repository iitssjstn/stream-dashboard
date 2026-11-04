import { config } from '../config.js';

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
  u.searchParams.set('client_id', config.twitch.clientId);
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
      client_id: config.twitch.clientId,
      client_secret: config.twitch.clientSecret,
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
    headers: { authorization: `Bearer ${accessToken}`, 'client-id': config.twitch.clientId },
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
    body: new URLSearchParams({ client_id: config.twitch.clientId, token: accessToken }),
  }).catch(() => undefined);
}
