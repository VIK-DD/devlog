import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { discordMessage, actorMatches, makeEmbeds } from './embeds.js';
import { expandPush, makeGitHubClient } from './github.js';
import { startDiscordPresence } from './presence.js';

const {
  PORT = '3000', HOST = '127.0.0.1', DATABASE_PATH = 'data/devlog.sqlite',
  GITHUB_WEBHOOK_SECRET: secret, GITHUB_LOGIN,
  GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_FILE,
  DISCORD_BOT_TOKEN: discordToken, DISCORD_CHANNEL_ID: channel,
} = process.env;
const login = GITHUB_LOGIN?.trim().toLowerCase();
if (!secret?.trim() || !discordToken?.trim() || !/^\d{17,20}$/.test(channel ?? '')) {
  throw new Error('Setează GITHUB_WEBHOOK_SECRET, DISCORD_BOT_TOKEN și DISCORD_CHANNEL_ID în .env.');
}

const compare = makeGitHubClient(GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_FILE);
mkdirSync(dirname(DATABASE_PATH), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(DATABASE_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  CREATE TABLE IF NOT EXISTS deliveries (
    id TEXT PRIMARY KEY,
    event TEXT NOT NULL,
    received INTEGER NOT NULL,
    payload TEXT,
    embeds TEXT,
    next_embed INTEGER NOT NULL DEFAULT 0,
    due INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS pending_deliveries
    ON deliveries (due, received) WHERE payload IS NOT NULL OR embeds IS NOT NULL;
`);

const enqueue = db.prepare(`
  INSERT INTO deliveries (id, event, received, payload)
  VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING
`);
const pending = db.prepare(`
  SELECT * FROM deliveries WHERE (payload IS NOT NULL OR embeds IS NOT NULL) AND due <= ?
  ORDER BY due, received LIMIT 1
`);
const prepare = db.prepare('UPDATE deliveries SET payload = NULL, embeds = ?, attempts = 0 WHERE id = ?');
const advance = db.prepare('UPDATE deliveries SET next_embed = ?, attempts = 0 WHERE id = ?');
const finish = db.prepare('UPDATE deliveries SET payload = NULL, embeds = NULL WHERE id = ?');
const retry = db.prepare('UPDATE deliveries SET attempts = ?, due = ? WHERE id = ?');
const prune = db.prepare('DELETE FROM deliveries WHERE payload IS NULL AND embeds IS NULL AND received < ?');

const discordEndpoint = 'https://discord.com/api/v10/channels/' + channel + '/messages';
let discordReady = 0;

async function publish(embed, id, index) {
  const nonce = createHash('sha256').update(id + ':' + index).digest('base64url').slice(0, 25);
  const response = await fetch(discordEndpoint, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(12_000),
    headers: { authorization: 'Bot ' + discordToken, 'content-type': 'application/json' },
    body: JSON.stringify(discordMessage(embed, nonce)),
  });

  if (response.status === 429) {
    const data = await response.json().catch(() => ({}));
    discordReady = Date.now() + 250 + (Number(data.retry_after || response.headers.get('retry-after')) || 1) * 1000;
    return false;
  }
  await response.body?.cancel();
  if (!response.ok) {
    const error = new Error('Discord API HTTP ' + response.status);
    if (response.status < 500) discordReady = Date.now() + 60_000;
    throw error;
  }
  if (response.headers.get('x-ratelimit-remaining') === '0') {
    discordReady = Date.now() + (Number(response.headers.get('x-ratelimit-reset-after')) || 0) * 1000;
  }
  return true;
}

let busy = false;
let stopping = false;
async function deliver() {
  if (busy || stopping || discordReady > Date.now()) return;
  busy = true;
  let job;
  try {
    job = pending.get(Date.now());
    if (!job) return;
    let embeds = job.embeds ? JSON.parse(job.embeds) : [];
    if (!job.embeds) {
      const payload = JSON.parse(job.payload);
      const incomplete = job.event === 'push' && await expandPush(payload, compare);
      if (actorMatches(job.event, payload, login)) {
        embeds = makeEmbeds(job.event, payload, new Date(job.received).toISOString(), incomplete);
      }
      if (!embeds.length) {
        finish.run(job.id);
        return;
      }
      prepare.run(JSON.stringify(embeds), job.id);
      job.attempts = 0;
    }
    const i = job.next_embed;
    if (!await publish(embeds[i], job.id, i)) return;
    if (i + 1 === embeds.length) finish.run(job.id);
    else advance.run(i + 1, job.id);
  } catch (error) {
    console.error('Livrare în așteptare:', job?.id, error.message);
    if (job) {
      const attempts = job.attempts + 1;
      const delay = Math.max(error.retryAfter ?? 0, Math.min(900_000, 1000 * 2 ** Math.min(attempts, 10)));
      retry.run(attempts, Date.now() + delay, job.id);
    }
  } finally {
    busy = false;
  }
}

const maxBody = 25 * 1024 * 1024;

async function webhook(req, res) {
  if (req.method === 'GET' && req.url === '/healthz') return res.writeHead(200).end('ok');
  if (req.method !== 'POST' || req.url !== '/webhooks/github') return res.writeHead(404).end();

  const signature = req.headers['x-hub-signature-256'];
  const id = req.headers['x-github-delivery'];
  const event = req.headers['x-github-event'];
  if (!/^sha256=[a-f\d]{64}$/i.test(signature ?? '')) return res.writeHead(401).end();
  if (!/^[a-f\d-]{36}$/i.test(id ?? '') || !/^[a-z\d_]{1,80}$/.test(event ?? '')) {
    return res.writeHead(400).end();
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBody) {
      await new Promise((resolve) => res.writeHead(413, { connection: 'close' }).end(resolve));
      return;
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  const expected = createHmac('sha256', secret).update(body).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) {
    return res.writeHead(401).end();
  }
  if (event === 'ping') return res.writeHead(200).end('pong');

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return res.writeHead(400).end();
  }
  if (!payload?.repository) return res.writeHead(204).end();

  enqueue.run(id, event, Date.now(), body.toString());
  return res.writeHead(202).end();
}

const server = createServer((req, res) => {
  webhook(req, res).catch((error) => {
    console.error('Webhook:', error.message);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});
let stopPresence;
server.listen(Number(PORT), HOST, () => {
  console.log('Devlog ascultă pe ' + HOST + ':' + server.address().port);
  stopPresence = startDiscordPresence(discordToken);
});
const worker = setInterval(() => void deliver(), 250);
const cleanup = setInterval(() => prune.run(Date.now() - 7 * 24 * 60 * 60 * 1000), 60 * 60 * 1000);

function shutdown() {
  stopping = true;
  stopPresence?.();
  clearInterval(worker);
  clearInterval(cleanup);
  server.close(() => {
    const drain = setInterval(() => {
      if (busy) return;
      clearInterval(drain);
      db.close();
    }, 100);
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
