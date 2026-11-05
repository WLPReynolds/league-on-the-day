#!/bin/sh
# Downloads the raw results CSVs into data-raw/ (git-ignored).
set -e
mkdir -p data-raw/fd
curl -fsSL -o data-raw/EnglandLeagueResults.csv \
  https://raw.githubusercontent.com/seanelvidge/England-football-results/main/EnglandLeagueResults.csv
curl -fsSL -o data-raw/england_nonleague.csv \
  https://raw.githubusercontent.com/jalapic/engsoccerdata/master/data-raw/england_nonleague.csv
# National League from 2019/20 (football-data.co.uk), one file per season up to the current one.
year=$(date -u +%Y); month=$(date -u +%m)
[ "$month" -lt 7 ] && year=$((year - 1))
y=2019
while [ "$y" -le "$year" ]; do
  code=$(printf '%02d%02d' $((y % 100)) $(((y + 1) % 100)))
  curl -fsSL -A "league-on-the-day" -o "data-raw/fd/EC_$code.csv" "https://www.football-data.co.uk/mmz4281/$code/EC.csv" \
    || echo "No National League file for $code yet"
  y=$((y + 1))
done
echo "Downloaded to data-raw/"
