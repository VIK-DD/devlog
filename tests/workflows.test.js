import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { test } from 'node:test';

const discordMessageId = '123456789012345678';
const mockDiscord = `
  import { appendFileSync } from 'node:fs';
  globalThis.WebSocket = class extends EventTarget {
    readyState = 0;
    static CLOSING = 2;
    close() { this.dispatchEvent(new Event('close')); }
  };
  globalThis.fetch = async (url, request) => {
    if (!url.startsWith('https://discord.com/api/')) throw new Error('Unexpected request');
    appendFileSync(process.env.DISCORD_LOG, JSON.stringify({
      url, method: request.method, payload: JSON.parse(request.body),
    }) + '\\n');
    return Response.json({ id: '${discordMessageId}' });
  };
`;

test('Actions edits one card across lifecycle events, restarts and reruns', { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'devlog-workflows-'));
  const preload = join(dir, 'discord.mjs');
  const log = join(dir, 'discord.jsonl');
  writeFileSync(preload, mockDiscord);
  writeFileSync(log, '');
  const env = {
    ...process.env,
    PORT: '0',
    HOST: '127.0.0.1',
    DATABASE_PATH: join(dir, 'db.sqlite'),
    DISCORD_LOG: log,
    DISCORD_CHANNEL_ID: '234567890123456789',
    DISCORD_BOT_TOKEN: 'test-token',
    GITHUB_WEBHOOK_SECRET: 'test-secret',
    GITHUB_LOGIN: 'octocat',
    GITHUB_APP_ID: '',
    GITHUB_APP_PRIVATE_KEY_FILE: '',
  };
  const repoUrl = 'https://github.com/example/project';
  const runUrl = repoUrl + '/actions/runs/456';
  const repo = { id: 123, name: 'Project', full_name: 'example/project', html_url: repoUrl };
  const owner = { login: 'octocat' };
  const asynchronousActor = { login: 'github-actions[bot]' };
  let child;
  let source;

  async function start() {
    child = spawn(process.execPath, ['--import', preload, 'src/server.js'], { env });
    const ready = await Promise.race([
      once(child.stdout, 'data').then(([chunk]) => String(chunk).match(/:(\d+)/)?.[1]),
      once(child, 'exit').then(([code]) => assert.fail('Devlog exited with code ' + code)),
    ]);
    assert.ok(ready, 'Devlog did not return a local port');
    source = 'http://127.0.0.1:' + ready;
  }

  async function stop() {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    child = undefined;
  }

  async function webhook(type, payload) {
    const body = JSON.stringify({ repository: repo, ...payload });
    const signature = createHmac('sha256', env.GITHUB_WEBHOOK_SECRET).update(body).digest('hex');
    const response = await fetch(source + '/webhooks/github', {
      method: 'POST',
      headers: {
        'x-github-delivery': randomUUID(),
        'x-github-event': type,
        'x-hub-signature-256': 'sha256=' + signature,
      },
      body,
    });
    assert.equal(response.status, 202);
  }

  function workflow(status, conclusion, attempt = 1) {
    return webhook('workflow_run', {
      action: status,
      sender: owner,
      workflow_run: {
        id: 456, run_attempt: attempt, name: 'Build preview', event: 'workflow_dispatch',
        head_branch: 'main', html_url: runUrl, status, conclusion, actor: owner,
      },
    });
  }

  function job(status, conclusion) {
    return webhook('workflow_job', {
      action: status,
      sender: asynchronousActor,
      workflow_job: {
        id: 789, run_id: 456, run_attempt: 1, name: 'Build demo page',
        workflow_name: 'Build preview', head_branch: 'main', html_url: runUrl + '/job/789',
        status, conclusion,
      },
    });
  }

  function messages() {
    return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  }

  async function expectCount(count) {
    for (let attempt = 0; attempt < 40 && messages().length < count; attempt++) await wait(100);
    const requests = messages();
    assert.equal(requests.length, count);
    return requests.at(-1).payload.embeds[0];
  }

  try {
    await start();
    await webhook('workflow_dispatch', { sender: owner });
    await workflow('queued');
    assert.match((await expectCount(1)).description, /^Queued on/);
    await job('in_progress');
    assert.match((await expectCount(2)).description, /🟡 \[Build demo page\]/);

    await stop();
    await start();
    await workflow('completed', 'success');
    assert.match((await expectCount(3)).description, /^Finished successfully on/);
    await job('completed', 'success');
    const completed = await expectCount(4);
    assert.match(completed.description, /✅ \[Build demo page\]/);
    await workflow('queued');
    await job('queued');
    await webhook('check_suite', { sender: owner, check_suite: { app: { slug: 'github-actions' } } });
    await wait(850);
    assert.equal(messages().length, 4);

    await workflow('in_progress', null, 2);
    const rerun = await expectCount(5);
    assert.match(rerun.description, /^In progress on/);
    assert.match(rerun.footer.text, /Attempt 2$/);
    assert.doesNotMatch(rerun.description, /Build demo page/);
    const [first, ...edits] = messages();
    assert.equal(first.method, 'POST');
    assert.ok(first.payload.enforce_nonce);
    assert.ok(edits.every((request) => request.method === 'PATCH' && request.url.endsWith('/' + discordMessageId)));
  } finally {
    await stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
