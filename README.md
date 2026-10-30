# League on the Day

A PWA that shows where any English league club stood in the table on any date since 1888, the full tables for every division that season, and the club's most recent result.

## Coverage

| Tier | Seasons | Source |
|---|---|---|
| 1–4 | 1888/89 to now | [Sean Elvidge, England-football-results](https://github.com/seanelvidge/England-football-results) (built on engsoccerdata) |
| 5 | 1999/00 – 2018/19 | [James Curley, engsoccerdata](https://github.com/jalapic/engsoccerdata) |
| 6 (North/South) | 2012/13 – 2018/19 | engsoccerdata |

Tables are calculated from results using the rules of the time: 2 points for a win until 1980/81, goal average until 1975/76 then goal difference. Points deductions are not modelled. Expunged records (Wigan Borough 1931, Accrington Stanley 1962) and Leeds City's 1919 takeover by Port Vale are applied from the date they happened.

## Data

```sh
npm run data   # download the CSVs into data-raw/ and rebuild data/
```

The build writes `data/index.json` (seasons and clubs) and one `data/seasons/YYYY-YYYY.json` per season. Re-run it to pick up new results for the current season.

## Develop

```sh
npm start      # static server on :8080
npm test
```

The version number appears in `package.json`, `src/app.js`, `sw.js` and `index.html`; the tests check they match.
