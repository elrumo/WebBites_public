/**
 * Plain text from an assistant becomes the HTML a note bite stores, with
 * nothing in it able to become markup.
 *
 * Run with:  npm run test:textNotes
 */

import { escapeNoteHtml, plainTextToNoteHtml } from './textNoteHtml';

let pass = 0, fail = 0;
const check = (name: string, got: string, want: string) => {
    if (got === want) pass++; else { fail++; console.log(`FAIL: ${name}\n  got:  ${got}\n  want: ${want}`); }
};

check('escapes markup', escapeNoteHtml(`<script>alert("x")</script> & 'y'`),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;');
check('one paragraph', plainTextToNoteHtml('Hello'), '<p>Hello</p>');
check('line breaks', plainTextToNoteHtml('a\nb'), '<p>a<br>b</p>');
check('paragraphs', plainTextToNoteHtml('a\n\nb\n\n\n c '), '<p>a</p><p>b</p><p>c</p>');
check('windows newlines', plainTextToNoteHtml('a\r\n\r\nb'), '<p>a</p><p>b</p>');
check('title first', plainTextToNoteHtml('body', ' My <title> '), '<h1>My &lt;title&gt;</h1><p>body</p>');
check('blank title ignored', plainTextToNoteHtml('body', '   '), '<p>body</p>');
check('no injected tags', plainTextToNoteHtml('<img src=x onerror=alert(1)>'), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
