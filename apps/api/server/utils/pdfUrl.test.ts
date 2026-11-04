/**
 * Tests for PDF detection. The cases worth pinning are the ones the naive
 * `endsWith('.pdf')` check got wrong, because those are the links people
 * actually paste: a signed S3 URL with the signature in the query, a citation
 * with `#page=`, a servlet with `;jsessionid=`, a viewer wrapping the real
 * document in `?file=`. Run with:
 *
 *   npm run test:pdfUrl
 */

import {
    looksLikePdfUrl,
    mayBePdfUrl,
    embeddedPdfUrl,
    pdfTargetUrl,
    isPdfBytes,
    pdfFromHeaders,
    fileNameFromContentDisposition,
    normaliseContentType,
    pdfFileName,
    titleFromPdfFileName,
    detectPdfUrl
} from './pdfUrl';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}`); }
};

// --- tier 1: the extension, whatever is hanging off it ----------------------

check('a plain .pdf URL is a PDF', looksLikePdfUrl('https://example.com/report.pdf'));

check('query parameters do not hide the extension',
    looksLikePdfUrl('https://example.com/report.pdf?download=1&v=2'));

check('a signed S3 link is a PDF',
    looksLikePdfUrl('https://bucket.s3.eu-west-1.amazonaws.com/docs/Q3.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc123&X-Amz-Expires=3600'));

check('a fragment does not hide the extension',
    looksLikePdfUrl('https://example.com/paper.pdf#page=12&zoom=100'));

check('a query and a fragment together do not either',
    looksLikePdfUrl('https://example.com/paper.pdf?token=xyz#page=12'));

check('path parameters do not either',
    looksLikePdfUrl('https://example.com/docs/manual.pdf;jsessionid=B4F9A1C2D3E4'));

check('the extension is case-insensitive',
    looksLikePdfUrl('https://example.com/REPORT.PDF') && looksLikePdfUrl('https://example.com/report.Pdf'));

check('a percent-encoded filename still ends in .pdf',
    looksLikePdfUrl('https://example.com/reports/Q3%20results%20%28final%29.pdf'));

check('a trailing slash after the file does not hide it',
    looksLikePdfUrl('https://example.com/report.pdf/'));

check('a port and userless auth do not matter',
    looksLikePdfUrl('https://files.example.com:8443/a/b/c.pdf?x=1'));

// --- tier 1: things that are not PDFs --------------------------------------

check('an ordinary article is not a PDF', !looksLikePdfUrl('https://example.com/blog/how-to-write-pdfs'));
check('a word ending in pdf is not an extension', !looksLikePdfUrl('https://example.com/about/notpdf'));
check('a host with pdf in it is not enough', !looksLikePdfUrl('https://pdf.example.com/pricing'));
check('a .pdf in the middle of a path is not the extension',
    !looksLikePdfUrl('https://example.com/report.pdf.html'));
check('a query value alone is not tier 1',
    !looksLikePdfUrl('https://example.com/download?file=report.pdf'));
check('nonsense is not a PDF', !looksLikePdfUrl('not a url') && !looksLikePdfUrl(''));
check('a non-http scheme is not a PDF', !looksLikePdfUrl('file:///etc/passwd.pdf'));

// --- tier 1: hosts that serve PDFs without an extension --------------------

check('arXiv serves papers from an extensionless path',
    looksLikePdfUrl('https://arxiv.org/pdf/2401.12345') && looksLikePdfUrl('https://arxiv.org/pdf/2401.12345v2'));
check('an arXiv abstract page is not the PDF',
    !looksLikePdfUrl('https://arxiv.org/abs/2401.12345'));
check('the ACM reader serves from /doi/pdf/',
    looksLikePdfUrl('https://dl.acm.org/doi/pdf/10.1145/3313831.3376234'));

// --- tier 1: a viewer wrapping the real document ---------------------------

check('a PDF.js viewer URL resolves to the document it wraps',
    embeddedPdfUrl('https://reader.example.com/web/viewer.html?file=https%3A%2F%2Fx.org%2Fpaper.pdf')
        === 'https://x.org/paper.pdf');

check('the wrapper counts as a PDF URL',
    looksLikePdfUrl('https://reader.example.com/web/viewer.html?file=https%3A%2F%2Fx.org%2Fpaper.pdf'));

check('pdfTargetUrl unwraps the viewer',
    pdfTargetUrl('https://docs.google.com/viewer?url=https://x.org/a.pdf') === 'https://x.org/a.pdf');

check('pdfTargetUrl leaves a direct link alone',
    pdfTargetUrl('https://x.org/a.pdf?t=1') === 'https://x.org/a.pdf?t=1');

check('a relative ?file= is not an embedded URL',
    embeddedPdfUrl('https://example.com/viewer?file=report.pdf') === null);

check('a query param pointing at a web page is not an embedded PDF',
    embeddedPdfUrl('https://example.com/out?url=https://other.com/page') === null);

// --- tier 2: worth one request ---------------------------------------------

check('everything tier 1 caught is also worth probing',
    mayBePdfUrl('https://example.com/a.pdf') && mayBePdfUrl('https://arxiv.org/pdf/2401.1'));

check('a download path is a hint', mayBePdfUrl('https://example.com/download/12345'));
check('an attachment path is a hint', mayBePdfUrl('https://example.com/wp-content/attachment/9912'));
check('?format=pdf is a hint', mayBePdfUrl('https://example.com/article/123?format=pdf'));
check('?type=PDF is a hint, case and all', mayBePdfUrl('https://example.com/article/123?type=PDF'));
check('a query value naming a .pdf is a hint', mayBePdfUrl('https://example.com/serve?file=report.pdf'));
check('an S3 response-content-disposition naming a pdf is a hint',
    mayBePdfUrl('https://bucket.s3.amazonaws.com/x/y?response-content-disposition=attachment%3B%20filename%3Dreport.pdf'));

check('an ordinary article is not worth a request', !mayBePdfUrl('https://example.com/blog/2024/why-we-moved'));
check('a page with an explicit .html is not worth a request',
    !mayBePdfUrl('https://example.com/download/report.html'));
check('an image is not worth a request', !mayBePdfUrl('https://example.com/img/photo.jpg'));
check('a homepage is not worth a request', !mayBePdfUrl('https://example.com/'));

// --- headers ----------------------------------------------------------------

check('a content type loses its charset',
    normaliseContentType('Application/PDF; charset=binary') === 'application/pdf');

const pdfHeaders = new Headers({ 'content-type': 'application/pdf' });
check('application/pdf is a PDF', pdfFromHeaders(pdfHeaders).isPdf);

check('x-pdf is a PDF', pdfFromHeaders(new Headers({ 'content-type': 'application/x-pdf' })).isPdf);

check('octet-stream with a .pdf attachment is a PDF',
    pdfFromHeaders(new Headers({
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename="Q3 report.pdf"'
    })).isPdf);

check('text/html with a .pdf attachment is not trusted',
    !pdfFromHeaders(new Headers({
        'content-type': 'text/html; charset=utf-8',
        'content-disposition': 'attachment; filename="report.pdf"'
    })).isPdf);

check('plain HTML is not a PDF',
    !pdfFromHeaders(new Headers({ 'content-type': 'text/html; charset=utf-8' })).isPdf);

check('a quoted filename comes out unquoted',
    fileNameFromContentDisposition('attachment; filename="Q3 report.pdf"') === 'Q3 report.pdf');

check('an unquoted filename comes out too',
    fileNameFromContentDisposition('attachment; filename=report.pdf') === 'report.pdf');

check('RFC 5987 filename* is decoded and preferred',
    fileNameFromContentDisposition("attachment; filename=\"fallback.pdf\"; filename*=UTF-8''informe%20trimestral.pdf")
        === 'informe trimestral.pdf');

check('no disposition means no filename',
    fileNameFromContentDisposition(undefined) === undefined && fileNameFromContentDisposition('inline') === undefined);

// --- magic bytes ------------------------------------------------------------

check('a PDF header is recognised', isPdfBytes(Buffer.from('%PDF-1.7\n1 0 obj', 'latin1')));
check('a BOM before the header is tolerated',
    isPdfBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('%PDF-1.4', 'latin1')])));
check('a header past the first kilobyte is not',
    !isPdfBytes(Buffer.concat([Buffer.alloc(2048, 0x20), Buffer.from('%PDF-1.4', 'latin1')])));
check('an HTML login page is not a PDF', !isPdfBytes(Buffer.from('<!doctype html><html>', 'utf8')));
check('nothing is not a PDF', !isPdfBytes(null) && !isPdfBytes(Buffer.alloc(0)));

// --- names and titles -------------------------------------------------------

check('the filename comes off the path',
    pdfFileName('https://example.com/docs/Q3%20report.pdf?x=1') === 'Q3 report.pdf');

check('a disposition filename beats the path',
    pdfFileName('https://example.com/download/9912', new Headers({
        'content-disposition': 'attachment; filename="annual-review.pdf"'
    })) === 'annual-review.pdf');

check('an extensionless path gets the extension added',
    pdfFileName('https://arxiv.org/pdf/2401.12345') === '2401.12345.pdf');

check('a filename becomes a readable title',
    titleFromPdfFileName('Q3_results-final.pdf') === 'Q3 results-final');

// --- detect: tier 1 answers without touching the network --------------------

const run = async () => {
    const direct = await detectPdfUrl('https://example.com/a.pdf?sig=1#page=2');
    check('detect answers a .pdf URL from syntax alone',
        direct.isPdf && direct.detectedBy === 'extension' && direct.fileName === 'a.pdf');

    const viewer = await detectPdfUrl('https://reader.example.com/viewer.html?file=https%3A%2F%2Fx.org%2Fp.pdf');
    check('detect unwraps a viewer and says so',
        viewer.isPdf && viewer.detectedBy === 'embedded-url' && viewer.url === 'https://x.org/p.pdf');

    const article = await detectPdfUrl('https://example.com/blog/hello', { probe: false });
    check('detect leaves an ordinary article alone', !article.isPdf);

    const hinted = await detectPdfUrl('https://example.com/download/123', { probe: false });
    check('probe:false stops at tier 1 even for a hinted URL', !hinted.isPdf);

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
};

run();
