#!/bin/sh
# Rebuild + redeploy the static site so homepage heat decay, badge TTLs, and
# relative timestamps advance even when no new article publishes (the hourly
# safety-net from HOMEPAGE_PROGRAMMING_PLAN.md §7). Safe to run from cron:
#   0 * * * * /bin/sh "/Users/sivajithcu/Movie News site/site/scripts/refresh-homepage.sh" >> /tmp/screenreport-refresh.log 2>&1
set -e
cd "$(dirname "$0")/.."
set -a
. "../.env"
set +a
npm run build
npx -y wrangler@3 pages deploy out --project-name=thescreenreport --branch=main --commit-dirty=true
