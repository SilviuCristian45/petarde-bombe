# /server — plan Colyseus

Deocamdată gol. Serverul multiplayer va fi implementat într-o etapă ulterioară.

## Țintă de deploy

- VPS Oracle free tier (≈1 GB RAM, CPU minim), împărțit cu un alt proiect (Flask + Caddy).
- Un singur proces Node, fără Docker, Redis sau bază de date. Room-urile trăiesc doar în memorie.
- Colyseus (ultima versiune stabilă) pe `localhost:2567`.
- Serviciu systemd cu `MemoryMax=300M`, `Restart=on-failure`.
- Caddy pe 443, subdomeniu separat (ex. `bombe.duckdns.org`):
  - servește build-ul static din `client/dist`;
  - `reverse_proxy /colyseus/* localhost:2567` (cu `handle_path`, ca prefixul să fie eliminat).

## Arhitectură

- `GameRoom extends Room<RoomState>`:
  - `onCreate`: generează codul de 6 caractere (din `@petarde/shared`) și îl folosește ca `roomId`;
    `setSimulationInterval(() => step(...), 1000 / TICK_RATE)`.
  - Simularea este exact `step()` din `/shared`. Rezultatul e copiat în `@colyseus/schema`:
    - `players: MapSchema<PlayerSchema>`
    - `grid: ArraySchema<uint8>`
    - `bombs`, `flames`, `powerups: ArraySchema<...>`
  - `onMessage('input', ...)` → `{ playerId: client.sessionId, action }` pus în coada de input-uri.
  - `onJoin`: refuzat dacă faza nu e `lobby` sau dacă room-ul are 6 jucători (`maxClients = 6`).
  - Host = primul intrat; la plecarea lui, devine host următorul jucător.
  - `onLeave(client, consented)`: dacă `!consented`, jucătorul e marcat `reconnecting`
    și se apelează `allowReconnection(client, 15)`; altfel e eliminat.
  - Boți: aceeași logică din `/shared/bot`, rulată pe server pentru completarea room-urilor.
  - `onMessage('skipRound', ...)`: permis doar hostului și doar când toți jucătorii umani sunt morți
    (`onlyBotsAlive(state)` din `/shared`); serverul simulează instant până la finalul rundei și
    trimite doar rezultatul (`roundEnd` / `matchEnd`), ca `LocalTransport.skipRound`.
- Clientul folosește `ColyseusTransport` (colyseus.js), care implementează interfața `GameTransport`
  din `client/src/net`, cu endpoint din `VITE_SERVER_URL`. Scenele nu se schimbă.
