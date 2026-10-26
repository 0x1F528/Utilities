# Local Utilities

A Windows, self-hosted utility manager for Node.js 22.12.0 or newer, including Node 24. No runtime dependencies. Open http://127.0.0.1:8765. The server binds only to IPv4 loopback.

## Running

- `npm start`: foreground server.
- `npm run start:bg`: hidden background server, with logs in `.run/utilities.log`.
- `npm run stop`, `npm run restart`, `npm run status`: manage the background server.
- `npm run autostart:install`: install a hidden launcher in your Windows Startup folder and start the server now.
- `npm run autostart:uninstall`: remove that launcher; the running server stays up.
- `npm test`: run server integration tests.

The Hello utility provides a local world clock: a day/night map, manually selected Home, hover times and saved clock pins. Map and approximate timezone data are bundled; timezone overrides are available and no external clock services are used. Hello also includes **Restart manager** and **Stop manager** buttons, status feedback, and manual recovery instructions. These controls affect every utility. After stopping, start from PowerShell with `npm run start:bg`, then reload the page. The buttons use POST-only endpoints at `/api/Hello/restart` and `/api/Hello/stop`.

Autostart runs at your Windows sign-in, using the Node executable that installed it. Reinstall autostart if you move this repository or Node. No WSL or administrator account is needed. Keep this folder available locally if OneDrive Files On-Demand is enabled. `.run/` holds disposable process state and logs. Control commands verify the server's identity before stopping it; they never kill arbitrary processes occupying the port.

## Adding a utility

Create `<folder>/index.html` at the repository root. Refresh the dashboard: no registry or restart is needed. Folder names may contain spaces. Root directories starting with a dot, plus `scripts`, `lib`, `test`, and `node_modules`, are excluded. There are no directory listings.

Optional `utility.json`:

```json
{ "name": "My utility", "description": "What it does", "icon": "◈" }
```

Use relative asset URLs in each utility and `/` to return to the dashboard. Utilities may use browser local storage; prefix keys with the utility's name. All utilities share an origin and can access one another's storage. Use the same hostname consistently: localhost and 127.0.0.1 have separate browser storage.

## Server-side utility APIs

Add `<folder>/api.mjs` to serve `/api/<folder>/*`. Node loads this file on the first API request. Restart after changing an already loaded API module. Newly added utilities and API modules work without restarting.

```js
export async function handle(req, res, { root, utilityRoot, pathname, json }) {
  // pathname is the route after /api/<folder>, e.g. /status.
  if (req.method === 'GET' && pathname === '/status') {
    return json(200, { ready: true });
  }
  json(404, { error: 'Unknown endpoint' });
}
```

Handlers receive the native Node request/response, may read request bodies, and must finish their response before their returned promise resolves. They have the Windows user's permissions and can import `node:fs/promises` and `node:child_process`. Prefer `execFile` or `spawn` with argument arrays; validate requested paths, arguments, methods and body sizes. Keep server helpers and secrets in root `lib/` or dot-prefixed files, which are not publicly served. `api.mjs`, package manifests and node_modules are blocked from static serving. Other supported assets inside utility folders are public.

There is deliberately no universal command-execution endpoint. Add focused APIs to individual utilities when needed. Only install trusted generated utilities: browser code shares the origin and APIs run with your user permissions. The server checks Host, Origin and cross-site fetch headers, but does not isolate utilities or authenticate other local processes.

Root `node_modules` dependencies resolve normally from utility API modules; a utility may also have its own package.json and dependencies. Browser dependencies must be bundled or copied into public assets; node_modules is not exposed.

Framework endpoints: `GET /api/health`, `GET /api/utilities`.
