# Bombe și Petarde

Joc multiplayer de tip arenă cu bombe, în browser, cu temă de Revelion românesc.
Phaser 3 + TypeScript + Vite, server autoritar Colyseus (în lucru).

## Structură

```
shared/   logica jocului, TypeScript pur (fără Phaser/DOM), deterministă, testată cu vitest
client/   Phaser 3 + Vite; randează starea și trimite input-uri printr-un GameTransport
server/   planul pentru serverul Colyseus (vezi server/README.md)
```

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
