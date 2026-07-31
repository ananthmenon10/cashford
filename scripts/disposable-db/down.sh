#!/usr/bin/env bash
# Tear down the disposable Postgres harness (no volume — all data is gone once this runs).
set -euo pipefail
docker rm -f cashford-disposable-db >/dev/null 2>&1 && echo "removed cashford-disposable-db" || echo "cashford-disposable-db was not running"
