# Bombe și Petarde

Joc multiplayer de tip arenă cu petarde, în browser, cu temă de Revelion românesc: cadouri de spart,
ziduri înzăpezite, luminițe care clipesc pe marginea arenei, zăpadă și artificii. Până la 6 jucători
(oameni sau boți cu nume de colindători) într-un room cu cod; ultimul rămas în viață câștigă runda,
iar cel cu cele mai multe puncte după 3, 5 sau 7 runde câștigă meciul.

Se joacă la **https://bombe-petarde.duckdns.org**. Phaser 3 + TypeScript + Vite, server autoritar Colyseus.

## Cum se joacă

1. **Intră**, alege-ți un nume, apoi **Creează joc** și trimite prietenilor linkul (`Copiază link`,
   pe telefon `Trimite invitația`, direct în WhatsApp & co.) sau codul de 6 caractere. Ei intră cu **Intră la un prieten** sau direct din link.
   Fără internet: **Joacă offline cu boți**.
2. În lobby, hostul (cu coroniță) alege 3/5/7 runde, adaugă boți și apasă **Start** (minim 2 jucători).
   **Nivel boți** (Ușor / Mediu / Greu, implicit Mediu) se aplică boților adăugați după aceea; lângă
   fiecare bot apare nivelul lui, iar hostul îl schimbă cu un clic pe etichetă. Ușor: reacționează
   încet, mai mult sparge cadouri decât vânează, greșește și ezită, dar tot fuge de explozii. Mediu:
   reacție de ~0,2 s, vânează uneori. Greu: decide la fiecare tick și vânează mereu.
3. Fiecare rundă începe cu **3, 2, 1, FOC!**; până la FOC nu se mișcă nimeni.
4. Pune petarde ca să spargi cadourile și să-i prinzi pe ceilalți. Din cadouri pică power-up-uri:
   o petardă în plus, rază mai mare, viteză. După 2 minute arena începe să se strângă în spirală.
5. Punctaj: ultimul în viață **+3**, kill **+1**, propria petardă **−1**. Într-un lanț de petarde,
   kill-ul e al celui care l-a aprins. Dacă mor toți deodată, e egalitate.
6. La final: podium, clasamentul complet și premii (Artificierul, Kamikaze, Supraviețuitorul,
   Spărgătorul de cadouri, Colecționarul). Hostul pornește **Încă un meci** în același room.
7. **Clasament** (din meniu): top 15 all-time, salvat pe server. Intră doar meciurile online cu cel
   puțin 2 jucători umani; contează cel mai bun meci al fiecărei porecle (fără diferență de majuscule),
   ordonat după puncte, apoi victorii, apoi cine l-a făcut primul. Boții și cei ieșiți din meci nu intră.
   Cine intră în top sau își bate recordul vede „Record nou! Locul X” pe ecranul final.

### Taste

| Tastă | Ce face |
|---|---|
| Săgeți / `W` `A` `S` `D` | mers |
| `Spațiu` | pune o petardă |
| `Tab` (ținut apăsat) | clasamentul meciului |
| `Esc` | ieși din meci (cu confirmare) |
| `Enter` | hostul: sare peste o rundă în care mai trăiesc doar boți; la final, încă un meci |
| `P` | pauză (doar offline) |
| `F` | fullscreen |

Sus în dreapta: sunet pornit/oprit și fullscreen. În meniu: **Efecte reduse** (mai puține particule,
fără zăpadă), pentru calculatoare și telefoane mai slabe; setarea se ține minte pe dispozitiv.

### Pe telefon

Merge pe Android (Chrome) și iPhone (Safari), online și offline. Lobby-ul și meciul se joacă pe
orizontală (pe verticală apare "Rotește telefonul"); intro-ul, numele și meniul merg în ambele poziții.

- **D-pad** în stânga (ții apăsat = mergi; alunecă degetul pe altă săgeată ca să schimbi direcția) și
  butonul mare de **petardă** în dreapta; merg simultan, cu două degete.
- Butoane în loc de taste: **Ieși**, **Clasament** (atinge din nou ca să-l închizi), **Pauză** (offline),
  **Sari peste rundă** și **Încă un meci** pentru host.
- **Setări** (în meniu și în lobby): Efecte reduse (pornit implicit pe telefon), Joystick în loc de
  D-pad, Mod stângaci (D-pad-ul și petarda își schimbă locul, clasamentul trece în stânga), Vibrații
  (scurt la petardă, lung la moarte; doar unde browserul știe să vibreze).
- Android: primul tap din lobby sau din meci trece pe tot ecranul. iPhone nu are fullscreen în Safari:
  meniul sugerează **Partajează → Adaugă pe ecranul principal**, de unde jocul pornește fără bare.
- Ecranul nu se stinge în timpul jocului. Dacă ieși din aplicație: offline jocul intră în pauză,
  online conexiunea rămâne și revii direct în meci (după mai mult de ~15 s fără conexiune locul se pierde).

Ieșirea e definitivă: din lobby imediat, din meci după confirmare ("Pierzi runda." dacă ești în viață);
în meciul curent rămâi în clasament ca "a ieșit", la întoarcerea în lobby nu mai apari. Doar o cădere
de rețea îți păstrează locul 15 s ("Se reconectează..."), iar un reload al paginii te duce înapoi în joc.
Un link `?room=COD` către alt joc decât cel în care ești întreabă întâi "Ieși din jocul curent și intri în COD?".
Ceilalți află din toast-uri: a intrat, a ieșit, s-a deconectat, a revenit, e acum host.

## Sunete înlocuibile

Toate efectele sunt generate cu Web Audio. Oricare poate fi înlocuit punând un fișier cu numele lui în
`client/public/audio/` (`.ogg`, sau `.mp3` dacă nu există `.ogg`); un fișier lipsă înseamnă sunetul generat.

| Fișier | Când se aude |
|---|---|
| `intro.ogg` | la "Intră" (fără fișier: liniște) |
| `petarda.ogg` | e pusă o petardă |
| `fitil.ogg` | fitilul petardei puse |
| `explozie.ogg` | explozie |
| `powerup.ogg` | e luat un power-up |
| `moarte.ogg` | moare un jucător |
| `numaratoare.ogg` | 3, 2, 1 la începutul rundei |
| `foc.ogg` | FOC! |
| `runda.ogg` | cineva câștigă o rundă |
| `la-multi-ani.ogg` | se termină meciul (fără fișier: o fanfară scurtă generată) |

Butonul de sunet le oprește pe toate.

## Structură

```
shared/   logica jocului, TypeScript pur (fără Phaser/DOM), deterministă, testată cu vitest
client/   Phaser 3 + Vite; randează starea și trimite input-uri printr-un GameTransport
server/   server Colyseus autoritar care rulează aceeași simulare (vezi server/README.md)
deploy/   instalare și actualizare pe VPS (vezi deploy/README.md)
```

- **`/shared`**: simulare pe tick-uri fixe (20/s), deterministă (RNG cu seed ținut în stare, fără
  `Date.now()` / `Math.random()`). Starea e plată și se mapează direct pe `@colyseus/schema`.
  Jucătorii influențează jocul doar prin `applyInput`; `step` avansează un tick și întoarce evenimente
  (sunete, efecte). Tot aici: lobby/runde/meci (`match.ts`), strângerea arenei, boții, numărătoarea de
  start, statisticile de meci (sinucideri, cadouri sparte, power-up-uri) și premiile (`awards.ts`).
- **`/client`**: scene intro → nume → meniu → lobby ⇄ joc. Intro-ul, numele, meniul și lobby-ul sunt
  HTML/CSS peste pânza Phaser (care desenează doar cerul cu zăpadă în spate); meciul e desenat în Phaser.
  Iconițele de sunet/fullscreen, toast-urile, controalele touch și "Rotește telefonul" sunt tot HTML.
  Scenele vorbesc cu jocul doar prin `GameTransport`: `LocalTransport` (simularea în browser, cu boți)
  sau `ColyseusTransport` (room pe server). Grafica e desenată procedural la pornire; particulele au un
  plafon global (`render/fx.ts`), sunetele sunt în `audio/sfx.ts`.
- **`/server`**: room-ul `bombe` (codul e id-ul room-ului), validare completă pe server, `GET /health`,
  `GET /rooms/:cod` și `GET /leaderboard` (clasamentul, din SQLite: `node:sqlite`, inclus în Node).

Opțiuni de test din URL: `?debug`, `?bots=1..5` (implicit 3), `?rounds=3|5|7`, `?seed=abc`,
`?botlevel=usor|mediu|greu` (nivelul boților, implicit mediu),
`?touch` / `?touch=0` (forțează varianta de telefon, cu controale touch, pe desktop, sau invers).
Oricare dintre ele pornește direct un meci local (fără intro, meniu și lobby); `Enter` la final pornește
imediat alt meci. `?debug` afișează gridul cu coordonate, hitbox-urile, zonele de pericol, tick-ul,
FPS-ul și intenția + drumul fiecărui bot.

## Dezvoltare

Necesită Node ≥ 22.12.

```bash
npm install
npm run dev        # client pe http://localhost:5173 + server Colyseus pe :2567 (clasament în server/data/)
npm test           # testele din /shared și ale serverului
npm run typecheck
npm run build      # client/dist (static) + server/dist/index.js (un singur fișier)
```

Pe telefon, în aceeași rețea Wi-Fi: Vite ascultă pe toate interfețele, deci jocul se deschide la
`http://<IP-ul calculatorului>:5173` (adresa apare în consola lui `npm run dev`, la "Network").
Pe HTTP simplu browserul nu dă Wake Lock, Web Share și clipboard (cer HTTPS); restul merge.
Pentru emulare: Chrome DevTools → device mode (iPhone / Android, ambele orientări), cu reîncărcare.

Imaginea de preview pentru linkuri (`client/public/og.png`, 1200×630) și iconițele (`favicon.svg`,
`favicon-32.png`, `apple-touch-icon.png`, `icon-512.png`) sunt desenate din cod în
`client/assets-src/icons.mjs`; după o modificare: `npm run og`. Domeniul folosit în tag-urile Open Graph
e `SITE_URL` din `client/vite.config.ts` (implicit https://bombe-petarde.duckdns.org; se poate schimba
la build cu variabila de mediu `SITE_URL`).

Endpoint-ul serverului se configurează prin `VITE_SERVER_URL` (vezi `client/.env.example`):
implicit `/colyseus` pe același domeniu, gol = build doar offline.

## Deploy

VPS Oracle (systemd + Caddy, https://bombe-petarde.duckdns.org), detalii în `deploy/README.md`.
Actualizare de pe Windows:

```powershell
.\deploy\push.ps1 -WhatIf     # doar arată ce ar face
.\deploy\push.ps1             # teste, typecheck, build, upload, comutare atomică, health check
.\deploy\push.ps1 -Rollback   # înapoi la versiunea anterioară
```
