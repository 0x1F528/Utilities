# Git (git/; server in lib/git-api.js)

Browser Git cockpit over real local repos via the host `git` binary. Not a simulation.

## Architecture

- `git/api.mjs` → `lib/git-api.js`. Spawn Git with argument arrays only (`shell: false`); no generic shell. 60s / 16 MB limits; credentials via existing helpers (`GIT_TERMINAL_PROMPT=0`).
- Browser owns durable state: localStorage `git-registry` (`{id,path,name,addedAt}`), `git-settings` (BC path, default remote), `git-repo-<id>` UI prefs. Server keeps only `.run/git-commands.jsonl` and `.run/git-bc/` temps.
- Cockpit APIs take `repoPath` (and settings query params). Id is first 12 hex of SHA-1 of canonical path (case-folded on Windows). Forget/rename are client-only.
- One-shot migration from legacy `.run/git-registry.json` / `git-settings.json` when browser keys are empty/unmigrated.
- `hostPath`: `C:\…` ↔ `/mnt/c/…` on register/clone/browse/BC; leave remote URLs alone.
- Native Browse… is OS-specific (PowerShell / osascript / zenity|kdialog); cancel = no change; single picker, 5 min timeout.

## Registry page

- Register existing tree, Create (init in place, keep files), Clone (empty/new dest only). Auto-register after success. Status via `POST /status` with the browser list.
- Open cockpit in a new tab. Forget never deletes disk data.

## Cockpit

- Layout: branches/stashes | graph or file diff | files + commit. Resizable panes; bottom command console (SSE + poll).
- Per-panel `filter` boxes: case-insensitive substring; hide non-matches; keep folder ancestors and open to hits; highlight hits. Branches/stashes · commits (subject/oid/author/refs; Working tree always stays) · file paths.
- Graph: up to 200 commits; Working tree is a virtual tip row. Selected refs drive lanes; current lineage is locked blue; conflicting tip colors → grey. Modifier-click second commit = range; Escape back to WIP.
- Branch list: Local/Remote filters (persisted) hide rows only — remote|local boxes always show the real pair. Slash folders; pair `origin/<name>` with local (hide `origin/` prefix); other remotes stay separate. Compact remote|local selectors with ahead/behind symbols; equal tips share one control/color. `%(upstream:track)` for counts (avoid per-branch `rev-list`).
- Single-child folder spines (branches and files) elide same-dot runs as `A … F` (click `…` to expand that chain). Expand/Collapse clears elision expansions, then opens dotted folders / closes all.
- File folders otherwise default collapsed; auto-open ancestors of interesting items (changes, active/selected file, search).
- File filters: independent Tracked / Changed / Untracked / Ignored. Cap clean tracked expansion (~2500); if larger, toast and force Tracked off (prevents DOM OOM on huge trees).
- Optimistic stage/unstage queue; reconcile after burst. Mutations wait for the queue. Poll WIP ~2.5s, refs ~15s; pause when hidden/busy.
- Diff: WIP staged/unstaged, commit, range, stash; inline cap ~200 KB. BC launches left/right temp snapshots (not live files); on WSL convert args with `wslpath` when spawning a Windows `.exe`.
- Path History ↗: read-only tab (`id` + file `path` + `refs`); `git log --follow`; separate prefs key `git-repo-<id>::history`.
- Manual console: one Git subcommand, quoted args OK; reject shell operators, `-C`, absolute/`..` paths outside the repo.
- Amend / history-rewriting ops set a force-with-lease flag (Push turns red until success). No separate force-push dialog beyond that.
- Detached HEAD: show under Working tree; disable commit/amend; Create Branch keeps WT/index.
- Catch-up: ff-only when behind; confirm hard reset when diverged; refuse dirty current / other-worktree checkout.
- Squash since here = soft reset to ancestor (stage later commits, no auto-commit). Reset to here = hard. Restore WT from commit copies snapshot without moving HEAD; leave unstaged; block ignored overwrites. No revert/Undo feature.
- Cherry-pick: vs parent, no auto-commit; whole-commit or atomic multi-file patch; reject merges; conflicts → complete without commit or abort. Fill message from source for edit.
- Tags local only, never overwrite. Stash: all or selection (+untracked), apply/pop with index, drop, rename; Esc leaves stash view.
- Destructive actions confirm. Tests only against disposable repos/local remotes.
