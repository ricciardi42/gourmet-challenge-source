import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/api/[[path]].js';

const schema = readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');

// A tiny Cloudflare D1-compatible adapter backed by real SQLite, for API tests
// without an internet connection or a Cloudflare account.
function localDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec(schema);
  function wrapped(sql) {
    let params = [];
    return {
      bind(...args) { params = args; return this; },
      first() { return database.prepare(sql).get(...params) || null; },
      all() { return { results: database.prepare(sql).all(...params) }; },
      run() { return database.prepare(sql).run(...params); },
      execute() { return database.prepare(sql).run(...params); }
    };
  }
  return {
    prepare: wrapped,
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE;');
      try {
        for (const statement of statements) statement.execute();
        database.exec('COMMIT;');
      } catch (error) { database.exec('ROLLBACK;'); throw error; }
    },
    close() { database.close(); }
  };
}
function makeRequest(env, method, path, body, { admin = false, code = null } = {}) {
  const headers = {};
  if (admin) headers['X-Admin-Password'] = env.ADMIN_PASSWORD;
  if (code) headers.Authorization = `Bearer ${code}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const request = new Request(`https://gourmet.example${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return onRequest({ request, env }).then(async response => ({ status: response.status, data: await response.json() }));
}
const roster = Array.from({ length: 10 }, (_, i) => ({
  name: `Guest ${i + 1}`, isChef: i < 6, course: i < 6 ? `Course ${i + 1}` : null
}));

async function start() {
  const env = { DB: localDatabase(), ADMIN_PASSWORD: 'a-long-private-test-password' };
  const call = (method, path, body, options) => makeRequest(env, method, path, body, options);
  const setup = await call('POST', '/api/admin/setup', { participants: roster }, { admin: true });
  assert.equal(setup.status, 201, JSON.stringify(setup.data));
  return { env, call, invitations: setup.data.invitations };
}

test('API setup + login + 54 eligible votes + aggregate results', async t => {
  const { env, call, invitations } = await start();
  t.after(() => env.DB.close());
  assert.equal(invitations.length, 10);
  assert.equal(new Set(invitations.map(p => p.code)).size, 10);
  const status = await call('GET', '/api/status');
  assert.equal(status.status, 200);
  assert.equal(status.data.totalPossible, 54);
  assert.equal(status.data.participants.filter(p => p.isChef).length, 6);
  assert.equal(JSON.stringify(status.data).includes(invitations[0].code), false);

  const chef = invitations[0];
  const selfVote = await call('POST', '/api/vote', { chefId: chef.id, taste: 10, presentation: 10, creativity: 10, pairing: 10 }, { code: chef.code });
  assert.equal(selfVote.status, 403);
  const badVote = await call('POST', '/api/vote', { chefId: chef.id, taste: 11, presentation: 10, creativity: 10, pairing: 10 }, { code: invitations[7].code });
  assert.equal(badVote.status, 400);
  const badLogin = await call('GET', '/api/me', undefined, { code: 'AAAA-BBBB-CCCC-DDDD-EEEE' });
  assert.equal(badLogin.status, 401);

  for (const judge of invitations) for (const competitor of invitations.filter(p => p.isChef && p.id !== judge.id)) {
    const result = await call('POST', '/api/vote', { chefId: competitor.id, taste: 8, presentation: 9, creativity: 7, pairing: 10 }, { code: judge.code });
    assert.equal(result.status, 200, JSON.stringify(result.data));
  }
  const after = await call('GET', '/api/status');
  assert.equal(after.data.voteCount, 54);
  const leaderboard = await call('GET', '/api/results');
  assert.equal(leaderboard.status, 200);
  assert.equal(leaderboard.data.ranking.length, 6);
  assert.equal(leaderboard.data.ranking[0].score, 8.5);
  assert.deepEqual(leaderboard.data.ranking.map(row => row.rank), [1, 1, 1, 1, 1, 1]);
  assert.ok(leaderboard.data.ranking.every(row => row.voteCount === 9));
  const progress = await call('GET', '/api/admin/state', undefined, { admin: true });
  assert.equal(progress.data.progress.length, 10);
  assert.equal(progress.data.progress.find(p => p.judgeId === chef.id).count, 5);

  const update = await call('POST', '/api/vote', { chefId: chef.id, taste: 1, presentation: 1, creativity: 1, pairing: 1 }, { code: invitations[7].code });
  assert.equal(update.status, 200);
  const afterUpdate = await call('GET', '/api/status');
  assert.equal(afterUpdate.data.voteCount, 54, 'updating must not create a duplicate ballot');
  assert.equal((await call('POST', '/api/admin/roster', { participants: roster }, { admin: true })).status, 409);
});

test('API visibility, voting close, reset-code & admin authentication', async t => {
  const { env, call, invitations } = await start();
  t.after(() => env.DB.close());
  const chef = invitations[0];
  const judge = invitations[7];
  assert.equal((await call('POST', '/api/admin/settings', { votingOpen: false, resultsVisible: false }, { admin: true })).status, 200);
  assert.equal((await call('POST', '/api/vote', { chefId: chef.id, taste: 7, presentation: 7, creativity: 7, pairing: 7 }, { code: judge.code })).status, 403);
  assert.equal((await call('GET', '/api/results')).status, 401);
  assert.equal((await call('GET', '/api/results', undefined, { admin: true })).status, 200);
  const reset = await call('POST', '/api/admin/reset-code', { participantId: judge.id }, { admin: true });
  assert.equal(reset.status, 200);
  assert.notEqual(reset.data.code, judge.code);
  assert.equal((await call('GET', '/api/me', undefined, { code: judge.code })).status, 401);
  assert.equal((await call('GET', '/api/me', undefined, { code: reset.data.code })).status, 200);
  assert.equal((await call('GET', '/api/admin/state')).status, 401);
});

test('API roster changes allowed before first vote and retain private codes', async t => {
  const { env, call, invitations } = await start();
  t.after(() => env.DB.close());
  const updated = invitations.map((p, i) => ({ id: p.id, name: i === 0 ? invitations[1].name : i === 1 ? invitations[0].name : p.name,
    isChef: p.isChef, course: p.course }));
  const result = await call('POST', '/api/admin/roster', { participants: updated }, { admin: true });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const me = await call('GET', '/api/me', undefined, { code: invitations[0].code });
  assert.equal(me.data.participant.name, invitations[1].name);
  assert.equal((await call('POST', '/api/admin/setup', { participants: roster }, { admin: true })).status, 409);
});
