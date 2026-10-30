import {
  buildTable, lastResult, teamDivision, seasonForDate, seasonNotes,
  toDateNum, dateNumToIso, ordinal, tieBreaker,
} from './league.js';

export const APP_VERSION = '1.0.0';

const $ = (id) => document.getElementById(id);
const els = {
  form: $('query'), team: $('team'), teams: $('teams'), date: $('date'), include: $('include'),
  status: $('status'), result: $('result'), summary: $('summary'), notes: $('notes'),
  divisions: $('divisions'), table: $('table'),
};

let index = null;
const seasonCache = new Map();
const state = { team: '', date: '', include: true, division: null };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function formatDate(n, withDay = true) {
  const [y, m, d] = dateNumToIso(n).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-GB', {
    ...(withDay ? { weekday: 'short' } : {}), day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

const shortSeason = (s) => `${s.slice(0, 4)}/${s.slice(7, 9)}`;

async function loadSeason(entry) {
  if (!seasonCache.has(entry.file)) {
    seasonCache.set(entry.file, fetch(`data/${entry.file}`).then((r) => {
      if (!r.ok) throw new Error(`Couldn't load ${entry.season}`);
      return r.json();
    }));
  }
  return seasonCache.get(entry.file);
}

/** Case-insensitive team lookup; also accepts a unique partial match ("Plymouth"). */
function resolveTeam(input) {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  const names = Object.keys(index.teams);
  const exact = names.find((n) => n.toLowerCase() === q);
  if (exact) return exact;
  const partial = names.filter((n) => n.toLowerCase().includes(q));
  return partial.length === 1 ? partial[0] : partial.length ? { candidates: partial } : null;
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('team')) state.team = p.get('team');
  if (p.get('date')) state.date = p.get('date');
  if (p.get('inc')) state.include = p.get('inc') !== '0';
}

function writeHash() {
  const p = new URLSearchParams({ team: state.team, date: state.date });
  if (!state.include) p.set('inc', '0');
  history.replaceState(null, '', `#${p}`);
}

function setStatus(text) {
  els.status.textContent = text;
  els.status.hidden = !text;
}

/** Where the team was in the seasons either side, for when they're not in the covered divisions. */
function whereElse(teamName, seasonIdx) {
  const list = index.teams[teamName];
  const prev = [...list].reverse().find(([s]) => s < seasonIdx);
  const next = list.find(([s]) => s > seasonIdx);
  const describe = ([s, d]) => `${shortSeason(index.seasons[s].season)} (${index.seasons[s].divisions[d].name})`;
  const parts = [];
  if (prev) parts.push(`last covered season: ${describe(prev)}`);
  if (next) parts.push(`next: ${describe(next)}`);
  return parts.join('; ');
}

/** Last result for a team on/before the date, looking back into earlier seasons if needed. */
async function findLastResult(teamName, seasonIdx, date, includeDate) {
  const list = index.teams[teamName].filter(([s]) => s <= seasonIdx).reverse();
  for (const [s] of list.slice(0, 3)) {
    const sd = await loadSeason(index.seasons[s]);
    const r = lastResult(sd, sd.teams.indexOf(teamName), date, { includeDate });
    if (r) return { ...r, season: sd.season, divisionName: sd.divisions[r.divisionId].name };
  }
  return null;
}

/** The team's next and previous match dates within the season, for stepping through. */
function neighbourDates(sd, teamIdx, date) {
  const d = toDateNum(date);
  let prev = null, next = null;
  for (const [md, , h, a] of sd.matches) {
    if (h !== teamIdx && a !== teamIdx) continue;
    if (md < d) prev = md;
    else if (md > d && next === null) next = md;
  }
  return { prev, next };
}

async function show() {
  const resolved = resolveTeam(els.team.value);
  if (!resolved) { setStatus(`No club called "${els.team.value}" in the data.`); els.result.hidden = true; return; }
  if (resolved.candidates) {
    setStatus(`Did you mean: ${resolved.candidates.slice(0, 8).join(', ')}${resolved.candidates.length > 8 ? '…' : ''}?`);
    els.result.hidden = true;
    return;
  }
  if (!els.date.value) { setStatus('Pick a date.'); return; }

  state.team = resolved;
  els.team.value = resolved;
  state.date = els.date.value;
  state.include = els.include.checked;
  writeHash();

  const { entry, status } = seasonForDate(index.seasons, state.date);
  if (!entry) {
    setStatus('League football in England began on 8 September 1888. Pick a later date.');
    els.result.hidden = true;
    return;
  }
  setStatus('Loading…');
  const seasonIdx = index.seasons.indexOf(entry);
  const sd = await loadSeason(entry);
  const teamIdx = sd.teams.indexOf(state.team);
  const div = teamIdx >= 0 ? teamDivision(sd, teamIdx) : null;
  const opts = { includeDate: state.include };
  const last = await findLastResult(state.team, seasonIdx, state.date, state.include);

  // Which point in time the tables describe.
  const d = toDateNum(state.date);
  let context;
  if (status === 'finished') {
    const nextSeason = index.seasons[seasonIdx + 1];
    const gapYears = nextSeason ? Math.floor(nextSeason.from / 10000) - Math.floor(entry.to / 10000) : 0;
    context = gapYears > 1
      ? `No league football was played on this date. These are the final tables of ${shortSeason(entry.season)}, the last season before the break.`
      : `Close season. These are the final tables of ${shortSeason(entry.season)}.`;
  } else {
    context = `${shortSeason(entry.season)} season, ${state.include ? 'after' : 'before'} games on ${formatDate(d, false)}.`;
  }

  // Summary card
  let html = `<p class="context">${esc(context)}</p>`;
  if (div !== null) {
    const table = buildTable(sd, div, state.date, opts);
    const row = table.find((r) => r.team === state.team);
    if (row) {
      html += `<h2 class="club">${esc(state.team)}</h2>
        <p class="pos"><span class="big">${ordinal(row.pos)}</span> of ${table.length}
        in ${esc(sd.divisions[div].name)}</p>
        <p class="line">P ${row.p} · ${row.pts} pts · ${gdText(row, sd.season)}</p>`;
    } else {
      html += `<h2 class="club">${esc(state.team)}</h2><p class="pos">Not in the table on this date (record expunged).</p>`;
    }
  } else {
    const where = whereElse(state.team, seasonIdx);
    html += `<h2 class="club">${esc(state.team)}</h2>
      <p class="pos">Not in a covered division in ${shortSeason(entry.season)}.</p>
      ${where ? `<p class="line">${esc(where.charAt(0).toUpperCase() + where.slice(1))}.</p>` : ''}`;
  }
  if (last) {
    const won = { W: 'won', D: 'drew', L: 'lost' }[last.outcome];
    const sameSeason = last.season === sd.season;
    // If the club is outside the covered divisions this season, their real last game
    // isn't in the data, so say so rather than pass off an older result as the latest.
    html += `<div class="last">
      <p class="label">${div === null ? 'Last result in the data' : 'Last result'}</p>
      <p class="score"><span class="${last.venue === 'H' ? 'us' : ''}">${esc(last.home)}</span>
        <b>${last.homeGoals}–${last.awayGoals}</b>
        <span class="${last.venue === 'A' ? 'us' : ''}">${esc(last.away)}</span></p>
      <p class="meta"><span class="res res-${last.outcome}">${won}</span> ${formatDate(last.date)}
        ${sameSeason ? '' : `· ${esc(shortSeason(last.season))}, ${esc(last.divisionName)}`}</p>
    </div>`;
  } else {
    html += `<div class="last"><p class="label">Last result</p><p class="meta">No earlier league game in the data.</p></div>`;
  }
  if (teamIdx >= 0) {
    const { prev, next } = neighbourDates(sd, teamIdx, state.date);
    html += `<div class="step">
      <button type="button" data-goto="${prev ?? ''}" ${prev ? '' : 'disabled'}>‹ Previous game</button>
      <button type="button" data-goto="${next ?? ''}" ${next ? '' : 'disabled'}>Next game ›</button>
    </div>`;
  }
  els.summary.innerHTML = html;

  const notes = seasonNotes(sd, state.date);
  els.notes.innerHTML = notes.map((n) => `<p class="note">${esc(n)}</p>`).join('');

  // Division picker: every division in the season, the team's own selected first time.
  if (state.division === null || !sd.divisions[state.division] || state.lastSeason !== sd.season) {
    state.division = div ?? 0;
  }
  state.lastSeason = sd.season;
  state.ownDivision = div;
  state.sd = sd;
  renderDivisions();
  renderTable();
  setStatus('');
  els.result.hidden = false;
}

function gdText(row, season) {
  if (tieBreaker(season) === 'gd') return `GD ${row.gd > 0 ? '+' : ''}${row.gd}`;
  return `Goal average ${Number.isFinite(row.gav) ? row.gav.toFixed(3) : '—'}`;
}

function renderDivisions() {
  const { sd } = state;
  els.divisions.innerHTML = sd.divisions.map((d) => `
    <button type="button" data-div="${d.id}" aria-pressed="${d.id === state.division}"
      class="${d.id === state.ownDivision ? 'own' : ''}">
      <span class="tier">Tier ${d.tier}</span>${esc(d.name.replace(/^(Football League|EFL) /, ''))}
    </button>`).join('');
}

function renderTable() {
  const { sd } = state;
  const table = buildTable(sd, state.division, state.date, { includeDate: state.include });
  const ga = tieBreaker(sd.season) === 'ga';
  const rows = table.map((r) => `
    <tr class="${r.team === state.team ? 'me' : ''}">
      <td class="n">${r.pos}</td>
      <td class="t"><button type="button" class="link" data-team="${esc(r.team)}">${esc(r.team)}</button></td>
      <td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td>
      <td class="fa">${r.gf}</td><td class="fa">${r.ga}</td>
      <td>${ga ? (Number.isFinite(r.gav) ? r.gav.toFixed(2) : '—') : (r.gd > 0 ? '+' : '') + r.gd}</td>
      <td class="pts">${r.pts}</td>
    </tr>`).join('');
  els.table.innerHTML = `
    <h3 class="divname">${esc(sd.divisions[state.division].name)}</h3>
    <div class="scroll"><table>
      <thead><tr><th class="n">#</th><th class="t">Club</th><th>P</th><th>W</th><th>D</th><th>L</th>
        <th class="fa">F</th><th class="fa">A</th><th>${ga ? 'GAv' : 'GD'}</th><th class="pts">Pts</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

els.form.addEventListener('submit', (e) => { e.preventDefault(); state.division = null; show().catch(fail); });
els.include.addEventListener('change', () => { if (!els.result.hidden) show().catch(fail); });
els.divisions.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-div]');
  if (!b) return;
  state.division = Number(b.dataset.div);
  renderDivisions();
  renderTable();
});
els.table.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-team]');
  if (!b) return;
  els.team.value = b.dataset.team;
  state.division = null;
  show().catch(fail);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
els.summary.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-goto]');
  if (!b || !b.dataset.goto) return;
  els.date.value = dateNumToIso(Number(b.dataset.goto));
  show().catch(fail);
});

function fail(err) {
  console.error(err);
  setStatus(`Something went wrong: ${err.message}`);
}

async function init() {
  index = await fetch('data/index.json').then((r) => r.json());
  els.teams.innerHTML = Object.keys(index.teams).map((t) => `<option value="${esc(t)}">`).join('');
  els.date.min = dateNumToIso(index.seasons[0].from);
  els.date.max = dateNumToIso(index.dataTo);
  readHash();
  els.team.value = state.team;
  els.date.value = state.date || dateNumToIso(index.dataTo);
  els.include.checked = state.include;
  setStatus(`Results up to ${formatDate(index.dataTo, false)}.`);
  if (state.team && state.date) await show();
}

init().catch(fail);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
