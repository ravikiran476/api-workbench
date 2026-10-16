import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { WorkspaceStore } from './store';

const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '127.0.0.1';
const DATA_FILE = process.env.DATA_FILE ?? path.resolve(here, '../data/workspace.json');
const CLIENT_DIST = path.resolve(here, '../../client/dist');

const store = new WorkspaceStore(DATA_FILE);
await store.load();

const app = createApp({ store, clientDist: existsSync(CLIENT_DIST) ? CLIENT_DIST : undefined });

app.listen(PORT, HOST, () => {
  console.log(`API Workbench server listening on http://${HOST}:${PORT}`);
  console.log(`Workspace file: ${DATA_FILE}`);
  if (existsSync(CLIENT_DIST)) console.log(`Serving client from ${CLIENT_DIST}`);
});
