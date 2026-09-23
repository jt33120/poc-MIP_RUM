#!/usr/bin/env bash
# Générateur de logs firewall SYNTHÉTIQUES (zéro donnée sensible) au format
# syslog RFC5424, envoyés en UDP au collecteur OTel. Débit réglable via RATE
# (logs/seconde) — monte-le pour éprouver le sizing ClickHouse vs OpenSearch.
#
# Perf : socket UDP persistant (builtin bash /dev/udp) + timestamp via `printf -v`
# — AUCUN fork nc/date par message, pour tenir des débits élevés sans plafonner.
set -u
RATE="${RATE:-50}"
TARGET="${TARGET:-otel-collector}"
PORT="${PORT:-54526}"

APPS=(firewalld routerd switchd vpnd ids)
ACTIONS=(ACCEPT DROP REJECT)
PROTOS=(TCP UDP ICMP)
delay=$(awk "BEGIN{ printf \"%.5f\", 1/$RATE }")

# Ouvre un socket UDP persistant sur le fd 3 (chaque write = 1 datagramme).
exec 3<>"/dev/udp/${TARGET}/${PORT}" || { echo "loadgen: échec ouverture UDP ${TARGET}:${PORT}" >&2; exit 1; }

echo "loadgen: ${RATE} msg/s -> ${TARGET}:${PORT} (syslog RFC5424 / UDP)"
while true; do
  sev=$(( RANDOM % 8 ))
  pri=$(( 128 + sev ))                         # facility 16 (local0) * 8 + sévérité
  printf -v ts '%(%Y-%m-%dT%H:%M:%S)T' -1      # builtin bash, pas de fork `date`
  host="gw-$(( RANDOM % 20 ))"
  app="${APPS[$(( RANDOM % ${#APPS[@]} ))]}"
  proc=$(( RANDOM % 30000 ))
  src="10.0.$(( RANDOM % 256 )).$(( RANDOM % 256 ))"
  dst="10.1.$(( RANDOM % 256 )).$(( RANDOM % 256 ))"
  proto="${PROTOS[$(( RANDOM % ${#PROTOS[@]} ))]}"
  action="${ACTIONS[$(( RANDOM % ${#ACTIONS[@]} ))]}"
  bytes=$(( RANDOM * 4 ))
  # <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID SD MSG
  printf '<%s>1 %s.000Z %s %s %s - - src=%s dst=%s proto=%s action=%s bytes=%s\n' \
    "$pri" "$ts" "$host" "$app" "$proc" "$src" "$dst" "$proto" "$action" "$bytes" >&3
  sleep "$delay"
done
