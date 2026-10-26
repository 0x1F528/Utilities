# Markdown (Markdown/)

- Pure client-side Markdown editor with HTML and Mermaid preview; no API, save or export.
- Folder name is Markdown with capital M. Seed a short demo including a Mermaid graph.
- Split textarea/preview horizontally on desktop, vertically at <=700 px.
- Draggable splitter with pointer capture; disable interfering pane pointer events while dragging.
- Clamp split to 15-85%; double-click resets. Arrows move 2%, Shift 5%; Home/End set limits.
- Persist only split percentage under markdown-split-pct; update orientation and layout on resize.
- Install per-utility marked, mermaid and DOMPurify dependencies; retain lockfile.
- Postinstall copies browser builds and Mermaid module chunks into public vendor/.
- Load local Marked UMD and Mermaid ESM; no CDN or runtime network dependency.
- Use modern Marked renderer token API. Mermaid fences produce diagram containers.
- Other code fences are HTML-escaped. Sanitize rendered HTML with DOMPurify before insertion.
- Render Markdown on input; debounce explicit Mermaid rendering about 200 ms after DOM updates.
- Mermaid: startOnLoad false, default theme, strict security. Catch incomplete-diagram errors while typing.
- Light GitHub-style preview with heading rules and shaded code blocks; centered Mermaid diagrams.
- Empty data-URI favicon. User-authored external images/links may still access the network.
