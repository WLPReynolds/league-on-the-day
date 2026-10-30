#!/bin/sh
# Downloads the raw results CSVs into data-raw/ (git-ignored).
set -e
mkdir -p data-raw
curl -fsSL -o data-raw/EnglandLeagueResults.csv \
  https://raw.githubusercontent.com/seanelvidge/England-football-results/main/EnglandLeagueResults.csv
curl -fsSL -o data-raw/england_nonleague.csv \
  https://raw.githubusercontent.com/jalapic/engsoccerdata/master/data-raw/england_nonleague.csv
echo "Downloaded to data-raw/"
