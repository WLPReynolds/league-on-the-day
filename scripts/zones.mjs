// Promotion, play-off, relegation, re-election and European places for each division, by season.
//
// zones(y, tier, n) -> {
//   up        clubs promoted automatically (top places)
//   po        [from, to] play-off places for promotion, or null
//   poDown    1986/87 and 1987/88: the place in the division above that joined the play-offs
//   down      clubs relegated automatically (bottom places)
//   reelect   bottom places that had to apply for re-election to the League
//   testTop / testBottom   1892/93–1897/98 test-match places
//   eu        top flight only: { cl, el, ecl } places by league position (standard allocation;
//             cup winners and holders can change who actually qualifies)
// }
// y is the first year of the season (1986 = 1986/87); n is the number of clubs in the division.
// Checked against which clubs actually moved each season; see the README for the exceptions.
export function zones(y, tier, n) {
  const z = { up: 0, po: null, poDown: null, down: 0, reelect: 0, testTop: 0, testBottom: 0, eu: null };
  if (y === 1939) return z; // abandoned after three games

  if (y <= 1891) { z.reelect = 4; return z; }
  if (y <= 1897) { // test matches between the bottom of Division One and the top of Division Two
    if (tier === 1) z.testBottom = y <= 1895 ? 3 : 2;
    if (tier === 2) { z.testTop = y <= 1895 ? 3 : 2; z.reelect = y <= 1893 ? 4 : 3; }
    return z;
  }
  if (y <= 1919) {
    if (tier === 1) z.down = y === 1904 ? 0 : 2; // 1905: League enlarged, no one relegated
    if (tier === 2) { z.up = 2; z.reelect = 3; }
    return z;
  }
  if (y <= 1957) {
    if (tier === 1) z.down = 2;
    if (tier === 2) { z.up = 2; z.down = y === 1920 ? 1 : 2; }
    if (tier === 3) {
      z.up = 1;
      if (y === 1957) z.down = 12; // 1958: bottom halves of North and South formed the Fourth Division
      else z.reelect = 2;
    }
    return z;
  }
  if (y <= 1985) {
    const three = y >= 1973;
    if (tier === 1) z.down = three ? 3 : 2;
    if (tier === 2) { z.up = three ? 3 : 2; z.down = three ? 3 : 2; }
    if (tier === 3) { z.up = three ? 3 : 2; z.down = 4; }
    if (tier === 4) { z.up = 4; z.reelect = 4; }
    return euro(z, y, tier);
  }
  if (y <= 1987) { // first two play-off seasons: one club from the division above joined in
    if (tier === 1) { z.down = 3; z.poDown = n - 3; }
    if (tier === 2) { z.up = 2; z.po = [3, 5]; z.down = 2; z.poDown = n - 2; }
    if (tier === 3) { z.up = 2; z.po = [3, 5]; z.down = 3; z.poDown = n - 3; }
    if (tier === 4) { z.up = 3; z.po = [4, 6]; z.down = 1; }
    if (tier === 5) z.up = 1;
    return euro(z, y, tier);
  }
  // 1988/89 onwards
  if (tier === 1) z.down = 3;
  if (tier === 2) { z.up = 2; z.po = y >= 2026 ? [3, 8] : [3, 6]; z.down = 3; }
  if (tier === 3) { z.up = 2; z.po = [3, 6]; z.down = 4; }
  if (tier === 4) { z.up = 3; z.po = [4, 7]; z.down = y >= 2002 ? 2 : 1; }
  if (tier === 5) {
    z.up = 1;
    if (y >= 2017) z.po = [2, 7];
    else if (y >= 2002) z.po = [2, 5];
    z.down = y >= 2006 ? 4 : 3;
  }
  if (tier === 6) { z.up = 1; z.po = y >= 2017 ? [2, 7] : [2, 5]; z.down = 3; }

  // One-off seasons
  if (y === 1990) { // First Division grew from 20 to 22
    if (tier === 1) z.down = 2;
    if (tier === 2) { z.up = 3; z.po = [4, 7]; z.down = 2; }
    if (tier === 3) { z.up = 3; z.po = [4, 7]; z.down = 3; }
    if (tier === 4) { z.up = 4; z.po = [5, 8]; z.down = 0; }
  }
  if (y === 1991 && tier === 4) z.down = 0; // Aldershot and Maidstone folded; no relegation
  if (y >= 1993 && y <= 1995 && tier === 4) z.down = 0; // Conference champions' grounds not up to standard
  if (y === 1994) { // Premier League cut from 22 to 20
    if (tier === 1) z.down = 4;
    if (tier === 2) { z.up = 1; z.po = [2, 5]; z.down = 4; }
    if (tier === 3) { z.up = 1; z.po = [2, 5]; z.down = 5; }
    if (tier === 4) { z.up = 2; z.po = [3, 6]; }
  }
  if (y === 2019) { // curtailed by Covid; Bury expelled from League One
    if (tier === 3) z.down = 3;
    if (tier === 4) z.down = 1;
  }
  if (tier === 5 && y === 2019) z.down = 3; // curtailed; decided on points per game
  if (tier === 5 && y === 2020) z.down = 0; // National League North/South voided
  if (tier === 5 && y === 2021) z.down = 3; // 23 clubs
  return euro(z, y, tier);
}

/** Top flight: places that qualify for Europe by league position, from 1969/70. */
function euro(z, y, tier) {
  if (tier !== 1 || y < 1969) return z;
  if (y >= 1985 && y <= 1988) return z; // Heysel ban: no English entries
  const cl = y >= 2024 && y <= 2025 ? 5 // England earned a fifth place both seasons
    : y >= 2001 ? 4 : y >= 1999 ? 3 : y >= 1997 ? 2 : 1;
  z.eu = { cl, el: y >= 2009 ? 1 : 0, ecl: y >= 2021 ? 1 : 0 };
  return z;
}

/** What each competition was called, for the season that a table's places lead into. */
export function competitionNames(y) {
  const next = y + 1; // places earned in 1969/70 are for 1970/71
  return {
    EC: next >= 1992 ? 'Champions League' : 'European Cup',
    CWC: "Cup Winners' Cup",
    UEFA: next <= 1970 ? 'Fairs Cup' : next <= 2008 ? 'UEFA Cup' : 'Europa League',
    ECL: 'Conference League',
  };
}
