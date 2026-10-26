import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeRenderer } from '../Markdown/render.js';
import { Marked, Renderer } from '../Markdown/node_modules/marked/lib/marked.esm.js';
test('modern Marked code renderer keeps code escaped and routes Mermaid fences',()=>{
  const renderer=new Renderer();renderer.code=codeRenderer;
  const marked=new Marked({renderer,gfm:true});
  const code=marked.parse('```html\n<script>alert("x" & \'y\')</script>\n```');
  assert.match(code,/&lt;script&gt;/);assert.match(code,/&quot;x&quot; &amp; &#39;y&#39;/);assert.doesNotMatch(code,/<script>/);
  const diagram=marked.parse('```mermaid\ngraph LR\n A["<b>Label</b>"] --> B\n```');
  assert.match(diagram,/<div class="mermaid">/);assert.match(diagram,/&lt;b&gt;Label&lt;\/b&gt;/);
  const ordinary=marked.parse('```js\nconst a = 1;\n```');assert.match(ordinary,/class="language-js"/);assert.doesNotMatch(ordinary,/class="mermaid"/);
  assert.match(marked.parse('# Heading\n\n| A | B |\n|---|---|\n| 1 | 2 |'),/<table>/);
});
