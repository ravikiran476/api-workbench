# API Workbench — Lightweight API Testing Tool

A simplified, self-hosted alternative to common API clients. Runs locally: a React UI talks to a small Express server that sends your requests and stores your collections.

## Features

- **Requests:** GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- **Params & headers:** editable tables, with two-way sync between the URL and the params table
- **Auth:** Bearer token, Basic (UTF-8 safe), API key in a header or the query string
- **Body:** JSON (with validation and beautify), plain text, `x-www-form-urlencoded`
- **Response:** status, duration, size, redirects, headers, and a pretty or raw body with JSON highlighting. Images are previewed; binary responses can be downloaded.
- **Collections & environments:** saved on the server in a JSON file. Use `{{variables}}` anywhere in a request; undefined ones are flagged before you send.
- **Postman:** import v2.0/v2.1 collections (folders, inherited auth, collection variables become an environment) and export any collection as v2.1
- **Extras:** copy as cURL, `Ctrl+Enter` to send, `Ctrl+S` to save, unsaved edits survive a reload, dark mode

## Stack

React 18 · TypeScript · Tailwind CSS v4 · Vite 6 — Node.js · Express 5 · Zod — Vitest · Supertest

## Getting started

Requires Node.js 20 or later.

```bash
npm install
npm run dev
```

Open http://localhost:5173. The API server runs on http://127.0.0.1:4000, and Vite proxies `/api` to it.

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the server and the client with hot reload |
| `npm run build` | Build the client to `client/dist` |
| `npm start` | Start the server only; it serves `client/dist` when that folder exists (http://127.0.0.1:4000) |
| `npm test` | Run the server and client test suites |
| `npm run typecheck` | Type-check both packages |

### Configuration (server environment variables)

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `4000` | |
| `HOST` | `127.0.0.1` | Interface to bind to |
| `DATA_FILE` | `server/data/workspace.json` | Where collections and environments are stored |

## Project layout

```
shared/          Types and URL helpers used by both sides
server/src/
  app.ts         Express app: REST API, local-only guard, error handling
  proxy.ts       Sends requests: timeouts, size limit, binary detection, readable network errors
  postman.ts     Postman v2.x import / v2.1 export
  store.ts       JSON-file workspace store (serialized, atomic writes)
  schemas.ts     Zod validation for every request body
client/src/
  App.tsx        Layout, editor state, send/save flows, shortcuts
  lib/request.ts Variable substitution, auth, URL⇄params sync, cURL
  components/    Sidebar, RequestEditor, ResponseViewer, EnvironmentManager, …
```

## How sending works

The browser can't call most APIs directly because of CORS, and it hides some response headers. So the client resolves `{{variables}}`, applies auth, and posts the finished request to `POST /api/proxy`. The server sends it with Node's `fetch` and returns the status, headers, body (base64 for binary), size and timing.

## Security notes

- The server can reach anything your machine can, so the API **only accepts requests addressed to `localhost`** (Host check, which blocks DNS rebinding) and **from localhost pages** (Origin check, which stops other websites in your browser from using it). It binds to `127.0.0.1` by default. Don't expose it on a network.
- Environment values, tokens and passwords are stored **unencrypted** in `DATA_FILE`. `server/data/` is git-ignored.

## Limitations

- Postman folders are flattened into request names (`Folder / Request`).
- Not supported: multipart/form-data and file bodies, OAuth 2.0, Digest, AWS auth, and pre-request or test scripts. The importer reports what it skipped.
- `GET` and `HEAD` bodies are dropped, because `fetch` can't send them.
- Responses are capped at 50 MB, and requests time out after 30 s.
