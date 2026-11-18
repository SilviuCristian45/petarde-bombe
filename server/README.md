# /server — serverul Colyseus

Server autoritar pentru jocul online. Rulează exact simularea din `/shared`; clienții trimit doar
intenții (direcție, petardă, acțiuni de lobby) și primesc starea înapoi.

## Rulare

Din rădăcina repo-ului:

```bash
npm run dev          # client (Vite, :5173) + server (tsx watch, :2567) împreună
npm run dev:server   # doar serverul
npm test -w server   # testele room-ului (@colyseus/testing)
npm run build -w server   # typecheck + dist/index.js (un singur fișier)
```

În dev, Vite face proxy pe `/colyseus` (HTTP + WebSocket) către `127.0.0.1:2567` și taie prefixul,
exact ca în producție Caddy.

Variabile de mediu: `PORT` (implicit 2567), `HOST` (implicit `127.0.0.1`, doar loopback),
`MAX_ROOMS` (implicit 20).

## Arhitectură

- Pachete: `@colyseus/core` + `@colyseus/ws-transport` + `@colyseus/schema` 5 (fără meta-pachetul
  `colyseus`, care aduce auth/monitor/Redis). Clientul folosește `@colyseus/sdk` 0.18.
- `src/BombeRoom.ts`, singurul tip de room (`bombe`):
  - `onCreate`: refuză cu „Serverul e plin” (cod `4001`) peste `MAX_ROOMS`; generează codul de 6 caractere
    (verificat să nu fie deja folosit) și îl pune ca `roomId`, deci clientul intră cu `joinById(cod)`.
    `maxClients = 6`, `patchRate` 50 ms (20 Hz), `autoDispose`.
  - La fiecare tick (20/s, `setTimestep`): input-urile din coadă, boții, `step()` (prin `runTick` din
    `/shared`, același cod ca `LocalTransport`), apoi `mirror()` copiază starea în schema.
    Evenimentele tick-ului (explozii, morți...) pleacă separat, ca mesajul `events`: `{ tick, events }`.
    Clientul le redă abia când starea lui a ajuns la acel tick, așa că efectele nu apar înaintea sau
    după bombă dacă mesajul și patch-ul sosesc în ordine diferită.
  - Schema (`src/schema.ts`): `MapSchema` pentru jucători, `ArraySchema<uint8>` pentru grid, array-uri
    pentru bombe/flăcări/power-up-uri. `rng`, `nextId`, `joinCounter`, `bombPressed` rămân doar pe server.
    `mirror()` scrie doar valorile schimbate; simularea nu citește niciodată schema (determinismul rămâne
    în `GameState`).
  - Room-ul e blocat (`lock()`) la Start și deblocat la întoarcerea în lobby.
- Validare pe server:
  - fiecare client controlează doar jucătorul lui (id-ul vine din conexiune, nu din mesaj);
  - input-urile sunt acceptate doar în faza `playing`, doar acțiuni cunoscute, maxim 30/s (restul ignorate);
    peste 60 de mesaje/s clientul e deconectat;
  - nickname curățat (`sanitizeName`: trim, max 16, fără caractere de control/invizibile);
  - doar hostul: Start, runde, +Bot/-Bot (doar în lobby), întoarcerea în lobby, `skipRound`
    (doar când toți oamenii sunt morți, `onlyBotsAlive`). Hostul care pleacă e înlocuit de următorul
    om (conectat), niciodată de un bot.
- Reconectare: la o cădere (`onDrop`) jucătorul rămâne pe loc 15 s (`allowReconnection`), marcat
  deconectat. Plecarea definitivă (`onLeave`) îl scoate din lobby; în meci moare fără kill acordat și
  rămâne în clasament (cu „a ieșit”) până la lobby (`leavePlayer` din `/shared`).
- Rute HTTP (`src/app.ts`):
  - `GET /health` → `{ ok, rooms, maxRooms, uptime }`;
  - `GET /rooms/:code` → `{ status: "open" | "full" | "playing" | "missing" }`. Colyseus răspunde la fel
    („locked”) pentru room plin și meci în desfășurare; clientul întreabă aici ca să afișeze mesajul corect.
- Coduri de eroare (în `shared/src/protocol.ts`): `4001` server plin, `4002` room plin (boții ocupă și ei
  locuri), `4003` meci în desfășurare.

## Prefixul `/colyseus`

`new Client("https://bombe-petarde.duckdns.org/colyseus")` din `@colyseus/sdk` păstrează calea atât pentru
matchmaking (`POST /colyseus/matchmake/...`), cât și pentru WebSocket (`/colyseus/<processId>/<roomId>`),
cu condiția ca serverul să **nu** seteze `publicAddress` (nu îl setăm). Caddy cu `handle_path` taie prefixul,
deci serverul vede `/matchmake/...`. Verificat în dev prin proxy-ul Vite, care face același lucru.

## Deploy

Ținta: VPS Oracle free tier (~1 GB RAM), împărțit cu alt proiect (Flask + Caddy). Un singur proces Node,
fără Docker, Redis sau bază de date; room-urile trăiesc în memorie. Fișierele sunt în `server/deploy/`:

- `bombe.service`: unit systemd (user dedicat `bombe`, `MemoryMax=300M`, `Restart=always`, `PORT=2567`,
  hardening de bază);
- `Caddyfile`: blocul pentru subdomeniu (`handle_path /colyseus/*` → `127.0.0.1:2567`, restul servește
  `client/dist`).

Domeniul: `bombe-petarde.duckdns.org` (în DuckDNS trebuie să arate spre IP-ul VPS-ului; porturile
80 și 443 deschise în Security List-ul Oracle și în firewall-ul VPS-ului, ca să poată Caddy să ia certificatul).

Pe VPS e nevoie doar de Node ≥ 22.12 și Caddy. Fără `npm install`, fără `node_modules`.

1. Build local, din rădăcina repo-ului:
   ```bash
   npm ci
   npm test
   npm run build            # client/dist/ + server/dist/index.js
   ```
   `VITE_SERVER_URL` rămâne implicit `/colyseus` (același domeniu), deci nu e nevoie de `.env`.
   Pe VPS ajung doar:
   - `server/dist/index.js`: serverul complet (`/shared` și toate dependențele incluse);
     `index.js.map` nu e necesar;
   - `client/dist/` (tot folderul): `index.html` + `assets/`;
   - `server/deploy/bombe.service` și `server/deploy/Caddyfile`.
2. Copiază (de pe mașina locală, din rădăcina repo-ului; înlocuiește `<IP>` cu adresa VPS-ului):
   ```bash
   ssh ubuntu@<IP> "rm -rf /tmp/bombe && mkdir -p /tmp/bombe"
   scp server/dist/index.js server/deploy/bombe.service server/deploy/Caddyfile ubuntu@<IP>:/tmp/bombe/
   scp -r client/dist ubuntu@<IP>:/tmp/bombe/client-dist
   ```
3. Pe VPS, prima dată (user dedicat, directoare, serviciu, Caddy):
   ```bash
   which node && node -v    # dacă nu e /usr/bin/node, pune calea în ExecStart din /tmp/bombe/bombe.service
   sudo useradd --system --no-create-home --shell /usr/sbin/nologin bombe
   sudo mkdir -p /opt/bombe/server/dist /opt/bombe/client
   sudo install -m 0644 /tmp/bombe/bombe.service /etc/systemd/system/bombe.service
   sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak
   sudo tee -a /etc/caddy/Caddyfile < /tmp/bombe/Caddyfile > /dev/null   # o singură dată!
   ```
4. Pe VPS, la fiecare deploy (inclusiv primul):
   ```bash
   sudo install -m 0644 /tmp/bombe/index.js /opt/bombe/server/dist/index.js
   sudo rm -rf /opt/bombe/client/dist && sudo cp -r /tmp/bombe/client-dist /opt/bombe/client/dist
   sudo chmod -R a+rX /opt/bombe
   sudo systemctl daemon-reload
   sudo systemctl enable bombe
   sudo systemctl restart bombe          # room-urile în curs se pierd
   curl -s http://127.0.0.1:2567/health
   sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
   curl -s https://bombe-petarde.duckdns.org/colyseus/health
   ```

Loguri: `journalctl -u bombe -f`.
