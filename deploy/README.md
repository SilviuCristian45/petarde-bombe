# Deploy pe VPS-ul Oracle

Jocul rulează la **https://bombe-petarde.duckdns.org**, pe VPS-ul Oracle (Ubuntu, user `ubuntu`, alias SSH
`oracle`), lângă jocul cu trenul. Scripturile ating doar ce ține de bombe:

| Ce | Unde |
|---|---|
| user de sistem | `bombe` |
| versiunile | `/opt/bombe/releases/<data-ora>/` (`server/index.js`, `client/`, `VERSION`) |
| versiunea activă / anterioară | symlink-urile `/opt/bombe/current` și `/opt/bombe/current.prev` |
| clientul servit de Caddy | `/var/www/bombe` → `/opt/bombe/current/client` |
| serviciul | `bombe.service` (Node pe `127.0.0.1:2567`, `MemoryMax=300M`, `Restart=always`) |
| clasamentul | `/var/lib/bombe/leaderboard.db` (SQLite, WAL; `StateDirectory` al user-ului `bombe`) |
| backup-ul clasamentului | `bombe-backup.timer` zilnic → `/var/lib/bombe/backups/leaderboard-AAAALLZZ.db`, ultimele 7 |
| Caddy | blocul `bombe-petarde.duckdns.org` din `/etc/caddy/Caddyfile` |

Trenul (`cabina-api`, `/var/www/cabina`, blocul `tren-api.duckdns.org`) nu e atins.

Fișiere:

- `setup.sh`: instalarea inițială, pe VPS (o singură dată; poate fi rulat din nou fără efecte nedorite);
- `push.ps1`: actualizare de pe Windows (build, upload, comutare atomică, health check, rollback);
- `remote-update.sh`: partea de pe server a lui `push.ps1` (o urcă și o rulează el);
- `bombe.service`, `Caddyfile`: unit-ul systemd și blocul Caddy, instalate de `setup.sh`;
- `bombe-backup.service`, `bombe-backup.timer`, `bombe-backup.sh`: backup-ul zilnic al clasamentului,
  instalate tot de `setup.sh` (scriptul ajunge în `/usr/local/sbin/bombe-backup`).

## Înainte de prima instalare

- DuckDNS: `bombe-petarde` arată spre IP-ul VPS-ului.
- Porturile 80 și 443 sunt deja deschise (le folosește și trenul). Portul 2567 **nu** se deschide.
- `ssh oracle` merge din PowerShell (alias în `~/.ssh/config`).

## Prima instalare

Din PowerShell, în rădăcina repo-ului:

```powershell
ssh oracle "rm -rf /tmp/bombe-deploy"
scp -r deploy oracle:/tmp/bombe-deploy
ssh oracle "sudo bash /tmp/bombe-deploy/setup.sh"
.\deploy\push.ps1
```

`setup.sh`:

1. verifică Node 22 în `/usr/bin/node`; dacă lipsește (sau e mai vechi), îl instalează din depozitul NodeSource;
2. creează user-ul `bombe`, `/opt/bombe/releases` și symlink-ul `/var/www/bombe`;
3. instalează și activează `bombe.service` (îl repornește doar dacă unit-ul s-a schimbat);
4. instalează `sqlite3` (dacă lipsește) și backup-ul zilnic al clasamentului (`bombe-backup.timer`):
   `sqlite3 .backup`, deci o copie consistentă chiar dacă serverul scrie în acel moment, verificată cu
   `integrity_check`; se păstrează ultimele 7 zile;
5. dacă `/etc/caddy/Caddyfile` nu conține încă `bombe-petarde.duckdns.org`: validează configurația existentă,
   face un backup cu dată și oră (`Caddyfile.bak-AAAALLZZ-HHMMSS`), adaugă blocul, validează din nou
   (dacă pică, restaurează backup-ul și se oprește), apoi `systemctl reload caddy` (fără restart: trenul
   nu are nicio întrerupere).

Primul `push.ps1` urcă prima versiune și pornește serviciul. Primul health check public poate dura câteva
secunde, cât Caddy ia certificatul HTTPS.

## Actualizări

```powershell
.\deploy\push.ps1            # deploy
.\deploy\push.ps1 -WhatIf    # testele, build-ul și arhiva local + comenzile care s-ar rula; serverul nu e atins
.\deploy\push.ps1 -Rollback  # revine la versiunea anterioară, fără build
```

Parametri ca la tren: `-Server` (implicit `oracle`), `-User`, `-Key`, `-WhatIf`; fără alias:
`.\deploy\push.ps1 -Server 203.0.113.10 -Key C:\cale\cheie` (user implicit `ubuntu`).

Ce face un deploy:

1. avertizează dacă ai modificări necomise (nu se oprește);
2. rulează local `npm test`, `npm run typecheck`, `npm run build` și se oprește la prima eroare;
3. pune `server/dist/index.js` și `client/dist/` (plus `VERSION`: commit și oră) într-un `release.tar.gz`;
4. îl copiază cu `scp`, împreună cu `remote-update.sh` (fără CRLF), în `/tmp/bombe-push`;
5. pe server: despachetează într-o versiune nouă, mută `current.prev` pe versiunea activă și comută
   `current` pe cea nouă printr-o singură redenumire de symlink (serverul și clientul se schimbă împreună,
   nimeni nu vede un site pe jumătate actualizat), apoi repornește `bombe` și așteaptă
   `http://127.0.0.1:2567/health`;
6. de pe Windows verifică `https://bombe-petarde.duckdns.org/colyseus/health`.

Dacă oricare health check pică, revine automat la versiunea anterioară: versiunea nouă e ștearsă și
`current.prev` rămâne cum era. Pe server se păstrează versiunea activă, cea anterioară și încă trei.

Un restart pierde room-urile în curs, deci actualizează când nu se joacă nimeni.

Deploy-ul și rollback-ul lucrează doar în `/opt/bombe`: baza clasamentului (`/var/lib/bombe`) nu e
atinsă niciodată. După o modificare a lui `bombe.service` sau a backup-ului, rulează din nou `setup.sh`
(`push.ps1` nu instalează unit-uri). Backup manual: `sudo systemctl start bombe-backup`; restaurare:
`sudo systemctl stop bombe`, copiază backup-ul peste `leaderboard.db` (șterge `-wal`/`-shm`, păstrează
owner-ul `bombe`), `sudo systemctl start bombe`.

## Util

```powershell
ssh oracle "journalctl -u bombe -n 50 --no-pager"     # loguri
ssh oracle "cat /opt/bombe/current/VERSION"           # ce versiune rulează
ssh oracle "curl -s http://127.0.0.1:2567/health"
```
