import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// patches/fontless@0.2.1.patch fixes transformCSS(): it accumulated
// `parentOffset` across sibling nested-CSS `Raw` nodes, so the fallback
// font-family index ran past the end of the stylesheet and MagicString
// dumped `, "IBM Plex Serif Fallback: …"` at offset 0 — ahead of the first
// selector, which swallowed the `:root` token block and left every
// var(--card-background) etc. unresolved in dev.
//
// If @nuxt/fonts bumps fontless, `patchedDependencies` stops matching and the
// patch is silently skipped. This fails loudly instead.
test('fontless keeps the nested-CSS offset fix', () => {
  const src = readFileSync('node_modules/fontless/dist/index.mjs', 'utf8');
  expect(src).toContain('processNode(nestedRaw, parentOffset + node.loc.start.offset)');
  expect(src).not.toContain('parentOffset += node.loc.start.offset');
});
