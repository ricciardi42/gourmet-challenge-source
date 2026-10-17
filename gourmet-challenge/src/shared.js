/** Pure competition rules shared by the API and Node tests. */
export const CRITERIA = [
  { key: 'taste', label: 'Gusto ed equilibrio dei sapori' },
  { key: 'presentation', label: 'Presentazione e impiattamento' },
  { key: 'creativity', label: 'Creatività e originalità' },
  { key: 'pairing', label: 'Abbinamento enogastronomico' }
];

export const MAX_PARTICIPANTS = 10;
export const CHEF_COUNT = 6;

export function cleanCode(value) {
  return String(value ?? '').trim().replace(/[\s-]/g, '').toUpperCase();
}

export function validateRoster(input, { existingIds = null } = {}) {
  if (!Array.isArray(input) || input.length !== MAX_PARTICIPANTS) {
    throw new Error('Servono esattamente 10 partecipanti.');
  }
  const names = new Set();
  const ids = new Set();
  const output = input.map((row, index) => {
    const name = typeof row?.name === 'string' ? row.name.trim().replace(/\s+/g, ' ') : '';
    const isChef = row?.isChef === true;
    const course = isChef && typeof row?.course === 'string' ? row.course.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > 60) throw new Error(`Nome non valido alla riga ${index + 1} (massimo 60 caratteri).`);
    const nameKey = name.toLocaleLowerCase('it');
    if (names.has(nameKey)) throw new Error(`Nome duplicato: ${name}.`);
    names.add(nameKey);
    if (isChef && (!course || course.length > 80)) {
      throw new Error(`Assegna una portata valida a ${name} (massimo 80 caratteri).`);
    }
    const result = { name, isChef, course: isChef ? course : null };
    if (existingIds !== null) {
      if (typeof row.id !== 'string' || !existingIds.has(row.id) || ids.has(row.id)) {
        throw new Error(`ID partecipante non valido alla riga ${index + 1}.`);
      }
      result.id = row.id;
      ids.add(row.id);
    }
    return result;
  });
  if (output.filter(p => p.isChef).length !== CHEF_COUNT) {
    throw new Error('Seleziona esattamente 6 chef.');
  }
  if (existingIds !== null && ids.size !== existingIds.size) {
    throw new Error('Non puoi aggiungere o eliminare partecipanti dopo la configurazione.');
  }
  return output;
}

export function validateScores(input) {
  const scores = {};
  for (const { key, label } of CRITERIA) {
    const value = input?.[key];
    if (!Number.isInteger(value) || value < 1 || value > 10) {
      throw new Error(`${label}: inserisci un numero intero da 1 a 10.`);
    }
    scores[key] = value;
  }
  return scores;
}

/** Rank by the mean of all four criteria. Ties: taste, presentation,
 * creativity, wine; identical averages in all four criteria share a rank.
 * Cross multiplication avoids floating-point errors in comparisons. */
export function calculateRanking(chefs, votes, totalParticipants = MAX_PARTICIPANTS) {
  const rows = chefs.map(chef => {
    const ownVotes = votes.filter(vote => vote.chef_id === chef.id);
    const sums = Object.fromEntries(CRITERIA.map(c => [c.key, 0]));
    for (const vote of ownVotes) for (const { key } of CRITERIA) sums[key] += Number(vote[key]);
    const count = ownVotes.length;
    const score = count ? CRITERIA.reduce((total, { key }) => total + sums[key], 0) / (count * CRITERIA.length) : null;
    return {
      id: chef.id,
      name: chef.name,
      course: chef.course,
      voteCount: count,
      expectedVotes: Math.max(0, totalParticipants - 1),
      score: score === null ? null : round(score),
      criteria: Object.fromEntries(CRITERIA.map(({ key }) => [key, count ? round(sums[key] / count) : null])),
      _sums: sums,
      _count: count
    };
  });
  rows.sort((a, b) => {
    if (!a._count && !b._count) return a.name.localeCompare(b.name, 'it');
    if (!a._count) return 1;
    if (!b._count) return -1;
    const aTotal = CRITERIA.reduce((total, { key }) => total + a._sums[key], 0);
    const bTotal = CRITERIA.reduce((total, { key }) => total + b._sums[key], 0);
    const overall = bTotal * a._count - aTotal * b._count;
    if (overall) return overall;
    for (const { key } of CRITERIA) {
      const criterion = b._sums[key] * a._count - a._sums[key] * b._count;
      if (criterion) return criterion;
    }
    return a.name.localeCompare(b.name, 'it');
  });
  let last = null;
  for (const [index, row] of rows.entries()) {
    const tied = last && row._count && last._count && CRITERIA.every(({ key }) =>
      row._sums[key] * last._count === last._sums[key] * row._count);
    row.rank = tied ? last.rank : index + 1;
    last = row;
  }
  for (const row of rows) {
    delete row._sums;
    delete row._count;
  }
  return rows;
}

function round(value) { return Math.round(value * 100) / 100; }
