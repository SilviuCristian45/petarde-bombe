import { createServer } from './app';
import { DB_PATH, HOST, PORT } from './config';
import { openLeaderboard, useLeaderboard } from './leaderboard';

useLeaderboard(openLeaderboard(DB_PATH));
const server = createServer();
await server.listen(PORT, HOST);
console.log(`Bombe și Petarde: server pe http://${HOST}:${PORT}`);
