#!/usr/bin/env bash
# Restarts the web dev server whenever it stops.
#
# Something on this machine kills `next dev` by process name — another project's
# tooling reaching for its own server and matching ours too. The symptom is a
# white page that reloads for ever, because the browser is retrying a port with
# nothing behind it. Until that is fixed at the source, this brings it back.
cd "$(dirname "$0")/.."
LOG="${WEB_LOG:-/tmp/healthemr-web.log}"
while true; do
  echo "[keep-web-up] starting at $(date '+%H:%M:%S')" >> "$LOG"
  npm run dev >> "$LOG" 2>&1
  echo "[keep-web-up] exited at $(date '+%H:%M:%S') — restarting in 2s" >> "$LOG"
  sleep 2
done
