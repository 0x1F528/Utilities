# Git cockpit

Open `/git/` to register existing working-tree repository folders, or use **Create** / **Clone**. Create initializes Git in a new or existing folder without staging or changing its files; an existing repository is simply registered. The main-page folder selection carries into Create. Clone requires a new or empty destination. Both use modals and automatically register on success. Create accepts an initial branch (default `main`); Clone accepts a remote URL or a local source path. Both accept an optional display name. Repository paths and settings are stored under root `.run/`; forgetting a registration does not delete its repository. Git must be installed and available to the manager's Node process. Clone uses the existing credential setup and the same 60-second command timeout.

**Browse…** opens a native folder dialog on the server computer for registration, destinations and local clone sources. Windows uses a hidden PowerShell STA host and the modern native folder dialog, owned by the active window to keep it on the same monitor; macOS uses osascript; Linux uses zenity with kdialog as fallback. Picker cancellation leaves the input unchanged. Manual path entry remains available. Only one picker can be open at a time; it times out after five minutes. The Probe button has been removed.

The optional `git/api.mjs` adapter delegates `/api/git/*` to root `lib/git-api.js`. No framework restart is needed on first installation. After editing a loaded API module, restart the manager from Hello.

## Working in a repository

- Check branch refs to populate the graph. Right-click commits to create a branch at that point. Shift/Ctrl/Cmd-click a second commit to compare their tree snapshots; Escape returns to WIP. The graph loads up to 200 commits and collapses lanes beyond five.
- In WIP, clicking a file name toggles stage/unstage. The ↗ button previews without staging. Ctrl/Cmd-click names to select multiple paths for discard or partial stash. Use the staged/unstaged selector above the diff.
- Commit uses staged contents; Amend loads the current message and flags the next push for force-with-lease. Push requires confirmation when that flag is set. Successful push clears it.
- Branch menus include smart local/remote checkout, creation, catch-up, and deletion. Catch-up fast-forwards behind branches, leaves ahead-only branches alone, and explicitly confirms replacing diverged local history. It refuses a dirty current branch and branches checked out in another worktree.
- Stash controls support push (including untracked), selected paths, apply/pop with index, drop and rename. Selecting a stash includes files from its untracked parent. Escape returns to the previous view.

## Command window

The bottom console shows Git commands, exit codes and truncated output, including read-only metadata commands. Server-sent events announce each dispatch and result; polling also restores history and catches missed updates. Manual entries accept one Git command with quoted arguments; shell pipelines, cwd overrides and paths outside the repository are rejected. Up/Down recalls commands entered during this session. This is a Git command runner, not a PowerShell terminal. Long-running synchronous Git calls block API responses until they complete; the action indicator shows the pending operation. Git commands have a 60-second timeout and a 16 MB output limit. Repository hooks and aliases run with your Windows user permissions, as in Git itself.

Logs persist in `.run/git-commands.jsonl` (bounded rotation). Avoid putting credentials or tokens in commands because they appear in the console and logs. Remote authentication uses existing credential helpers with interactive prompts disabled; use an external terminal to establish credentials if needed.

## Beyond Compare

Set `beyondComparePath` on the registry page, or leave it empty for standard Windows Beyond Compare 5/4 installation detection. `/mnt/c/...` paths are translated on Windows. Selected-file left/right snapshots are written beneath `.run/git-bc/` and opened in a hidden-start process. The snapshots remain for the external tool and may be removed when no longer needed. No original files are passed as editable snapshots. Inline diff display is capped at roughly 200 KB.

## Stored state

- `.run/git-registry.json`: `{ repos: [{ id, path, name, addedAt }] }`, id is the first 12 SHA-1 characters of the canonical path (case-normalized on Windows).
- `.run/git-settings.json`: Beyond Compare path and default remote (`origin`).
- Browser localStorage `git-repo-<id>`: checked refs, folder expansion, colors, filters and pending force-with-lease preference.

The manager binds only to loopback. Repository file endpoints validate paths and block traversal and symlink escapes. Commands run using argument arrays and `shell: false` behavior; this does not isolate Git hooks or repository configuration. Destructive UI actions ask for explicit confirmation. Tests use temporary repositories and a local bare remote only.


