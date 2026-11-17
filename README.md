# Bombe și Petarde

Joc multiplayer de tip arenă cu bombe, în browser, cu temă de Revelion românesc.
Phaser 3 + TypeScript + Vite, server autoritar Colyseus (în lucru).

## Structură

```
shared/   logica jocului, TypeScript pur (fără Phaser/DOM), deterministă, testată cu vitest
client/   Phaser 3 + Vite; randează starea și trimite input-uri printr-un GameTransport
server/   planul pentru serverul Colyseus (vezi server/README.md)
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
- Lobby: cod de room de 6 caractere, max 6 jucători, host transferat la plecare,
  intrare doar în lobby, 3/5/7 runde, minim 2 jucători (boții se numără).
- Boți (`botDecide`): fug din zonele de explozie, sparg ziduri, pun bombe lângă jucători.

## Rulare locală

Necesită Node ≥ 22.12.

```bash
npm install
npm run dev        # client pe http://localhost:5173
npm test           # testele din /shared
npm run typecheck
```

## Build

```bash
npm run build      # build static în client/dist
```

Endpoint-ul serverului se configurează prin `VITE_SERVER_URL` (vezi `client/.env.example`).
