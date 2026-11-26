import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const apiOrigin = 'https://api.github.com';
const zeroSha = /^0{40}$/;
const sha = /^[a-f0-9]{40}$/i;

function compareRange(payload) {
  if (sha.test(payload.before) && !zeroSha.test(payload.before) && sha.test(payload.after)) {
    return payload.before + '...' + payload.after;
  }
  try {
    const url = new URL(payload.compare);
    if (url.origin !== 'https://github.com') return undefined;
    const prefix = '/' + payload.repository.full_name + '/compare/';
    if (!url.pathname.startsWith(prefix)) return undefined;
    const parts = decodeURIComponent(url.pathname.slice(prefix.length)).split(/\.{2,3}/);
    if (parts.length === 2 && parts.every(Boolean)) {
      const [base, head] = parts;
      return base + '...' + (sha.test(payload.after) ? payload.after : head);
    }
  } catch {
    return undefined;
  }
}

async function githubRequest(path, token, method = 'GET') {
  const response = await fetch(apiOrigin + path, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + token,
      'user-agent': 'devlog-discord',
    },
  });
  if (!response.ok) {
    await response.body?.cancel();
    const error = new Error('GitHub API HTTP ' + response.status);
    error.status = response.status;
    const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000 - Date.now();
    error.retryAfter = Number(response.headers.get('retry-after')) * 1000
      || (response.headers.get('x-ratelimit-remaining') === '0' && reset > 0 ? reset : undefined);
    throw error;
  }
  return response.json();
}

export function makeGitHubClient(appId, keyFile) {
  if (!appId && !keyFile) return undefined;
  if (!/^\d+$/.test(appId ?? '') || !keyFile) {
    throw new Error('Setează GITHUB_APP_ID și GITHUB_APP_PRIVATE_KEY_FILE împreună.');
  }

  const key = createPrivateKey(readFileSync(keyFile));
  const tokens = new Map();

  async function installationToken(installation) {
    const cached = tokens.get(installation);
    if (cached && Date.parse(cached.expires_at) > Date.now() + 60_000) return cached.token;

    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId })).toString('base64url');
    const unsigned = header + '.' + claims;
    const jwt = unsigned + '.' + sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url');
    const result = await githubRequest('/app/installations/' + installation + '/access_tokens', jwt, 'POST');
    tokens.set(installation, result);
    return result.token;
  }

  return async function compare(payload, range) {
    const id = payload.installation?.id;
    if (!Number.isSafeInteger(id)) return [];
    const token = await installationToken(id);
    const repo = payload.repository.full_name.split('/').map(encodeURIComponent).join('/');
    const path = '/repos/' + repo + '/compare/' + encodeURIComponent(range) + '?per_page=100&page=';
    const commits = [];
    for (let page = 1; ; page++) {
      const result = await githubRequest(path + page, token);
      for (const commit of result.commits) {
        commits.push({
          id: commit.sha,
          url: commit.html_url,
          message: commit.commit.message,
          author: { username: commit.author?.login },
          committer: { username: commit.committer?.login },
        });
      }
      if (result.commits.length < 100) return commits;
    }
  };
}

export async function expandPush(payload, compare) {
  const original = payload.commits ?? [];
  const declared = Math.max(payload.size ?? 0, payload.distinct_size ?? 0);
  if (payload.deleted || (original.length < 2048 && original.length >= declared)) return false;
  const range = compareRange(payload);
  if (!compare || !range) return declared > original.length || original.length >= 2048;

  try {
    const fetched = await compare(payload, range);
    if (fetched.length >= original.length && fetched.length >= declared) {
      const merged = new Map(fetched.map((commit) => [commit.id, commit]));
      for (const commit of original) merged.set(commit.id, commit);
      payload.commits = [...merged.values()];
      return false;
    }
  } catch (error) {
    if (error.retryAfter || ![401, 403, 404, 422].includes(error.status)) throw error;
    console.warn('Comparație incompletă:', error.message);
  }
  return true;
}
