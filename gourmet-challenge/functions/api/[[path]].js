import { calculateRanking, cleanCode, validateRoster, validateScores } from '../../src/shared.js';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
};

function send(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: BASE_HEADERS });
}
function must(condition, status, message) {
  if (!condition) throw new HttpError(status, message);
}
async function inputJson(request) {
  const body = await request.text();
  must(body.length <= 24000, 413, 'Richiesta troppo grande.');
  try {
    const parsed = JSON.parse(body);
    must(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 400, 'Il corpo deve essere un oggetto JSON.');
    return parsed;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'JSON non valido.');
  }
}
async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
function newCode() {
  const bytes = new Uint8Array(10); // 80 bits; no short guessable PINs.
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return hex.match(/.{4}/g).join('-');
}
async function checkAdmin(request, env) {
  must(typeof env.ADMIN_PASSWORD === 'string' && env.ADMIN_PASSWORD.length >= 12,
    503, 'Admin non configurato: imposta ADMIN_PASSWORD (minimo 12 caratteri).');
  const password = request.headers.get('X-Admin-Password') || '';
  if (password.length !== env.ADMIN_PASSWORD.length) throw new HttpError(401, 'Password admin errata.');
  const actual = new TextEncoder().encode(password);
  const expected = new TextEncoder().encode(env.ADMIN_PASSWORD);
  if (actual.length !== expected.length) throw new HttpError(401, 'Password admin errata.');
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  must(diff === 0, 401, 'Password admin errata.');
}
async function currentUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  must(auth.startsWith('Bearer '), 401, 'Inserisci il tuo codice personale per votare.');
  const code = cleanCode(auth.slice(7));
  must(/^[0-9A-F]{20}$/.test(code), 401, 'Codice personale non valido.');
  const codeHash = await sha256(code);
  const participant = await env.DB.prepare(
    'SELECT id, name, is_chef, course FROM participants WHERE code_hash = ?'
  ).bind(codeHash).first();
  must(participant, 401, 'Codice personale non riconosciuto.');
  return participant;
}
async function settings(env) {
  return env.DB.prepare('SELECT voting_open, results_visible FROM settings WHERE id = 1').first();
}
async function roster(env) {
  const { results } = await env.DB.prepare('SELECT id, name, is_chef, course FROM participants ORDER BY name COLLATE NOCASE').all();
  return results;
}
async function status(env) {
  const config = await settings(env);
  if (!config) return { initialized: false, votingOpen: false, resultsVisible: false, participants: [], voteCount: 0, totalPossible: 54 };
  const participants = await roster(env);
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM votes').first();
  return {
    initialized: true,
    votingOpen: !!config.voting_open,
    resultsVisible: !!config.results_visible,
    participants: participants.map(p => ({ ...p, isChef: !!p.is_chef, is_chef: undefined })),
    voteCount: n,
    totalPossible: participants.filter(p => p.is_chef).length * (participants.length - 1)
  };
}
async function setup(request, env) {
  await checkAdmin(request, env);
  must(!(await settings(env)), 409, 'La competizione è già configurata. Modifica la rosa dalla pagina admin.');
  const data = await inputJson(request);
  const participants = validateRoster(data.participants);
  const codes = await Promise.all(participants.map(async participant => {
    const code = newCode();
    return { ...participant, id: crypto.randomUUID(), code, codeHash: await sha256(cleanCode(code)) };
  }));
  const statements = [env.DB.prepare('INSERT INTO settings (id, voting_open, results_visible) VALUES (1, 1, 1)')];
  for (const participant of codes) {
    statements.push(env.DB.prepare('INSERT INTO participants (id, name, is_chef, course, code_hash) VALUES (?, ?, ?, ?, ?)')
      .bind(participant.id, participant.name, participant.isChef ? 1 : 0, participant.course, participant.codeHash));
  }
  await env.DB.batch(statements);
  return send({ ok: true, message: 'Competizione creata. Salva subito i codici: non saranno mostrati una seconda volta.',
    invitations: codes.map(({ id, name, isChef, course, code }) => ({ id, name, isChef, course, code })) }, 201);
}
async function updateRoster(request, env) {
  await checkAdmin(request, env);
  must(await settings(env), 409, 'Configura prima la competizione.');
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM votes').first();
  must(n === 0, 409, 'La rosa non si può modificare dopo il primo voto.');
  const existing = await roster(env);
  const data = await inputJson(request);
  const participants = validateRoster(data.participants, { existingIds: new Set(existing.map(p => p.id)) });
  // Temporary unique names permit swaps without violating the UNIQUE constraint.
  const statements = existing.map(p => env.DB.prepare('UPDATE participants SET name = ? WHERE id = ?')
    .bind(`~temp-${p.id}`, p.id));
  for (const p of participants) {
    statements.push(env.DB.prepare('UPDATE participants SET name = ?, is_chef = ?, course = ? WHERE id = ?')
      .bind(p.name, p.isChef ? 1 : 0, p.course, p.id));
  }
  await env.DB.batch(statements);
  return send({ ok: true, message: 'Partecipanti e portate aggiornati. I codici personali non sono cambiati.' });
}
async function adminState(request, env) {
  await checkAdmin(request, env);
  const state = await status(env);
  const { results } = await env.DB.prepare('SELECT judge_id, COUNT(*) AS n FROM votes GROUP BY judge_id').all();
  state.progress = results.map(row => ({ judgeId: row.judge_id, count: row.n }));
  return send(state);
}
async function resetCode(request, env) {
  await checkAdmin(request, env);
  const data = await inputJson(request);
  must(typeof data.participantId === 'string', 400, 'Seleziona un partecipante.');
  const participant = await env.DB.prepare('SELECT id, name FROM participants WHERE id = ?').bind(data.participantId).first();
  must(participant, 404, 'Partecipante non trovato.');
  const code = newCode();
  await env.DB.prepare('UPDATE participants SET code_hash = ? WHERE id = ?')
    .bind(await sha256(cleanCode(code)), participant.id).run();
  return send({ ok: true, name: participant.name, code, message: 'Il vecchio codice è stato disattivato.' });
}
async function updateSettings(request, env) {
  await checkAdmin(request, env);
  must(await settings(env), 409, 'Configura prima la competizione.');
  const data = await inputJson(request);
  must(typeof data.votingOpen === 'boolean' && typeof data.resultsVisible === 'boolean',
    400, 'Specifica entrambi i valori booleani votingOpen e resultsVisible.');
  await env.DB.prepare('UPDATE settings SET voting_open = ?, results_visible = ? WHERE id = 1')
    .bind(data.votingOpen ? 1 : 0, data.resultsVisible ? 1 : 0).run();
  return send({ ok: true });
}
async function me(request, env) {
  const participant = await currentUser(request, env);
  const { results } = await env.DB.prepare(
    'SELECT chef_id, taste, presentation, creativity, pairing, updated_at FROM votes WHERE judge_id = ?'
  ).bind(participant.id).all();
  return send({ participant: { id: participant.id, name: participant.name, isChef: !!participant.is_chef, course: participant.course }, votes: results });
}
async function vote(request, env) {
  const judge = await currentUser(request, env);
  const config = await settings(env);
  must(config && config.voting_open, 403, 'Le votazioni sono chiuse.');
  const data = await inputJson(request);
  must(typeof data.chefId === 'string', 400, 'Scegli uno chef.');
  const chef = await env.DB.prepare('SELECT id, is_chef FROM participants WHERE id = ?').bind(data.chefId).first();
  must(chef && chef.is_chef === 1, 400, 'Il partecipante selezionato non è uno chef.');
  must(judge.id !== chef.id, 403, 'Non puoi votare il tuo stesso piatto.');
  const scores = validateScores(data);
  await env.DB.prepare(`INSERT INTO votes
    (judge_id, chef_id, taste, presentation, creativity, pairing, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(judge_id, chef_id) DO UPDATE SET
    taste=excluded.taste, presentation=excluded.presentation,
    creativity=excluded.creativity, pairing=excluded.pairing, updated_at=datetime('now')`)
    .bind(judge.id, chef.id, scores.taste, scores.presentation, scores.creativity, scores.pairing).run();
  return send({ ok: true, message: 'Voto salvato. Puoi modificarlo finché la votazione resta aperta.' });
}
async function results(request, env) {
  const config = await settings(env);
  must(config, 404, 'Competizione non ancora configurata.');
  if (!config.results_visible) await checkAdmin(request, env);
  const participants = await roster(env);
  const chefs = participants.filter(p => p.is_chef === 1);
  const data = await env.DB.prepare('SELECT chef_id, taste, presentation, creativity, pairing FROM votes').all();
  const ranking = calculateRanking(chefs, data.results, participants.length);
  return send({ ranking, totalVotes: data.results.length, totalPossible: chefs.length * (participants.length - 1),
    criteria: ['taste', 'presentation', 'creativity', 'pairing'],
    tieBreak: 'A parità di media totale: gusto, presentazione, creatività e abbinamento. Se tutte le medie coincidono, pari merito.' });
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 405, headers: BASE_HEADERS });
  try {
    must(env.DB, 503, 'Database non configurato. Collega il binding D1 chiamato DB.');
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    const key = `${request.method} ${path}`;
    switch (key) {
      case 'GET /api/status': return send(await status(env));
      case 'GET /api/me': return await me(request, env);
      case 'GET /api/results': return await results(request, env);
      case 'GET /api/admin/state': return await adminState(request, env);
      case 'POST /api/admin/setup': return await setup(request, env);
      case 'POST /api/admin/roster': return await updateRoster(request, env);
      case 'POST /api/admin/settings': return await updateSettings(request, env);
      case 'POST /api/admin/reset-code': return await resetCode(request, env);
      case 'POST /api/vote': return await vote(request, env);
      default: throw new HttpError(404, 'Endpoint non trovato.');
    }
  } catch (error) {
    if (error instanceof HttpError) return send({ error: error.message }, error.status);
    if (error?.message?.startsWith('Servono esattamente') || error?.message?.startsWith('Seleziona esattamente') ||
      error?.message?.startsWith('Nome ') || error?.message?.startsWith('Nome duplicato') ||
      error?.message?.startsWith('Assegna ') || error?.message?.includes('inserisci un numero intero') ||
      error?.message?.startsWith('ID partecipante') || error?.message?.startsWith('Non puoi aggiungere')) {
      return send({ error: error.message }, 400);
    }
    console.error('Gourmet API error:', error);
    return send({ error: 'Errore interno. Verifica il database e riprova.' }, 500);
  }
}
