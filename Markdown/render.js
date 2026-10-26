export const escapeHTML = text => String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export function codeRenderer(token) {
  const lang=(token.lang||'').trim().split(/\s+/)[0].toLowerCase();
  if(lang==='mermaid')return `<div class="mermaid">${escapeHTML(token.text)}</div>\n`;
  return `<pre><code${lang?` class="language-${escapeHTML(lang)}"`:''}>${escapeHTML(token.text)}\n</code></pre>\n`;
}
export const clampSplit = value => Math.max(15,Math.min(85,Number.isFinite(value)?value:50));
