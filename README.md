# Bombe și Petarde

Joc multiplayer de tip arenă cu bombe, în browser, cu temă de Revelion românesc.
Phaser 3 + TypeScript + Vite, server autoritar Colyseus.

## Structură

```
shared/   logica jocului, TypeScript pur (fără Phaser/DOM), deterministă, testată cu vitest
client/   Phaser 3 + Vite; randează starea și trimite input-uri printr-un GameTransport
server/   server Colyseus autoritar care rulează aceeași simulare (vezi server/README.md)
```

## Logica jocului (`/shared`)

- Simulare pe tick-uri fixe (20/s), deterministă: RNG cu seed (mulberry32) ținut în stare,
  fără `Date.now()` / `Math.random()`. Același seed + aceleași input-uri = aceeași stare.
- Starea e plată (`GameState`): grid ca `number[]`, jucători ca `Record<id, PlayerState>`,
  bombe, flăcări și power-up-uri ca array-uri. Se mapează direct pe `@colyseus/schema`.
- Jucătorii influențează jocul doar prin `applyInput(state, { playerId, action })`:
  direcția rămâne ținută până se schimbă, iar apăsarea pe bombă e memorată și consumată
  la tick-ul următor. `step(state)` avansează un tick și întoarce evenimente (pentru sunete/efecte).
- Reguli: explozii în cruce oprite de ziduri, lanț de bombe (kill-urile din lanț merg la cel
  care l-a declanșat), power-up-uri (bombă, rază, viteză), harta se strânge în spirală după
  2 minute, victorie de rundă +3, kill +1, sinucidere -1; egal dacă mor toți simultan.
- Lobby: cod de room de 6 caractere, max 6 jucători, host transferat la plecare (niciodată unui bot),
  intrare doar în lobby, 3/5/7 runde, minim 2 jucători (boții se numără).
- Cine iese definitiv în timpul meciului moare fără să dea kill cuiva și rămâne în clasament
  ("a ieșit") până la întoarcerea în lobby.
- Boți (`botDecide`): fug din zonele de explozie, sparg ziduri, pun bombe lângă jucători.
  `botThink` întoarce aceeași decizie plus intenția (fuge/sparge/atacă/bonus) și drumul planificat.

## Client (`/client`)

- Scene: intro → nickname → meniu → lobby → joc (+ `UiScene` deasupra tuturor: mute și fullscreen).
  - Intro: butonul "Intră" pornește `audio/intro.ogg` (fallback `.mp3`); dacă fișierul lipsește, e liniște.
  - Nickname: "Cum te cheamă?" (max 16, salvat în `localStorage`); cu un nume salvat doar
    "Salut, {nume}!" cu "Continuă" / "Schimbă numele".
  - Meniu: două carduri, "Creează joc" și "Intră la un prieten" (codul în 6 căsuțe: focus automat
    pe următoarea, Backspace înapoi, paste pentru tot codul sau chiar linkul, fără 0/O/1/I/L;
    intră singur la 6 caractere valide), plus "Joacă offline cu boți" ca opțiune secundară.
    Erori în română: cod inexistent, room plin, meci în desfășurare, server plin, server indisponibil;
    când serverul nu răspunde, butonul "Joacă offline cu boți" apare evidențiat chiar sub mesaj.
  - Lobby: codul, "Copiază link" (`/?room=COD`), jucătorii cu culori și coroniță la host;
    hostul alege 3/5/7 runde, adaugă/scoate boți și pornește meciul (minim 2 jucători).
  - `?room=COD` duce, după intro și nickname ("Intri în camera COD"), direct în joc.
  - Fullscreen: butonul de lângă mute sau tasta `F` (ascuns unde browserul nu are fullscreen).
  - După meci, `Enter` întoarce în lobby (același room).
- Room-urile vin din `client/src/net/rooms.ts`: "Creează room" și "Intră cu cod" merg pe server,
  "Joacă offline cu boți" rulează totul în browser.
- Scenele citesc starea și trimit input-uri doar prin `GameTransport` (`client/src/net`).
  `LocalTransport` rulează simularea din `/shared` în browser, cu boți; `ColyseusTransport` joacă
  într-un room de pe server (starea vine prin patch-uri, efectele sunt redate la tick-ul lor).
- Reconectare: la o cădere de rețea apare "Se reconectează..." și jocul continuă (serverul păstrează
  locul 15 s); un reload al paginii te duce înapoi direct în room. Dacă nu se mai poate, revii în meniu.
- Input-ul vine dintr-un `InputSource` (`client/src/input`); acum tastatură: săgeți/WASD + Spațiu.
- Jucătorii sunt interpolați între ultimele două tick-uri; grafica e desenată procedural la pornire.
- Punctele câștigate sau pierdute apar deasupra jucătorului (+1 kill, +3 rundă, −1 propria petardă);
  regulile de punctaj sunt scrise și în lobby.
- La prima rundă jucată apare jos, câteva secunde, "Săgeți / WASD = mișcare · Spațiu = petardă".
- În modul spectator, "Părăsește meciul" (sau `Esc`) cere confirmare; rămâi în clasament ca "a ieșit".
- La moarte: artificii în culoarea jucătorului, "Ai murit!" cu cauza, apoi mod spectator;
  în HUD morții apar tăiați până la runda următoare.
- În pauza dintre runde se vede deja harta nouă, estompată, cu clasamentul peste ea
  (harta e generată de `prepareRound` când începe pauza).
- `P` pune pauză simulării locale (doar offline).
  `Enter` când mai trăiesc doar boți: hostul sare peste rundă (simulează instant până la final).

Opțiuni de test din URL: `?debug`, `?bots=1..5` (implicit 3), `?rounds=3|5|7`, `?seed=abc`.
Oricare dintre ele sare peste intro, meniu și lobby și pornește direct un meci local;
acolo `Enter` la final pornește imediat alt meci.
Modul `?debug` afișează gridul cu coordonate, hitbox-urile (celula de sub centrul jucătorului),
zonele de pericol, tick-ul, FPS-ul și intenția + drumul fiecărui bot.

## Rulare locală

Necesită Node ≥ 22.12.

```bash
npm install
npm run dev        # client pe http://localhost:5173 + server Colyseus pe :2567
npm test           # testele din /shared și ale serverului
npm run typecheck
```

## Build

```bash
npm run build      # build static în client/dist + server/dist/index.js (un singur fișier)
```

Endpoint-ul serverului se configurează prin `VITE_SERVER_URL` (vezi `client/.env.example`):
implicit `/colyseus` pe același domeniu, gol = build doar offline.
Deploy pe VPS (systemd + Caddy, https://bombe-petarde.duckdns.org): `deploy/README.md`;
actualizare de pe Windows cu `.deploypush.ps1`.
