import Tesseract from 'tesseract.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Language data: the .traineddata files shipped in the image (the working directory), or whatever
// OCR_LANG_PATH points at. Only if neither has them does it fall back to a public mirror, which
// needs outbound internet. The WASM core comes from the tesseract.js-core package, not a CDN.
function ocrLangSource(): { langPath: string; local: boolean } {
    const dir = process.env.OCR_LANG_PATH || process.cwd();
    if (existsSync(join(dir, 'eng.traineddata'))) return { langPath: dir, local: true };
    return { langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast', local: false };
}

// Tesseract scheduler setup
let tesseractScheduler: Tesseract.Scheduler | null = null;
let schedulerInitPromise: Promise<Tesseract.Scheduler> | null = null;
let jobCount = 0;
let isInitializing = false;

const WORKER_COUNT = 4; // Number of concurrent workers
const MAX_JOBS_BEFORE_RESET = 200; // Reset scheduler after this many jobs to prevent memory leaks

async function initTesseractScheduler(): Promise<Tesseract.Scheduler> {
    // If scheduler exists and hasn't exceeded job limit, return it
    if (tesseractScheduler && jobCount < MAX_JOBS_BEFORE_RESET && !isInitializing) {
        return tesseractScheduler;
    }

    // Reset if we've exceeded the job limit
    if (tesseractScheduler && jobCount >= MAX_JOBS_BEFORE_RESET && !isInitializing) {
        await tesseractScheduler.terminate();
        tesseractScheduler = null;
        jobCount = 0;
    }

    // If initialization is already in progress, wait for it
    if (schedulerInitPromise) return await schedulerInitPromise;

    // Start initialization
    isInitializing = true;
    schedulerInitPromise = (async () => {
        try {
            const newScheduler = Tesseract.createScheduler();

            const workerPromises = [];
            for (let i = 0; i < WORKER_COUNT; i++) {
                workerPromises.push(createAndAddWorker(newScheduler, i));
            }

            await Promise.all(workerPromises);

            tesseractScheduler = newScheduler;
            console.log('[Tesseract] Scheduler initialized successfully with', WORKER_COUNT, 'workers');

            return newScheduler;
        } catch (error) {
            console.error('[Tesseract] Failed to initialize scheduler:', error);
            tesseractScheduler = null;
            throw error;
        } finally {
            isInitializing = false;
            schedulerInitPromise = null;
        }
    })();

    return await schedulerInitPromise;
}

async function createAndAddWorker(scheduler: Tesseract.Scheduler, workerId: number) {
    const { langPath, local } = ocrLangSource();
    const worker = await Tesseract.createWorker('eng+fra+deu+spa+por+rus+chi_sim+jpn+kor', 1, {
        langPath,
        // Local files are used as they are: no gzip, and nothing to cache.
        gzip: false,
        ...(local ? { cacheMethod: 'none' } : {}),
        logger: m => {
            if (m.status === 'error') {
                console.error('[Tesseract Worker]', m);
            }
        }
    });

    await worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.AUTO,
        preserve_interword_spaces: '1'
    });

    scheduler.addWorker(worker);
}

export async function extractTextFromImage(input: string | Buffer): Promise<string> {
    try {
        const perfInit = performance.now();
        let nodeBuffer: Buffer;

        if (typeof input === 'string') {
            // URL path (existing logic)
            const response = await fetch(input);
            const arrayBuffer = await response.arrayBuffer();
            const imageBuffer = new Uint8Array(arrayBuffer);
            nodeBuffer = Buffer.from(imageBuffer);
        } else {
            // Buffer path (faster, no fetch)
            nodeBuffer = input;
        }

        const scheduler = await initTesseractScheduler();
        const result = await scheduler.addJob('recognize', nodeBuffer);
        jobCount++;

        const htmlText = convertOcrToHtml(result.data);
        const perfEnd = performance.now();

        log(`[Tesseract] OCR processing time: ${perfEnd - perfInit} ms`);

        return htmlText;
    } catch (error) {
        console.error('[Tesseract] Error extracting text from image:', error);
        return '';
    }
}

function convertOcrToHtml(data: any): string {
    // Try to use line data if available
    const lines = data.lines || [];

    if (lines.length > 0) {
        const paragraphs: string[] = [];
        let currentParagraph: string[] = [];
        let lastY = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineText = line.text?.trim();

            if (!lineText) {
                // Empty line might indicate paragraph break
                if (currentParagraph.length > 0) {
                    paragraphs.push(`<p>${currentParagraph.join('<br>')}</p>`);
                    currentParagraph = [];
                }
                continue;
            }

            const currentY = line.bbox?.y0 || 0;
            const lineHeight = (line.bbox?.y1 || 0) - (line.bbox?.y0 || 0);
            const lineGap = currentY - lastY;

            // Detect paragraph breaks (larger gaps between lines)
            if (currentParagraph.length > 0 && lineHeight > 0 && lineGap > lineHeight * 2) {
                paragraphs.push(`<p>${currentParagraph.join('<br>')}</p>`);
                currentParagraph = [];
            }

            currentParagraph.push(lineText);
            lastY = line.bbox?.y1 || currentY;
        }

        // Add remaining paragraph
        if (currentParagraph.length > 0) {
            paragraphs.push(`<p>${currentParagraph.join('<br>')}</p>`);
        }

        if (paragraphs.length > 0) {
            return paragraphs.join('\n');
        }
    }

    // Fallback: convert plain text to HTML with paragraphs
    const text = data.text || '';
    if (!text) return '';

    // Split by double newlines for paragraphs, single newlines for line breaks
    const textParagraphs = text.split(/\n\s*\n/);
    const htmlParagraphs = textParagraphs
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .map(p => {
            // Replace single newlines with <br> within paragraphs
            const lines = p.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            return `<p>${lines.join('<br>')}</p>`;
        });

    return htmlParagraphs.join('\n');
}
