# Markdown

Open `/Markdown/` from the manager. The folder name has a capital M.

Install dependencies with `npm install` **inside this folder**. The postinstall script copies Marked, Mermaid and DOMPurify browser distributions into `vendor/`, including Mermaid's relative module chunks. The manager blocks node_modules from direct HTTP access, so the page loads its local UMD and ESM assets from vendor instead. No network is needed at runtime. Keep package-lock.json to reproduce dependency versions; use `npm ci` to reinstall them.

The preview uses the modern Marked code-token renderer and Mermaid's explicit, debounced run API. DOMPurify sanitizes raw Markdown HTML before rendering. Mermaid uses its default theme and strict security mode. External images or links supplied in your own Markdown may still reference the network.

Only `markdown-split-pct` is stored in localStorage. Markdown text is transient; there is no save, export or server API. The divider supports pointer capture, double-click reset, arrow keys (2%, or 5% with Shift), Home/End (15%/85%), and switches orientation at 700px.
