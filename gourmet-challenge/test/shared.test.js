import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRanking, cleanCode, validateRoster, validateScores } from '../src/shared.js';

const participants = Array.from({ length: 10 }, (_, i) => ({
  name: `Persona ${i + 1}`,
  isChef: i < 6,
  course: i < 6 ? `Portata ${i + 1}` : null
}));
const scores = { taste: 8, presentation: 7, creativity: 9, pairing: 6 };

test('validates the 10-person / 6-chef roster', () => {
  const rows = validateRoster(participants);
  assert.equal(rows.filter(p => p.isChef).length, 6);
  assert.equal(rows[8].course, null);
  assert.throws(() => validateRoster(participants.slice(1)), /10 partecipanti/);
  assert.throws(() => validateRoster(participants.map(p => ({ ...p, isChef: false }))), /6 chef/);
  assert.throws(() => validateRoster(participants.map((p, i) => i === 9 ? { ...p, name: 'persona 1' } : p)), /duplicato/);
  assert.throws(() => validateRoster(participants.map((p, i) => i === 0 ? { ...p, course: '' } : p)), /portata/);
});

test('validates names, strict types and score boundaries', () => {
  assert.deepEqual(validateScores(scores), scores);
  for (const field of Object.keys(scores)) for (const invalid of [0, 11, 2.5, '7', null, undefined, NaN]) {
    assert.throws(() => validateScores({ ...scores, [field]: invalid }));
  }
  assert.equal(cleanCode(' abCD-1234 ef56 '), 'ABCD1234EF56');
});

test('computes one equally weighted score across four criteria', () => {
  const ranking = calculateRanking([{ id: 'a', name: 'Chef A', course: 'Dessert' }], [
    { chef_id: 'a', ...scores },
    { chef_id: 'a', taste: 10, presentation: 10, creativity: 10, pairing: 10 }
  ]);
  assert.equal(ranking[0].score, 8.75);
  assert.equal(ranking[0].criteria.taste, 9);
  assert.equal(ranking[0].criteria.pairing, 8);
  assert.equal(ranking[0].voteCount, 2);
  assert.equal(ranking[0].expectedVotes, 9);
});

test('normalizes for different numbers of judges (not raw total points)', () => {
  const chefs = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const votes = [
    { chef_id: 'a', taste: 10, presentation: 10, creativity: 10, pairing: 10 },
    ...Array.from({ length: 3 }, () => ({ chef_id: 'b', taste: 8, presentation: 8, creativity: 8, pairing: 8 }))
  ];
  const ranking = calculateRanking(chefs, votes);
  assert.deepEqual(ranking.map(r => r.name), ['A', 'B']);
  assert.equal(ranking[0].score, 10);
  assert.equal(ranking[1].score, 8);
});

test('breaks ties by taste, then presentation, then creativity, then pairing', () => {
  const chefs = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const votes = [
    { chef_id: 'a', taste: 9, presentation: 7, creativity: 8, pairing: 8 },
    { chef_id: 'b', taste: 8, presentation: 10, creativity: 7, pairing: 7 },
    { chef_id: 'c', taste: 8, presentation: 7, creativity: 9, pairing: 8 }
  ];
  assert.deepEqual(calculateRanking(chefs, votes).map(r => r.id), ['a', 'b', 'c']);
});

test('exactly equal profiles share a rank; chefs without votes sort last', () => {
  const chefs = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const rank = calculateRanking(chefs, [{ chef_id: 'a', ...scores }, { chef_id: 'b', ...scores }]);
  assert.deepEqual(rank.map(r => r.rank), [1, 1, 3]);
  assert.equal(rank[2].score, null);
});

test('roster modifications require the same exact participant IDs', () => {
  const rows = participants.map((p, i) => ({ ...p, id: `id-${i}` }));
  const validIds = new Set(rows.map(p => p.id));
  assert.equal(validateRoster(rows, { existingIds: validIds }).length, 10);
  assert.throws(() => validateRoster(rows.map((p, i) => i === 0 ? { ...p, id: 'missing' } : p), { existingIds: validIds }), /ID partecipante/);
});
