// Pure league-table logic. No DOM, so it runs in the browser and in node tests.
//
// Season data shape (as written by scripts/build-data.mjs):
// {
//   season: "1982/1983",
//   divisions: [{ id: 0, name: "Football League First Division", tier: 1 }, ...],
//   teams: ["Arsenal", ...],
//   matches: [[yyyymmdd, divisionId, homeTeamIdx, awayTeamIdx, homeGoals, awayGoals], ...]  // sorted by date
// }

/** First calendar year of a "1982/1983" season string. */
export function seasonStartYear(season) {
  return parseInt(String(season).slice(0, 4), 10);
}

/** 2 points for a win until 1980/81, 3 from 1981/82 (England). */
export function pointsForWin(season) {
  return seasonStartYear(season) >= 1981 ? 3 : 2;
}

/** Goal average decided ties until 1975/76; goal difference from 1976/77. */
export function tieBreaker(season) {
  return seasonStartYear(season) >= 1976 ? 'gd' : 'ga';
}

/** Goal average = goals for / goals against. Nothing conceded ranks above any finite average. */
export function goalAverage(gf, ga) {
  if (ga === 0) return gf === 0 ? 0 : Infinity;
  return gf / ga;
}

/** "1983-02-19" or Date -> 19830219 */
export function toDateNum(d) {
  if (typeof d === 'number') return d;
  if (d instanceof Date) return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
  if (!m) throw new Error(`Bad date: ${d}`);
  return parseInt(m[1] + m[2] + m[3], 10);
}

export function dateNumToIso(n) {
  const s = String(n);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/**
 * Pick the season that applies on a date from the index's season list
 * ([{ season, from, to }], from/to as yyyymmdd, sorted).
 * Returns { entry, status } where status is:
 *   'in-progress' – date falls within the season's first and last match
 *   'finished'    – date is after the season ended (close season, or a gap such as wartime)
 *   null entry    – date is before league football began
 */
export function seasonForDate(seasons, date) {
  const d = toDateNum(date);
  let pick = null;
  for (const s of seasons) {
    if (s.from <= d) pick = s;
    else break;
  }
  if (!pick) return { entry: null, status: null };
  return { entry: pick, status: d >= pick.to ? 'finished' : 'in-progress' };
}

/**
 * Build the table for one division as at the end of `date` (inclusive)
 * or before it (exclusive), depending on `includeDate`.
 */
export function buildTable(seasonData, divisionId, date, { includeDate = true } = {}) {
  const d = toDateNum(date);
  const win = pointsForWin(seasonData.season);
  const rows = new Map();
  const row = (t) => {
    let r = rows.get(t);
    if (!r) {
      r = { team: seasonData.teams[t], teamIdx: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
      rows.set(t, r);
    }
    return r;
  };

  // Mid-season expulsions/resignations that have happened by this date.
  const active = (seasonData.events || []).filter((e) => (includeDate ? e.date <= d : e.date < d));
  const expunged = new Set(active.filter((e) => e.type === 'expunge').map((e) => e.team));
  const takenOver = new Map(active.filter((e) => e.type === 'takeover').map((e) => [e.team, e.to]));

  for (const m of seasonData.matches) {
    const [md, div, , , hg, ag] = m;
    if (div !== divisionId) continue;
    let [, , h, a] = m;
    if (expunged.has(h) || expunged.has(a)) continue;
    h = takenOver.get(h) ?? h;
    a = takenOver.get(a) ?? a;
    // Every team in the division appears in the table, even before their first game.
    const hr = row(h);
    const ar = row(a);
    if (includeDate ? md > d : md >= d) continue;
    hr.p++; ar.p++;
    hr.gf += hg; hr.ga += ag;
    ar.gf += ag; ar.ga += hg;
    if (hg > ag) { hr.w++; ar.l++; hr.pts += win; }
    else if (hg < ag) { ar.w++; hr.l++; ar.pts += win; }
    else { hr.d++; ar.d++; hr.pts++; ar.pts++; }
  }

  const tb = tieBreaker(seasonData.season);
  const table = [...rows.values()].map((r) => ({
    ...r,
    gd: r.gf - r.ga,
    gav: goalAverage(r.gf, r.ga),
  }));
  table.sort((x, y) => {
    if (y.pts !== x.pts) return y.pts - x.pts;
    if (tb === 'gd') {
      if (y.gd !== x.gd) return y.gd - x.gd;
      if (y.gf !== x.gf) return y.gf - x.gf;
    } else {
      if (y.gav !== x.gav) return y.gav > x.gav ? 1 : -1;
    }
    return x.team.localeCompare(y.team);
  });

  // Teams level on every criterion share a position number.
  table.forEach((r, i) => {
    const prev = table[i - 1];
    const tied = prev && prev.pts === r.pts && (tb === 'gd'
      ? prev.gd === r.gd && prev.gf === r.gf
      : prev.gav === r.gav);
    r.pos = tied ? prev.pos : i + 1;
  });
  return table;
}

/** Notes to show with a season's tables on a date: season notes plus any events already in effect. */
export function seasonNotes(seasonData, date) {
  const d = toDateNum(date);
  return [
    ...(seasonData.notes || []),
    ...(seasonData.events || []).filter((e) => e.date <= d).map((e) => e.note),
  ];
}

/** The division a team played in during a season, or null if they're not in this data. */
export function teamDivision(seasonData, teamIdx) {
  for (const [, div, h, a] of seasonData.matches) {
    if (h === teamIdx || a === teamIdx) return div;
  }
  return null;
}

/**
 * Most recent match for a team on or before `date` (includeDate) or strictly before it.
 * Returns { date, divisionId, home, away, homeGoals, awayGoals, venue: 'H'|'A', outcome: 'W'|'D'|'L' } or null.
 */
export function lastResult(seasonData, teamIdx, date, { includeDate = true } = {}) {
  const d = toDateNum(date);
  let found = null;
  for (const m of seasonData.matches) {
    const [md, div, h, a, hg, ag] = m;
    if (includeDate ? md > d : md >= d) break; // matches are date-sorted
    if (h === teamIdx || a === teamIdx) found = m;
  }
  if (!found) return null;
  const [md, div, h, a, hg, ag] = found;
  const venue = h === teamIdx ? 'H' : 'A';
  const forG = venue === 'H' ? hg : ag;
  const agG = venue === 'H' ? ag : hg;
  return {
    date: md,
    divisionId: div,
    home: seasonData.teams[h],
    away: seasonData.teams[a],
    homeGoals: hg,
    awayGoals: ag,
    venue,
    outcome: forG > agG ? 'W' : forG < agG ? 'L' : 'D',
  };
}

/** "1st", "2nd", "23rd" … */
export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
}
