/**
 * Tests for reading a PDF. The document is built inline rather than checked in
 * as a fixture, so the test carries its own expected text. Run with:
 *
 *   npm run test:pdfDocument
 */

import { readPdfDocument, renderPdfCover, pdfDescription } from './pdfDocument';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}`); }
};

/** A one-page PDF with an uncompressed content stream and a title in /Info. */
function buildPdf({ title, author }: { title?: string; author?: string } = {}): Buffer {
    const stream = Buffer.from(
        'BT /F1 24 Tf 72 700 Td (Hello from a test PDF) Tj ET\n'
        + 'BT /F1 12 Tf 72 660 Td (Quarterly results, page one.) Tj ET',
        'latin1'
    );

    const objects: (string | Buffer)[] = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
        Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from('\nendstream')]),
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< ${title ? `/Title (${title}) ` : ''}${author ? `/Author (${author})` : ''} >>`
    ];

    const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n')];
    const offsets: number[] = [];
    let length = chunks[0].length;

    objects.forEach((object, index) => {
        offsets.push(length);
        const body = Buffer.isBuffer(object) ? object : Buffer.from(object);
        const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
        chunks.push(chunk);
        length += chunk.length;
    });

    const xrefOffset = length;
    const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n']
        .concat(offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`))
        .join('');
    chunks.push(Buffer.from(xref));
    chunks.push(Buffer.from(
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
    ));

    return Buffer.concat(chunks);
}

const run = async () => {
    const pdf = buildPdf({ title: 'Q3 Results 2024', author: 'Acme Research' });

    const info = await readPdfDocument(pdf);
    check('a readable PDF comes back', info !== null);
    check('the page count is right', info?.pageCount === 1);
    check('the text layer is extracted', Boolean(info?.text.includes('Hello from a test PDF')));
    check('every line of it, not just the first',
        Boolean(info?.text.includes('Quarterly results, page one.')));
    check('the metadata title is used', info?.title === 'Q3 Results 2024');
    check('the author comes through', info?.author === 'Acme Research');
    check('a short document is not marked truncated', info?.truncated === false);

    const untitled = await readPdfDocument(buildPdf({ title: 'Untitled document' }));
    check('an "Untitled" metadata title is refused', untitled?.title === undefined);

    const exported = await readPdfDocument(buildPdf({ title: 'Microsoft Word - annual review.docx' }));
    check('a Word export artefact is refused too', exported?.title === undefined);

    const notAPdf = await readPdfDocument(Buffer.from('<!doctype html><html></html>'));
    check('something that is not a PDF comes back null', notAPdf === null);

    check('a description falls back to the opening text',
        (pdfDescription(info) || '').startsWith('Hello from a test PDF'));
    check('no document means no description', pdfDescription(null) === undefined);

    // The cover is the one part allowed to be missing: it needs a native canvas
    // build. Assert on whichever answer this platform gives, not on having one.
    const cover = await renderPdfCover(pdf);
    check('a cover render is either a PNG or an honest null',
        cover === null || (Buffer.isBuffer(cover) && cover.length > 0 && cover.subarray(1, 4).toString() === 'PNG'));
    if (cover) console.log(`  note cover rendered, ${cover.length} bytes`);
    else console.log('  note no canvas backend on this platform; cards fall back to a gradient');

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
};

run();
