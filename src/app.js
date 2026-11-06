import {
  buildTable, lastResult, teamDivision, seasonForDate, seasonNotes,
  toDateNum, dateNumToIso, ordinal, tieBreaker, positionTimeline, teamMatches, netAdjustment,
  divisionFinished, zoneLines,
} from './league.js?v=1.0.11';
import { seasonChart, historyChart } from './charts.js?v=1.0.11';

export const APP_VERSION = '1.0.11';

const $ = (id) => document.getElementById(id);
const els = {
  form: $('query'), team: $('team'), teams: $('teams'), date: $('date'), include: $('include'),
  status: $('status'), result: $('result'), summary: $('summary'), notes: $('notes'),
  divisions: $('divisions'), table: $('table'), views: $('views'),
  season: $('view-season'), history: $('view-history'), results: $('view-results'),
};
const VIEWS = ['table', 'season', 'history', 'results'];
const DEFAULT_TEAM = 'Manchester City';

let index = null;
const seasonCache = new Map();
const state = { team: '', date: '', include: true, division: null, view: 'table', histPick: null, seasonPick: null };
let historyData = null;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function formatDate(n, withDay = true) {
  const [y, m, d] = dateNumToIso(n).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-GB', {
    ...(withDay ? { weekday: 'short' } : {}), day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

/** Today's date in the UK, as yyyy-mm-dd. */
function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
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
  if (VIEWS.includes(p.get('view'))) state.view = p.get('view');
}

function writeHash() {
  const p = new URLSearchParams({ team: state.team, date: state.date });
  if (!state.include) p.set('inc', '0');
  if (state.view !== 'table') p.set('view', state.view);
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
  if (d > index.dataTo && isLive(seasonIdx)) {
    // Today (or a recent day) in a season still going: the data stops a little short of it.
    context = `${shortSeason(entry.season)} season. Latest results in the data: up to ${formatDate(index.dataTo, false)}.`;
  } else if (status === 'finished') {
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
        <p class="line">P ${row.p} · ${row.pts} pts · ${gdText(row, sd.season)}${netAdjustment(row)
          ? ` · <span class="adj">${adjText(netAdjustment(row))}*</span>` : ''}</p>`;
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
  state.teamIdx = teamIdx;
  state.seasonIdx = seasonIdx;
  state.seasonPick = null;
  state.histPick = null;
  renderDivisions();
  renderTable();
  setStatus('');
  els.result.hidden = false;
  await renderView();
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
  // Promotion/relegation/European lines, and on the final table the clubs that actually
  // qualified for Europe or won the play-offs.
  const z = sd.zones?.[state.division];
  const lines = zoneLines(z, table.length);
  const final = divisionFinished(sd, state.division, state.date, { includeDate: state.include });
  const comps = sd.competitions || {};
  const shade = (r) => {
    if (!final) return '';
    if (sd.europe?.[r.teamIdx]) return `q-${sd.europe[r.teamIdx]}`;
    if (sd.playoffWinners?.includes(r.teamIdx)) return 'q-po';
    return '';
  };
  const rows = table.map((r, i) => `
    <tr class="${[r.team === state.team ? 'me' : '', lines[i + 1] ? `l-${lines[i + 1]}` : '', shade(r)].join(' ').trim()}">
      <td class="n">${r.pos}</td>
      <td class="t"><button type="button" class="link" data-team="${esc(r.team)}">${esc(r.team)}</button></td>
      <td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td>
      <td class="fa">${r.gf}</td><td class="fa">${r.ga}</td>
      <td>${ga ? (Number.isFinite(r.gav) ? r.gav.toFixed(2) : '—') : (r.gd > 0 ? '+' : '') + r.gd}</td>
      <td class="pts">${r.pts}${r.adjustments ? '<span class="adj-mark">*</span>' : ''}</td>
    </tr>`).join('');
  const notes = table.filter((r) => r.adjustments).map((r) => `<p class="footnote">* <b>${esc(r.team)}</b>:
    ${r.adjustments.map((a) => esc(adjustmentNote(a))).join('; ')}${r.adjustments.length > 1 ? `. In total, ${esc(adjText(netAdjustment(r)))}` : ''}.</p>`).join('');
  // Key: only what this table shows.
  const used = new Set(Object.values(lines));
  const shaded = new Set(final ? table.map(shade).filter(Boolean) : []);
  const lineLabel = {
    cl: comps.EC, el: comps.UEFA, ecl: comps.ECL, up: 'Promotion', po: 'Play-offs',
    down: 'Relegation', reelect: 'Re-election', test: 'Test matches',
  };
  const fillLabel = {
    'q-EC': comps.EC, 'q-CWC': comps.CWC, 'q-UEFA': comps.UEFA, 'q-ECL': comps.ECL, 'q-po': 'Play-off winners',
  };
  const keyItems = [
    ...['cl', 'el', 'ecl', 'up', 'po', 'test', 'reelect', 'down'].filter((k) => used.has(k))
      .map((k) => `<span class="key-item"><span class="k-line l-${k}"></span>${esc(lineLabel[k])}</span>`),
    ...(['q-EC', 'q-CWC', 'q-UEFA', 'q-ECL'].some((k) => shaded.has(k)) ? ['<span class="key-group">Qualified for:</span>'] : []),
    ...['q-EC', 'q-CWC', 'q-UEFA', 'q-ECL', 'q-po'].filter((k) => shaded.has(k))
      .map((k) => `<span class="key-item"><span class="k-fill ${k}"></span>${esc(fillLabel[k])}</span>`),
  ];
  const zoneNote = [
    z?.eu && !final ? 'European places by league position; cup winners can change who qualifies.' : '',
    final && z?.eu !== undefined && sd.divisions[state.division].tier === 1 && sd.europeNote ? sd.europeNote : '',
  ].filter(Boolean).map((t) => `<p class="footnote">${esc(t)}</p>`).join('');
  const key = keyItems.length ? `<p class="zone-key">${keyItems.join('')}</p>` : '';
  els.table.innerHTML = `
    <h3 class="divname">${esc(sd.divisions[state.division].name)}</h3>
    <div class="scroll"><table>
      <thead><tr><th class="n">#</th><th class="t">Club</th><th>P</th><th>W</th><th>D</th><th>L</th>
        <th class="fa">F</th><th class="fa">A</th><th>${ga ? 'GAv' : 'GD'}</th><th class="pts">Pts</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>${key}${zoneNote}${notes}`;
}

/** "10 points deducted" / "4 points restored" */
function adjText(points) {
  const n = Math.abs(points);
  return `${n} point${n === 1 ? '' : 's'} ${points < 0 ? 'deducted' : 'restored'}`;
}

function adjustmentNote(a) {
  let when;
  if (a.on === 'start') when = 'from the start of the season';
  else if (a.on === 'final') when = 'in the final table (date not known)';
  else if (a.on > a.date) when = `on ${formatDate(a.on, false)}, after the season ended`;
  else when = `on ${formatDate(a.on, false)}`;
  return `${adjText(a.points)} ${when} (${a.reason})`;
}

// ---- Views: Table / Season / History / Results -------------------------------------------

const shortDate = (n) => {
  const [y, m, d] = dateNumToIso(n).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
};
const chartWidth = (el) => Math.max(280, Math.floor(el.clientWidth || els.result.clientWidth || 340));
const outcomeWord = { W: 'won', D: 'drew', L: 'lost' };

/** The latest season is still being played if its last result is from August to April. */
function isLive(s) {
  if (s !== index.seasons.length - 1) return false;
  const month = Math.floor(index.seasons[s].to / 100) % 100;
  return month >= 8 || month <= 4;
}

async function renderView() {
  for (const b of els.views.querySelectorAll('button')) b.setAttribute('aria-selected', b.dataset.view === state.view);
  $('view-table').hidden = state.view !== 'table';
  els.season.hidden = state.view !== 'season';
  els.history.hidden = state.view !== 'history';
  els.results.hidden = state.view !== 'results';
  if (state.view === 'season') renderSeason();
  if (state.view === 'history') await renderHistory();
  if (state.view === 'results') renderResults();
}

/** Jump to a date (and optionally a view), as if picked in the form. */
function goTo(dateNum, view) {
  els.date.value = dateNumToIso(dateNum);
  if (view) state.view = view;
  state.division = null;
  show().catch(fail);
  if (view === 'table') els.summary.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const notCovered = (what) => `<p class="empty">${esc(state.team)} weren't in a covered division in
  ${shortSeason(state.sd.season)}, so there's no ${what} for this season. Try the History view.</p>`;

// Season graph ------------------------------------------------------------------------------

let seasonCache2 = { key: '', points: null };
function seasonData() {
  const { sd, teamIdx, ownDivision } = state;
  const key = `${sd.season}|${teamIdx}`;
  if (seasonCache2.key !== key) {
    const matches = teamMatches(sd, teamIdx);
    seasonCache2 = {
      key,
      matches,
      points: positionTimeline(sd, ownDivision, teamIdx),
      outcomes: new Map(matches.map((mt) => [mt.date, mt.outcome])),
    };
  }
  return seasonCache2;
}

function renderSeason() {
  const { sd, ownDivision } = state;
  if (ownDivision === null) { els.season.innerHTML = notCovered('season graph'); return; }
  const { points, outcomes, matches } = seasonData();
  if (!points.length) { els.season.innerHTML = '<p class="empty">No games yet this season.</p>'; return; }
  const played = points.filter((p) => p.played);
  if (state.seasonPick === null) {
    // Start on the club's last game up to the chosen date.
    const d = toDateNum(state.date);
    const i = played.findLastIndex((p) => p.date <= d);
    state.seasonPick = i >= 0 ? i : 0;
  }
  const pick = played[state.seasonPick];
  const match = matches.find((mt) => mt.date === pick.date);
  const final = points.at(-1);

  els.season.innerHTML = `
    <h3 class="divname">${esc(sd.divisions[ownDivision].name)} ${shortSeason(sd.season)}</h3>
    <p class="sub">Position after each day's games${isLive(state.seasonIdx)
      ? ', so far' : ` · finished ${ordinal(final.pos)} of ${final.size}`}. Drag or tap the graph.</p>
    <div class="readout">
      <p><b>${formatDate(pick.date)}</b>: ${ordinal(pick.pos)} of ${pick.size}, ${pick.pts} pts from ${pick.p}</p>
      ${match ? `<p class="meta"><span class="res res-${match.outcome}">${outcomeWord[match.outcome]}</span>
        ${match.for}–${match.against} ${match.venue === 'H' ? 'v' : 'at'} ${esc(match.opponent)}</p>` : ''}
      <button type="button" class="small" data-goto-table="${pick.date}">Table on this date</button>
    </div>
    <div class="chart" data-chart="season"></div>
    <p class="legend"><span class="key res-W"></span>Won <span class="key res-D"></span>Drew
      <span class="key res-L"></span>Lost <span class="key marker"></span>Selected date</p>`;
  const box = els.season.querySelector('.chart');
  const { svg, xs } = seasonChart({
    points, outcomes, picked: state.seasonPick, marker: toDateNum(state.date), width: chartWidth(box),
  });
  box.innerHTML = svg;
  scrub.season = { xs, pick: (i) => { if (i !== state.seasonPick) { state.seasonPick = i; renderSeason(); } } };
}

// Results list ------------------------------------------------------------------------------

function renderResults() {
  const { sd, ownDivision } = state;
  if (ownDivision === null) { els.results.innerHTML = notCovered('results list'); return; }
  const { points, matches } = seasonData();
  const posOn = new Map(points.map((p) => [p.date, p]));
  const d = toDateNum(state.date);
  const current = matches.findLast((mt) => mt.date <= d);
  const tally = { W: 0, D: 0, L: 0 };
  matches.forEach((mt) => tally[mt.outcome]++);
  const rows = matches.map((mt) => `
    <tr class="${mt === current ? 'me' : ''}" data-goto-table="${mt.date}">
      <td class="dt">${shortDate(mt.date)}</td>
      <td class="ha">${mt.venue}</td>
      <td class="t">${esc(mt.opponent)}</td>
      <td class="sc"><span class="res res-${mt.outcome}">${mt.outcome}</span> ${mt.for}–${mt.against}</td>
      <td class="n">${posOn.get(mt.date) ? ordinal(posOn.get(mt.date).pos) : ''}</td>
    </tr>`).join('');
  els.results.innerHTML = `
    <h3 class="divname">${esc(state.team)} ${shortSeason(sd.season)}</h3>
    <p class="sub">${esc(sd.divisions[ownDivision].name)} · P ${matches.length} · W ${tally.W} D ${tally.D} L ${tally.L}.
      Tap a game for the table that day.</p>
    <div class="scroll"><table class="results">
      <thead><tr><th class="dt">Date</th><th class="ha"></th><th class="t">Opponent</th><th class="sc">Score</th><th class="n">Pos</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

// History graph -----------------------------------------------------------------------------

async function loadHistory() {
  if (!historyData) {
    historyData = fetch('data/history.json').then((r) => {
      if (!r.ok) throw new Error("Couldn't load the history data");
      return r.json();
    });
  }
  return historyData;
}

async function renderHistory({ center = true } = {}) {
  const oldStrip = els.history.querySelector('.strip');
  const keepScroll = oldStrip ? oldStrip.scrollLeft : null;
  const hist = await loadHistory();
  const rows = hist.teams[state.team];
  if (!rows) { els.history.innerHTML = '<p class="empty">No seasons in the data for this club.</p>'; return; }
  if (state.histPick === null) {
    // Start on the season being looked at, or the nearest one before it.
    const i = rows.findLastIndex((r) => r[0] <= state.seasonIdx);
    state.histPick = i >= 0 ? i : 0;
  }
  const r = rows[state.histPick];
  const [s, divId, pos, p, w, d, l, gf, ga, pts] = r;
  const entry = index.seasons[s];
  const div = entry.divisions[divId];
  const live = isLive(s);
  const size = hist.sizes[s][divId];

  // What happened next: promoted, relegated, or out of the covered divisions.
  let next = '';
  const nr = rows[state.histPick + 1];
  if (!live && index.seasons[s + 1]) {
    const nextName = shortSeason(index.seasons[s + 1].season);
    if (nr && nr[0] === s + 1) {
      const nt = index.seasons[s + 1].divisions[nr[1]].tier;
      if (nt < div.tier) next = `Promoted for ${nextName}.`;
      else if (nt > div.tier) next = `Relegated for ${nextName}.`;
    } else {
      next = `Not in a covered division in ${nextName}.`;
    }
  }
  const gap = Number.isFinite(index.seasons[s + 1]?.from) && Math.floor(index.seasons[s + 1].from / 10000) - Math.floor(entry.to / 10000) > 1;
  if (gap && next) next = `${next.slice(0, -1)} (after the break in league football).`;
  const champions = pos === 1 && !live ? (div.tier === 1 ? 'Champions of England. ' : 'Champions. ') : '';

  const titles = rows.filter((x) => x[2] === 1 && x[0] !== hist.inProgress && index.seasons[x[0]].divisions[x[1]].tier === 1).length;
  const tiersSeen = [...new Set(rows.map((x) => index.seasons[x[0]].divisions[x[1]].tier))].sort();

  els.history.innerHTML = `
    <h3 class="divname">${esc(state.team)}: every season</h3>
    <p class="sub">${rows.length} seasons in the data, in tier${tiersSeen.length > 1 ? 's' : ''} ${tiersSeen.join(', ')}${titles ? `; ${titles} top-flight title${titles > 1 ? 's' : ''}` : ''}.
      Final position each season, with the tiers (T1, T2…) stacked top to bottom. Swipe to scroll, tap a season.</p>
    <div class="readout">
      <p><b>${shortSeason(entry.season)}</b>: ${live ? 'currently ' : ''}${ordinal(pos)} of ${size} in ${esc(div.name)} (tier ${div.tier})</p>
      <p class="meta">P ${p} · W ${w} D ${d} L ${l} · ${gf}–${ga} · ${pts} pts${live ? ' so far' : ''}</p>
      ${champions || next ? `<p class="meta">${champions}${esc(next)}</p>` : ''}
      <div class="step">
        <button type="button" data-hist-step="-1" ${state.histPick ? '' : 'disabled'}>‹</button>
        <button type="button" data-hist-open="table" data-season="${s}">${live ? 'Table' : 'Final table'}</button>
        <button type="button" data-hist-open="season" data-season="${s}">Graph</button>
        <button type="button" data-hist-open="results" data-season="${s}">Results</button>
        <button type="button" data-hist-step="1" ${state.histPick < rows.length - 1 ? '' : 'disabled'}>›</button>
      </div>
    </div>
    <div class="chart hscroll" data-chart="history"><div class="strip"></div><div class="gutter"></div></div>
    <p class="legend"><span class="key line"></span>Final position <span class="key title"></span>League champions
      <span class="key band"></span>Alternate tiers shaded</p>
    <details class="seasons" ${state.histListOpen ? 'open' : ''}><summary>All seasons as a list</summary>
      <div class="scroll"><table class="results">
        <thead><tr><th class="dt">Season</th><th class="t">Division</th><th class="n">Pos</th><th class="n">Pts</th></tr></thead>
        <tbody>${rows.map((x, i) => `<tr class="${i === state.histPick ? 'me' : ''}" data-hist-pick="${i}">
          <td class="dt">${shortSeason(index.seasons[x[0]].season)}</td>
          <td class="t">${esc(index.seasons[x[0]].divisions[x[1]].name.replace(/^(Football League|EFL) /, ''))}</td>
          <td class="n">${ordinal(x[2])}</td><td class="n">${x[9]}</td></tr>`).join('')}</tbody>
      </table></div>
    </details>`;
  const box = els.history.querySelector('.chart');
  const { svg, gutter, xs } = historyChart({
    rows, seasons: index.seasons, sizes: hist.sizes, picked: state.histPick,
    inProgress: hist.inProgress, width: chartWidth(box),
  });
  box.querySelector('.strip').innerHTML = svg;
  box.querySelector('.gutter').innerHTML = gutter;
  const strip = box.querySelector('.strip');
  // Keep the scroll where the finger left it after a tap; otherwise bring the pick to the middle.
  if (!center && keepScroll !== null) strip.scrollLeft = keepScroll;
  else if (xs[state.histPick] != null) strip.scrollLeft = xs[state.histPick] - strip.clientWidth / 2;
  histXs = xs;
}

/** Open a season picked in the history graph: its last day, in the chosen view. */
function openSeason(s, view) {
  const entry = index.seasons[s];
  goTo(Math.min(entry.to, index.dataTo), view);
}

// Tap and drag on a chart picks the nearest point. Listeners sit on the views (which persist)
// because the SVG inside is redrawn on every pick.
const scrub = { season: null };
let histXs = [];
function onChartPointer(e) {
  const box = e.target.closest('.chart');
  if (!box) return;
  const sc = scrub[box.dataset.chart];
  if (!sc || !sc.xs.length) return;
  if (e.type === 'pointerdown') box.setPointerCapture?.(e.pointerId);
  else if (!e.buttons && e.pointerType !== 'mouse') return;
  const px = e.clientX - box.getBoundingClientRect().left;
  let best = 0;
  sc.xs.forEach((x, i) => { if (Math.abs(x - px) < Math.abs(sc.xs[best] - px)) best = i; });
  sc.pick(best);
}
els.season.addEventListener('pointerdown', onChartPointer);
els.season.addEventListener('pointermove', (e) => { if (e.buttons) onChartPointer(e); });

els.views.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  state.view = b.dataset.view;
  writeHash();
  renderView().catch(fail);
});
for (const el of [els.season, els.results]) {
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-goto-table]');
    if (t) goTo(Number(t.dataset.gotoTable), 'table');
  });
}
els.history.addEventListener('click', (e) => {
  const st = e.target.closest('[data-hist-step]');
  if (st) { state.histPick += Number(st.dataset.histStep); renderHistory().catch(fail); return; }
  const op = e.target.closest('[data-hist-open]');
  if (op) { openSeason(Number(op.dataset.season), op.dataset.histOpen); return; }
  // The history graph scrolls sideways, so a swipe pans it and only a tap (click) picks a season.
  const svg = e.target.closest('.strip svg');
  if (svg && histXs.length) {
    const px = e.clientX - svg.getBoundingClientRect().left;
    let best = 0;
    histXs.forEach((x, i) => { if (Math.abs(x - px) < Math.abs(histXs[best] - px)) best = i; });
    if (best !== state.histPick) { state.histPick = best; renderHistory({ center: false }).catch(fail); }
    return;
  }
  const row = e.target.closest('[data-hist-pick]');
  if (row) { state.histPick = Number(row.dataset.histPick); renderHistory().catch(fail); }
});
els.history.addEventListener('toggle', (e) => { state.histListOpen = e.target.open; }, true);
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.view === 'season') renderSeason();
    if (state.view === 'history') renderHistory({ center: false }).catch(fail);
  }, 150);
});

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
$('today').addEventListener('click', () => {
  els.date.value = todayIso();
  state.division = null;
  show().catch(fail);
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
  els.date.max = todayIso();
  readHash();
  els.team.value = state.team || DEFAULT_TEAM;
  els.date.value = state.date || todayIso();
  els.include.checked = state.include;
  setStatus(`Results up to ${formatDate(index.dataTo, false)}.`);
  // Footer: how far the results go, beside the version. Updates when the daily job adds results.
  const [ty, tm, td] = dateNumToIso(index.dataTo).split('-').map(Number);
  $('data-to').textContent = ` · results up to ${new Date(Date.UTC(ty, tm - 1, td))
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
  await show();
}

init().catch(fail);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
