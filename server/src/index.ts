import { createServer } from './app';
import { HOST, PORT } from './config';

const server = createServer();
await server.listen(PORT, HOST);
console.log(`Bombe și Petarde: server pe http://${HOST}:${PORT}`);
