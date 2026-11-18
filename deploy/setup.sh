#!/usr/bin/env bash
# Prima instalare Bombe și Petarde pe VPS (Ubuntu). Rulează pe server, din folderul deploy/ copiat acolo:
#   sudo bash /tmp/bombe-deploy/setup.sh
# Idempotent: îl poți rula de mai multe ori. Atinge doar ce ține de bombe (user-ul bombe, /opt/bombe,
# /var/www/bombe, /var/lib/bombe, bombe.service, bombe-backup.{service,timer}, /usr/local/sbin/bombe-backup
# și blocul bombe-petarde.duckdns.org din Caddyfile); celelalte site-uri
# și servicii (ex. cabina-api, /var/www/cabina, tren-api.duckdns.org) rămân neatinse.
# Codul jocului NU vine de aici: îl pune deploy/push.ps1 (de pe Windows), care îl și pornește.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Rulează cu sudo: sudo bash $0" >&2; exit 1; fi
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DOMAIN=bombe-petarde.duckdns.org
APP_USER=bombe
BASE=/opt/bombe
WEB=/var/www/bombe
UNIT=bombe
UNIT_FILE=/etc/systemd/system/$UNIT.service
BACKUP_UNIT=bombe-backup
BACKUP_SCRIPT=/usr/local/sbin/bombe-backup
STATE=/var/lib/bombe
CADDYFILE=/etc/caddy/Caddyfile
NODE_MAJOR=22

say() { printf '\n==> %s\n' "$*"; }
warn() { printf '\n!!! %s\n' "$*" >&2; }
die() { printf '\nEROARE: %s\n' "$*" >&2; exit 1; }

for f in "$HERE/bombe.service" "$HERE/Caddyfile" "$HERE/bombe-backup.service" "$HERE/bombe-backup.timer" "$HERE/bombe-backup.sh"; do
  [ -f "$f" ] || die "Lipsește $f. Copiază pe server tot folderul deploy/ (vezi deploy/README.md)."
done
command -v apt-get >/dev/null || die "Scriptul e pentru Ubuntu/Debian (apt-get)."

# 1. Node 22 în /usr/bin/node (calea din bombe.service)
node_major() { /usr/bin/node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
say "Verific Node.js"
if [ "$(node_major)" -ge "$NODE_MAJOR" ]; then
  echo "Node $(/usr/bin/node -v) în /usr/bin/node: ok"
else
  say "Instalez Node.js $NODE_MAJOR din depozitul NodeSource"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gpg >/dev/null
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null
  [ "$(node_major)" -ge "$NODE_MAJOR" ] || die "Node $NODE_MAJOR nu s-a instalat în /usr/bin/node."
  echo "Instalat: Node $(/usr/bin/node -v)"
fi

# 2. User de sistem și directoare
say "User și directoare"
if id "$APP_USER" >/dev/null 2>&1; then
  echo "user-ul $APP_USER există deja"
else
  useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"
  echo "am creat user-ul $APP_USER"
fi
# Codul aparține lui root; serviciul îl poate doar citi.
install -d -o root -g root -m 755 "$BASE" "$BASE/releases"
# /var/www/bombe e un symlink către versiunea activă a clientului (îl comută push.ps1 odată cu serverul).
if [ -L "$WEB" ]; then
  echo "$WEB -> $(readlink "$WEB")"
else
  if [ -e "$WEB" ]; then
    moved="$WEB.old-$(date +%Y%m%d-%H%M%S)"
    mv "$WEB" "$moved"
    warn "$WEB era un folder obișnuit; l-am mutat în $moved"
  fi
  install -d -o root -g root -m 755 "$(dirname "$WEB")"
  ln -s "$BASE/current/client" "$WEB"
  echo "$WEB -> $BASE/current/client"
fi

# 3. systemd
say "Serviciul systemd $UNIT"
unit_changed=0
if ! cmp -s "$HERE/bombe.service" "$UNIT_FILE"; then
  install -o root -g root -m 644 "$HERE/bombe.service" "$UNIT_FILE"
  unit_changed=1
  echo "am instalat $UNIT_FILE"
fi
systemctl daemon-reload
systemctl enable "$UNIT" >/dev/null 2>&1
if [ -f "$BASE/current/server/index.js" ]; then
  # Un restart pierde room-urile în curs: doar dacă unit-ul s-a schimbat.
  if [ "$unit_changed" = 1 ]; then systemctl restart "$UNIT"; else systemctl start "$UNIT"; fi
  sleep 2
  if curl -fsS http://127.0.0.1:2567/health; then echo; else warn "Serverul nu răspunde. Vezi: journalctl -u $UNIT -n 50 --no-pager"; fi
else
  echo "Încă nu e nicio versiune instalată: serviciul pornește la primul deploy/push.ps1."
fi

# 4. Backup zilnic al clasamentului (/var/lib/bombe/leaderboard.db -> /var/lib/bombe/backups, ultimele 7 zile).
# Baza o creează serverul la pornire, în StateDirectory (al user-ului bombe); deploy-ul și rollback-ul
# lucrează doar în /opt/bombe, deci nu o ating niciodată.
say "Backup zilnic al clasamentului"
if ! command -v sqlite3 >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq sqlite3 >/dev/null
  echo "am instalat sqlite3"
fi
# Scriptul vine poate de pe Windows: fără CRLF.
tr -d '\r' < "$HERE/bombe-backup.sh" > "$BACKUP_SCRIPT.tmp"
install -o root -g root -m 755 "$BACKUP_SCRIPT.tmp" "$BACKUP_SCRIPT"
rm -f "$BACKUP_SCRIPT.tmp"
for f in "$BACKUP_UNIT.service" "$BACKUP_UNIT.timer"; do
  install -o root -g root -m 644 "$HERE/$f" "/etc/systemd/system/$f"
done
systemctl daemon-reload
systemctl enable --now "$BACKUP_UNIT.timer" >/dev/null 2>&1
echo "$BACKUP_UNIT.timer: $(systemctl show "$BACKUP_UNIT.timer" --property=NextElapseUSecRealtime --value)"
if [ -d "$STATE" ]; then ls -la "$STATE"; fi

# 5. Caddy: blocul pentru domeniu, doar dacă lipsește
say "Caddy ($DOMAIN)"
command -v caddy >/dev/null || die "Caddy nu e instalat (pe acest VPS ar trebui să existe deja, pentru celelalte site-uri)."
[ -f "$CADDYFILE" ] || die "Nu găsesc $CADDYFILE."

# Validează cu variabilele de mediu ale serviciului caddy (alte site-uri pot folosi {$VAR}).
validate_caddy() (
  set -a
  for f in $(systemctl show caddy --property=EnvironmentFiles --value | grep -o '/[^ ]*' || true); do
    if [ -r "$f" ]; then . "$f"; fi
  done
  set +a
  # shellcheck disable=SC2046
  env $(systemctl show caddy --property=Environment --value) caddy validate --config "$CADDYFILE" --adapter caddyfile
)

if grep -Eq "^[[:space:]]*(https?://)?$DOMAIN([[:space:]:,{]|\$)" "$CADDYFILE"; then
  echo "Blocul pentru $DOMAIN există deja în $CADDYFILE: nu îl modific."
else
  validate_caddy >/dev/null 2>&1 || die "Caddyfile-ul existent nu trece validarea; nu îl modific. Verifică: sudo caddy validate --config $CADDYFILE"
  backup="$CADDYFILE.bak-$(date +%Y%m%d-%H%M%S)"
  cp -a "$CADDYFILE" "$backup"
  echo "backup: $backup"
  { printf '\n'; cat "$HERE/Caddyfile"; } >> "$CADDYFILE"
  if ! validate_caddy; then
    cp -a "$backup" "$CADDYFILE"
    die "Caddyfile-ul cu blocul nou nu trece validarea; am restaurat backup-ul. Caddy nu a fost reîncărcat."
  fi
  systemctl reload caddy
  echo "Am adăugat blocul pentru $DOMAIN și am reîncărcat Caddy (reload, fără restart)."
fi

cat <<EOF

==> GATA. Ce urmează:
  1. De pe Windows, din repo:  .\\deploy\\push.ps1      (build, upload, pornește serviciul, health check)
  2. DuckDNS: $DOMAIN trebuie să arate spre IP-ul acestui VPS.
  3. Porturile 80 și 443 deschise în Oracle (Security List/NSG) și în iptables. Portul 2567 NU se deschide.
  Clasamentul: $STATE/leaderboard.db; backup manual: sudo systemctl start $BACKUP_UNIT
EOF
