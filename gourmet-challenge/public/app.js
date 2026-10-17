const CATEGORIES = [
  { key: 'taste', short: 'Gusto', label: 'Gusto ed equilibrio dei sapori', emoji: '🍽️' },
  { key: 'presentation', short: 'Presentazione', label: 'Presentazione e impiattamento', emoji: '🎨' },
  { key: 'creativity', short: 'Creatività', label: 'Creatività e originalità', emoji: '💡' },
  { key: 'pairing', short: 'Wine pairing', label: 'Abbinamento enogastronomico', emoji: '🍷' }
];
const DEFAULT_COURSES = ['Amuse-bouche', 'Antipasto', 'Primo', 'Secondo', 'Pre-dessert', 'Dessert'];
const state = {
  tab: 'vote', status: null, me: null, admin: null, invitations: null,
  code: sessionStorage.getItem('gourmet-voter-code') || '',
  password: sessionStorage.getItem('gourmet-admin-password') || ''
};
const $ = (selector, scope = document) => scope.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const fmt = number => number === null || number === undefined ? '—' : Number(number).toFixed(2);
const prettyCode = value => String(value).trim().toUpperCase().replace(/[\s-]/g, '');
let toastTimeout;
function toast(message, isError = false) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.toggle('error', isError);
  node.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { node.hidden = true; }, 6000);
}
async function api(path, { method = 'GET', body = null, voter = false, admin = false } = {}) {
  const headers = {};
  if (body !== null) headers['Content-Type'] = 'application/json';
  if (voter && state.code) headers.Authorization = `Bearer ${state.code}`;
  if (admin && state.password) headers['X-Admin-Password'] = state.password;
  let response;
  try {
    response = await fetch(`/api/${path}`, { method, headers, body: body === null ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch {
    throw new Error('Impossibile raggiungere il server. Controlla la connessione e la configurazione Cloudflare.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Errore HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}
function selectTab(tab) {
  state.tab = tab;
  for (const name of ['vote', 'results', 'admin']) {
    $(`#${name}-panel`).hidden = name !== tab;
    const button = $(`[data-tab="${name}"]`);
    button.classList.toggle('active', name === tab);
    if (name === tab) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  if (tab === 'results') loadResults();
  if (tab === 'admin') loadAdmin();
}
function updateHeader() {
  const s = state.status;
  if (!s) return;
  const status = $('#live-status');
  status.classList.toggle('closed', !s.votingOpen);
  status.textContent = !s.initialized ? '⏳ In attesa dello chef organizer' : (s.votingOpen ? '● VOTAZIONI APERTE' : '● VOTAZIONI CHIUSE');
  $('#progress-status').textContent = s.initialized
    ? `${s.voteCount} / ${s.totalPossible} schede completate · ${s.participants.filter(p => p.isChef).length} chef`
    : 'La gara non è ancora stata configurata.';
}
async function refreshStatus() {
  state.status = await api('status');
  updateHeader();
}
async function loadMe() {
  if (!state.code) { state.me = null; return; }
  try {
    state.me = await api('me', { voter: true });
  } catch (error) {
    if (error.status === 401) {
      state.code = '';
      state.me = null;
      sessionStorage.removeItem('gourmet-voter-code');
      toast('Il codice salvato non è più valido. Accedi di nuovo.', true);
    } else throw error;
  }
}
function voteLoginHtml() {
  return `<div class="card login-card"><span class="overline">ACCESSO PERSONALE</span><h3>Benvenuto nella giuria. ⚖️</h3>
    <p>Inserisci il <strong>codice univoco</strong> ricevuto dall'organizzatore. Non serve registrarsi e ogni voto si salva per tutti i dispositivi.</p>
    <form id="voter-login"><div class="field"><label for="voter-code">Il tuo codice personale</label>
    <input id="voter-code" name="code" type="text" placeholder="AB12-CD34-EF56-7890-ABCD" autocomplete="off" autocapitalize="characters" spellcheck="false" required>
    <small>Il codice identifica il votante; non condividerlo.</small></div>
    <div class="action-row"><button class="button button-gold" type="submit">Entra nella giuria →</button></div></form></div>`;
}
function renderVote() {
  const root = $('#vote-content');
  const s = state.status;
  if (!s?.initialized) {
    root.innerHTML = `<div class="notice">⏳ L'organizzatore deve ancora creare la competizione. Vai su <strong>Organizza</strong> per configurarla.</div>`;
    return;
  }
  if (!state.me) { root.innerHTML = voteLoginHtml(); return; }
  const { participant, votes } = state.me;
  const eligible = s.participants.filter(p => p.isChef && p.id !== participant.id);
  const ownVotes = new Map(votes.map(v => [v.chef_id, v]));
  const count = eligible.filter(p => ownVotes.has(p.id)).length;
  root.innerHTML = `<div class="member-banner"><div><strong>👋 Ciao, ${esc(participant.name)}!</strong><small>${participant.isChef ? 'Sei chef e giudice: non puoi votare il tuo piatto.' : 'Sei nella giuria: puoi valutare tutti i sei piatti.'}</small></div>
    <div><strong>${count} / ${eligible.length} piatti votati</strong><button type="button" class="button button-subtle" id="voter-logout" style="padding:5px 9px;min-height:30px;margin-top:5px">Esci</button></div></div>
    ${!s.votingOpen ? '<div class="notice">🔒 Le votazioni sono chiuse. Puoi consultare i tuoi voti, ma non modificarli.</div>' : ''}
    <div class="chef-grid">${eligible.map(chef => voteCard(chef, ownVotes.get(chef.id), s.votingOpen)).join('')}</div>`;
}
function voteCard(chef, saved, open) {
  return `<form class="card chef-card vote-form" data-chef="${esc(chef.id)}"><span class="overline">${esc(chef.course)} · CHEF'S TABLE</span>
    <h3>${esc(chef.name)}</h3><p class="subline">Valuta il piatto in ciascuna categoria da 1 a 10.</p>
    <div class="score-grid">${CATEGORIES.map(c => `<div class="field"><label for="${esc(chef.id)}-${c.key}">${c.emoji} ${esc(c.short)}</label>
      <select id="${esc(chef.id)}-${c.key}" name="${c.key}" aria-label="${esc(c.label)} per ${esc(chef.name)}" ${open ? 'required' : 'disabled'}>
      <option value="">Voto…</option>${Array.from({ length: 10 }, (_, i) => i + 1).map(n => `<option value="${n}" ${saved && Number(saved[c.key]) === n ? 'selected' : ''}>${n} / 10</option>`).join('')}</select></div>`).join('')}</div>
    <div class="action-row"><span class="saved">${saved ? '✓ Voto già salvato' : '○ Da valutare'}</span>
    <button class="button ${saved ? 'button-subtle' : ''}" type="submit" ${open ? '' : 'disabled'}>${saved ? 'Aggiorna voto' : 'Salva voto'} →</button></div></form>`;
}
async function loadResults(silent = false) {
  const root = $('#results-content');
  if (!state.status?.initialized) {
    root.innerHTML = '<div class="notice">La competizione non è ancora configurata.</div>';
    return;
  }
  if (!silent) root.innerHTML = '<div class="card loading">Caricamento dei risultati...</div>';
  try {
    const data = await api('results', { admin: !!state.password });
    root.innerHTML = resultsHtml(data);
  } catch (error) {
    if (error.status === 503 || error.status === 500) root.innerHTML = `<div class="notice">⚠️ ${esc(error.message)}</div>`;
    else if (error.status === 401 || error.status === 403)
      root.innerHTML = '<div class="notice">🔒 La classifica è nascosta finché l’organizzatore non pubblica i risultati. L’admin può visualizzarla dopo l’accesso.</div>';
    else { root.innerHTML = `<div class="notice">${esc(error.message)}</div>`; }
  }
}
function resultsHtml(data) {
  const ranking = data.ranking;
  if (!data.totalVotes) return `<div class="notice">🍽️ Ancora nessun voto! La classifica comparirà dopo la prima valutazione.</div>`;
  const leaders = ranking.filter(p => p.voteCount).slice(0, 3);
  const podiumOrder = [leaders[1], leaders[0], leaders[2]].filter(Boolean);
  return `<div class="results-highlight"><span class="overline">THE HALL OF FAME</span><h3>Il podio della serata 🏆</h3>
      <p>${data.totalVotes} schede su ${data.totalPossible} possibili · media su 10</p>
      <div class="podium">${podiumOrder.map(p => `<div class="podium-card ${p.rank === 1 ? 'first' : ''}"><div class="medal">${p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : '🥉'}</div>
      <strong>${esc(p.name)}</strong><small>${esc(p.course)} · ${fmt(p.score)} / 10</small></div>`).join('')}</div></div>
    <div class="split-charts"><div class="card chart-card"><h3>📊 Overall ranking</h3><p class="chart-subtitle">Media delle 4 categorie, in ordine di classifica</p>
      ${ranking.map(row => `<div class="bar-row"><span class="bar-label" title="${esc(row.name)}">${esc(row.name)}</span><div class="track" role="img" aria-label="${esc(row.name)}: ${fmt(row.score)} su 10"><div class="fill" style="width:${Math.max(0, (row.score || 0) * 10)}%"></div></div><span class="bar-value">${fmt(row.score)}</span></div>`).join('')}</div>
    <div class="card chart-card"><h3>🔬 Breakdown per categoria</h3><p class="chart-subtitle">Media di ogni criterio per il primo classificato</p>
      ${ranking[0] ? CATEGORIES.map(c => criterionBar(c, ranking[0])).join('') : ''}<p class="legend-note">I dettagli di tutti gli chef sono nella tabella sotto.</p></div></div>
    <div class="card"><h3>📈 Confronto di tutti gli chef per criterio</h3><p class="hint">Ogni grafico mostra la media dei singoli criteri per tutti i piatti.</p>
      <div class="criterion-compare-grid">${CATEGORIES.map(c => `<div><h4>${c.emoji} ${esc(c.short)}</h4>
        ${ranking.map(p => `<div class="bar-row"><span class="bar-label" title="${esc(p.name)}">${esc(p.name)}</span><div class="track" role="img" aria-label="${esc(p.name)}: ${fmt(p.criteria[c.key])} su 10"><div class="fill" style="width:${(p.criteria[c.key] || 0) * 10}%"></div></div><span class="bar-value">${fmt(p.criteria[c.key])}</span></div>`).join('')}</div>`).join('')}</div></div>
    <div class="card"><h3>Classifica completa</h3><p class="hint">Ogni piatto riceve fino a 9 valutazioni: tutti i partecipanti tranne il proprio chef.</p>
      <div class="table-wrap"><table class="ranking-table"><thead><tr><th>#</th><th>Chef / Portata</th><th>Voti</th><th>Media /10</th><th>Gusto</th><th>Present.</th><th>Creativ.</th><th>Vino</th></tr></thead><tbody>
      ${ranking.map(p => `<tr><td>${p.rank}</td><td><strong>${esc(p.name)}</strong><small>${esc(p.course)}</small></td>
        <td>${p.voteCount}/${p.expectedVotes}</td><td>${fmt(p.score)}</td>${CATEGORIES.map(c => `<td>${fmt(p.criteria[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>
    <p class="results-footnote">🔎 <strong>Metodo:</strong> media dei 4 criteri (stesso peso), poi media tra votanti. Parità risolta nell'ordine: gusto → presentazione → creatività → abbinamento. A parità anche di criteri, ex aequo. Classifica provvisoria finché mancano voti.</p>`;
}
function criterionBar(c, row) {
  const value = row.criteria[c.key] || 0;
  return `<div class="criterion-item"><div class="criterion-head"><span>${c.emoji} ${esc(c.short)}</span><span>${fmt(row.criteria[c.key])}/10</span></div>
    <div class="track" role="img" aria-label="${esc(c.label)}: ${fmt(value)} su 10"><div class="fill" style="width:${value * 10}%"></div></div></div>`;
}
async function loadAdmin() {
  if (!state.password) { renderAdminLogin(); return; }
  try {
    state.admin = await api('admin/state', { admin: true });
    renderAdmin();
  } catch (error) {
    if (error.status === 401) {
      state.password = '';
      state.admin = null;
      sessionStorage.removeItem('gourmet-admin-password');
    }
    renderAdminLogin(error.message);
  }
}
function renderAdminLogin(error = '') {
  $('#admin-content').innerHTML = `<div class="card login-card"><span class="overline">SOLO ORGANIZZATORI</span><h3>Accesso organizzatore 🔑</h3>
    <p>Usa la password <code>ADMIN_PASSWORD</code> impostata in Cloudflare. Non è inclusa nel codice GitHub.</p>
    ${error ? `<div class="notice">${esc(error)}</div>` : ''}<form id="admin-login"><div class="field"><label for="admin-password">Password admin</label>
    <input id="admin-password" name="password" type="password" required minlength="12" autocomplete="off" placeholder="Password segreta Cloudflare"></div>
    <div class="action-row"><button class="button button-gold" type="submit">Accedi come admin →</button></div></form></div>`;
}
function rosterForm(participants = null) {
  const isEdit = !!participants;
  const rows = participants || Array.from({ length: 10 }, (_, i) => ({ id: '', name: '', isChef: i < 6, course: i < 6 ? DEFAULT_COURSES[i] : '' }));
  return `<form id="${isEdit ? 'roster-edit' : 'roster-setup'}"><div class="admin-list">
    <div class="admin-row admin-header-row"><span>#</span><span>Partecipante</span><span>Chef?</span><span>Portata</span></div>
    ${rows.map((p, i) => `<div class="admin-row" data-row="${i}" data-id="${esc(p.id || '')}"><strong>${i + 1}</strong>
      <div class="field"><label for="name-${i}">Nome</label><input class="js-name" id="name-${i}" placeholder="Nome partecipante" value="${esc(p.name)}" required maxlength="60"></div>
      <div><label class="chef-checkbox"><input class="js-chef" type="checkbox" ${p.isChef ? 'checked' : ''}> 👨🏻‍🍳 Chef</label></div>
      <div class="field course-field"><label for="course-${i}">Portata</label><input class="js-course" id="course-${i}" value="${esc(p.course || '')}" placeholder="Es. Antipasto" maxlength="80" ${p.isChef ? 'required' : 'disabled'}></div></div>`).join('')}</div>
    <div class="action-row"><button type="submit" class="button button-gold">${isEdit ? 'Salva partecipanti e portate' : 'Crea la competizione + 10 codici'} →</button></div></form>`;
}
function renderAdmin() {
  const root = $('#admin-content');
  if (!state.admin) { renderAdminLogin(); return; }
  if (!state.admin.initialized) {
    root.innerHTML = `<div class="card"><h3>1. Scegli i 6 chef e i 4 giudici</h3><p>Inserisci tutti e 10 i nomi. Seleziona esattamente 6 chef e assegna una portata a ognuno.</p>
      <div class="notice">⚠️ <strong>I codici personali saranno mostrati una sola volta dopo la creazione.</strong> Scarica il CSV o inoltrali subito ai partecipanti.</div>
      ${rosterForm()}</div><div class="action-row"><button id="admin-logout" class="button button-subtle" type="button">Esci da admin</button></div>`;
    return;
  }
  const a = state.admin;
  const votes = a.voteCount;
  const progress = new Map(a.progress.map(p => [p.judgeId, p.count]));
  root.innerHTML = `${state.invitations ? invitationsHtml(state.invitations) : ''}
    <div class="stats-grid"><div class="stat"><strong>${a.participants.length}</strong><small>Partecipanti</small></div><div class="stat"><strong>${a.participants.filter(p => p.isChef).length}</strong><small>Chef</small></div><div class="stat"><strong>${votes}/${a.totalPossible}</strong><small>Voti ricevuti</small></div></div>
    <div class="card"><h3>Controlli della gara</h3><p>Apri/chiudi le votazioni e scegli se pubblicare la classifica ai partecipanti.</p>
    <form id="settings-form"><div class="controls"><label class="toggle"><input type="checkbox" name="votingOpen" ${a.votingOpen ? 'checked' : ''}> Votazioni aperte</label>
    <label class="toggle"><input type="checkbox" name="resultsVisible" ${a.resultsVisible ? 'checked' : ''}> Risultati pubblici</label></div>
    <div class="action-row"><button type="submit" class="button">Salva impostazioni</button><button type="button" id="refresh-admin" class="button button-subtle">↻ Aggiorna</button>
    <button type="button" id="admin-logout" class="button button-subtle">Esci</button></div></form></div>
    <div class="card"><h3>Avanzamento della giuria</h3><p>Gli chef votano 5 piatti; i 4 giudici non-chef ne votano 6.</p>
      <div class="judge-progress">${a.participants.map(p => `<div><span>${esc(p.name)} ${p.isChef ? '👨🏻‍🍳' : '⚖️'}</span>
        <strong>${progress.get(p.id) || 0}/${p.isChef ? 5 : 6}</strong></div>`).join('')}</div></div>
    <div class="card"><h3>Partecipanti e portate</h3><p>${votes ? '🔒 La rosa è bloccata perché sono già stati inseriti voti.' : 'Puoi ancora correggere nomi e chef fino al primo voto.'}</p>
      ${votes === 0 ? rosterForm(a.participants) : a.participants.map(p => `<div class="code-row"><span><strong>${esc(p.name)}</strong> ${p.isChef ? '👨🏻‍🍳' : '⚖️'} · ${esc(p.course || 'Giudice')}</span></div>`).join('')}</div>
    <div class="card"><h3>Rigenera un codice personale</h3><p>Se un partecipante perde il proprio codice, puoi crearne uno nuovo. Il precedente verrà disattivato.</p>
      <form id="reset-form"><div class="field"><label for="reset-id">Partecipante</label><select id="reset-id" name="participantId">${a.participants.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <div class="action-row"><button type="submit" class="button button-subtle">Rigenera codice</button></div></form><div id="reset-output"></div></div>`;
}
function invitationsHtml(invitations) {
  return `<div class="card credential-box" id="invitations"><h3>🔐 Codici personali — salvare adesso!</h3><p>Non saranno recuperabili: in seguito potrai solo rigenerarli, uno alla volta.</p>
    <div class="warning">Condividi ogni codice <strong>solo</strong> con il suo destinatario. Chi possiede un codice può modificare i voti di quel partecipante.</div>
    <div class="credentials">${invitations.map((p, i) => `<div class="code-row"><span><strong>${esc(p.name)}</strong> ${p.isChef ? '👨🏻‍🍳' : '⚖️'}<br><code>${esc(p.code)}</code></span>
      <button class="button button-subtle" type="button" data-copy-invite="${i}">📋 Invito</button></div>`).join('')}</div>
    <div class="action-row"><button type="button" id="download-csv" class="button button-gold">⬇ Scarica CSV con tutti i codici</button>
    <button type="button" id="dismiss-codes" class="button button-subtle">Ho salvato i codici</button></div></div>`;
}
function getRosterFromForm(form) {
  return [...form.querySelectorAll('.admin-row[data-row]')].map(row => ({
    ...(row.dataset.id ? { id: row.dataset.id } : {}),
    name: $('.js-name', row).value.trim(),
    isChef: $('.js-chef', row).checked,
    course: $('.js-course', row).value.trim()
  }));
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Testo copiato negli appunti.'); }
  catch { toast('Copia non disponibile. Seleziona e copia il codice manualmente.', true); }
}
function csvEscape(value) {
  let str = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
  return `"${str.replace(/"/g, '""')}"`;
}
function downloadCsv() {
  if (!state.invitations) return;
  const header = ['Nome', 'Ruolo', 'Portata', 'Codice'].map(csvEscape).join(',');
  const lines = state.invitations.map(p => [p.name, p.isChef ? 'Chef' : 'Giudice', p.course || '', p.code].map(csvEscape).join(','));
  const blob = new Blob(['\ufeff' + [header, ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'gourmet-challenge-codici-PRIVATI.csv';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function logoutAdmin() {
  state.password = '';
  state.admin = null;
  state.invitations = null;
  sessionStorage.removeItem('gourmet-admin-password');
  renderAdminLogin();
  toast('Uscita dall’area organizzatore.');
}

// Event delegation keeps dynamically generated voting forms accessible.
document.addEventListener('change', e => {
  if (e.target.classList.contains('js-chef')) {
    const row = e.target.closest('.admin-row');
    const course = $('.js-course', row);
    course.disabled = !e.target.checked;
    course.required = e.target.checked;
    if (e.target.checked && !course.value) course.focus();
  }
});
document.addEventListener('click', async e => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { selectTab(tab.dataset.tab); return; }
  const copy = e.target.closest('[data-copy-invite]');
  if (copy && state.invitations) {
    const p = state.invitations[Number(copy.dataset.copyInvite)];
    await copyText(`🍽️ THE GOURMET CHALLENGE 🏆\nCiao ${p.name}! Sei ${p.isChef ? `chef (${p.course}) e giudice` : 'nella giuria'}.\nVota qui: ${location.origin}\nIl tuo codice PERSONALE: ${p.code}\nNon condividere il codice. NO FISH! 🐟🚫`);
    return;
  }
  if (e.target.closest('#download-csv')) { downloadCsv(); return; }
  if (e.target.closest('#dismiss-codes')) { state.invitations = null; renderAdmin(); return; }
  if (e.target.closest('#admin-logout')) { logoutAdmin(); return; }
  if (e.target.closest('#voter-logout')) {
    state.code = ''; state.me = null; sessionStorage.removeItem('gourmet-voter-code');
    renderVote(); toast('Sei uscito dalla giuria.'); return;
  }
  if (e.target.closest('#refresh-results')) { await loadResults(); return; }
  if (e.target.closest('#refresh-admin')) { await loadAdmin(); return; }
});
document.addEventListener('submit', async e => {
  const form = e.target;
  if (!['voter-login', 'admin-login', 'roster-setup', 'roster-edit', 'settings-form', 'reset-form'].includes(form.id)
    && !form.classList.contains('vote-form')) return;
  e.preventDefault();
  const button = form.querySelector('[type="submit"]');
  if (button) button.disabled = true;
  try {
    if (form.id === 'voter-login') {
      state.code = prettyCode(form.elements.code.value);
      await loadMe();
      if (!state.me) throw new Error('Codice non valido.');
      sessionStorage.setItem('gourmet-voter-code', state.code);
      renderVote(); toast(`Benvenuto, ${state.me.participant.name}!`);
    } else if (form.id === 'admin-login') {
      state.password = form.elements.password.value;
      await loadAdmin();
      if (state.admin) {
        sessionStorage.setItem('gourmet-admin-password', state.password);
        toast('Accesso admin effettuato.');
      }
    } else if (form.id === 'roster-setup' || form.id === 'roster-edit') {
      const participants = getRosterFromForm(form);
      if (participants.filter(p => p.isChef).length !== 6) throw new Error('Seleziona esattamente 6 chef.');
      const create = form.id === 'roster-setup';
      const result = await api(create ? 'admin/setup' : 'admin/roster', {
        method: 'POST', body: { participants }, admin: true
      });
      if (create) state.invitations = result.invitations;
      await refreshStatus(); await loadAdmin();
      toast(result.message || 'Partecipanti aggiornati.');
      if (create) $('#invitations')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (form.id === 'settings-form') {
      await api('admin/settings', { method: 'POST', admin: true,
        body: { votingOpen: form.elements.votingOpen.checked, resultsVisible: form.elements.resultsVisible.checked } });
      await refreshStatus(); await loadAdmin(); renderVote();
      toast('Impostazioni aggiornate.');
    } else if (form.id === 'reset-form') {
      const result = await api('admin/reset-code', { method: 'POST', admin: true,
        body: { participantId: form.elements.participantId.value } });
      $('#reset-output').innerHTML = `<div class="credential-box"><strong>Nuovo codice per ${esc(result.name)}:</strong><br><code>${esc(result.code)}</code>
        <p class="hint">Salvalo e comunicalo subito. Il codice precedente non funziona più.</p></div>`;
      toast('Codice rigenerato.');
    } else if (form.classList.contains('vote-form')) {
      const chefId = form.dataset.chef;
      const body = { chefId };
      for (const category of CATEGORIES) body[category.key] = Number(form.elements[category.key].value);
      const response = await api('vote', { method: 'POST', voter: true, body });
      await Promise.all([refreshStatus(), loadMe()]);
      renderVote(); toast(response.message);
    }
  } catch (error) { toast(error.message, true); }
  finally { if (button?.isConnected) button.disabled = false; }
});

async function init() {
  try {
    await refreshStatus();
    await loadMe();
    renderVote();
  } catch (error) {
    $('#vote-content').innerHTML = `<div class="notice">⚠️ ${esc(error.message)} <br><small>Se hai appena aperto il progetto su GitHub Pages, la API non è disponibile: consulta il README per Cloudflare Pages + D1.</small></div>`;
    $('#live-status').textContent = '● Server non configurato';
    $('#live-status').classList.add('closed');
  }
  setInterval(async () => {
    try {
      await refreshStatus();
      if (state.tab === 'results') await loadResults(true);
      if (state.tab === 'vote' && state.me) renderVote();
    } catch { /* transient errors do not erase ballots or rankings */ }
  }, 15000);
}
init();
