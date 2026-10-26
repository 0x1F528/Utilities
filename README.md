# Local Utilities

A self-hosted utility manager for Node.js 22.12.0 or newer, including Node 24. No root runtime dependencies. Open http://127.0.0.1:8765. The server binds only to IPv4 loopback.

Deploy on **either Windows or WSL (Linux)** — pick one Node runtime per machine, not both. Autostart, folder browsing, and Git path handling follow the host you start with.

## Running

- `npm start`: foreground server.
- `npm run start:bg`: background server, with logs in `.run/utilities.log`.
- `npm run stop`, `npm run restart`, `npm run status`: manage the background server.
- `npm run autostart:install`: install autostart and start the server now.
- `npm run autostart:uninstall`: remove autostart; the running server stays up.
- `npm test`: run server integration tests.
- Markdown utility dependencies (once): `cd Markdown && npm install`.

### Which host to choose

- Prefer **WSL** when this checkout and most Git repos live under `/home/...`.
- Prefer **Windows** when the tree and day-to-day repos live on `C:\` (or other drives) and you want sign-in autostart without waiting for a WSL boot.
- Do not run two managers (Windows Node and WSL Node) against the same checkout: they share port `8765` and `.run/` state.

### Windows notes

- Use a native Windows `node` / `npm`.
- Git **Browse…** uses a PowerShell folder dialog.
- Beyond Compare auto-detects under `C:\Program Files\...`.

### WSL notes

- Prefer **Linux** `node` / `npm` (for example from nvm or `/usr/bin/node`). If Windows Node is on the WSL `PATH` via `/mnt/c/Program Files/nodejs/...`, `npm run …` can unexpectedly invoke Windows Node against a UNC path and fail. Put your Linux Node bin directory first, or drop Windows PATH entries for Node/npm.
- Git **Browse…** uses zenity (or kdialog). Under WSLg those dialogs work when a GUI session is available; otherwise enter paths manually.
- Beyond Compare auto-detect looks under `/mnt/c/Program Files/...` for the Windows `.exe`. Set an explicit Linux binary path in Git settings if you use a native comparator.

### Paths in Git

Register, clone, browse, and Beyond Compare settings accept either `C:\…` or `/mnt/c/…`. The server normalizes paths for the host. The Git repository list and settings (BC path, default remote) live in browser localStorage. Remote clone URLs are unchanged. If you switch host OS, re-register repositories so paths match the new host.

### Autostart

- **Windows:** hidden Startup-folder VBS launcher at sign-in.
- **Linux / WSL:** systemd user service `local-utilities.service` when available; otherwise a crontab `@reboot` entry. Reinstall after moving the repo or changing Node. On WSL, autostart fires when the distro boots (typically when something starts WSL after `wsl --shutdown`).
- Install autostart only for the host you deploy on.

The Hello utility provides a local world clock: a day/night map, manually selected Home, hover times and saved clock pins. Map and approximate timezone data are bundled; timezone overrides are available and no external clock services are used. Hello also includes **Restart manager** and **Stop manager** buttons, status feedback, and manual recovery instructions that match the running host. These controls affect every utility. After stopping, start with `npm run start:bg` from a terminal on that same host, then reload the page. The buttons use POST-only endpoints at `/api/Hello/restart` and `/api/Hello/stop`.

`.run/` holds disposable process state and logs. Control commands verify the server's identity before stopping it; they never kill arbitrary processes occupying the port.

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

Handlers receive the native Node request/response, may read request bodies, and must finish their response before their returned promise resolves. They run with your user permissions and can import `node:fs/promises` and `node:child_process`. Prefer `execFile` or `spawn` with argument arrays; validate requested paths, arguments, methods and body sizes. Keep server helpers and secrets in root `lib/` or dot-prefixed files, which are not publicly served. `api.mjs`, package manifests and node_modules are blocked from static serving. Other supported assets inside utility folders are public.

There is deliberately no universal command-execution endpoint. Add focused APIs to individual utilities when needed. Only install trusted generated utilities: browser code shares the origin and APIs run with your user permissions. The server checks Host, Origin and cross-site fetch headers, but does not isolate utilities or authenticate other local processes.

Root `node_modules` dependencies resolve normally from utility API modules; a utility may also have its own package.json and dependencies. Browser dependencies must be bundled or copied into public assets; node_modules is not exposed.

Framework endpoints: `GET /api/health` (includes `platform`), `GET /api/utilities`.
