/**
 * "Test connection" for each group of settings. Every test works on the values the admin is about
 * to save (a field left blank falls back to what is in effect now, so a stored secret need not be
 * typed again), and none of them changes anything.
 */
import { Client as MinioClient } from 'minio';
import { sendMail, verifyMail } from '../mailer';

export interface TestResult { ok: boolean; message: string }

export type Candidate = Record<string, string | undefined>;

/** Candidate value, else the one in effect now. */
const pick = (candidate: Candidate, key: string): string => {
    const given = candidate[key];
    return ((given !== undefined && given !== '' ? given : process.env[key]) ?? '').trim();
};

const fail = (e: unknown): TestResult => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 10000) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, ok: response.ok, body, text };
}

export async function testMail(candidate: Candidate, sendTo?: string): Promise<TestResult> {
    const keys = ['MAIL_PROVIDER', 'MAIL_FROM', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE',
        'MAILGUN_API_KEY', 'MAILGUN_DOMAIN', 'MAILGUN_API_URL', 'APP_NAME'];
    const overrides: Record<string, string> = {};
    for (const key of keys) overrides[key] = key === 'SMTP_PASS' && !candidate[key] ? (process.env[key] ?? '') : pick(candidate, key);

    const verified = await verifyMail(overrides);
    if (!verified.success) return { ok: false, message: verified.reason ?? 'The mail server did not accept the connection.' };
    if (!sendTo) return { ok: true, message: 'Connected and signed in.' };

    const sent = await sendMail({
        to: sendTo,
        subject: 'WebBites test email',
        text: 'If you can read this, email from your WebBites installation works.',
    }, overrides);
    return sent.success
        ? { ok: true, message: `Connected, and a test email is on its way to ${sendTo}.` }
        : { ok: false, message: sent.reason ?? 'The test email was not accepted.' };
}

export async function testAi(candidate: Candidate): Promise<TestResult> {
    const base = pick(candidate, 'AI_API_BASE_URL').replace(/\/+$/, '');
    const key = pick(candidate, 'AI_API_KEY');
    if (!base) return { ok: false, message: 'Enter the server address first.' };
    try {
        const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
        const models = await fetchJson(`${base}/v1/models`, { headers });
        if (models.status === 401 || models.status === 403) return { ok: false, message: 'The server rejected the API key.' };
        if (!models.ok && models.status !== 404) return { ok: false, message: `The server answered ${models.status}.` };

        const model = pick(candidate, 'AI_TEXT_MODEL');
        if (!model) return { ok: true, message: 'The server answers. Enter a text model to test it too.' };

        const style = pick(candidate, 'AI_API_STYLE');
        const name = style === 'litellm' && !model.includes('/') ? `openai/${model}` : model;
        const chat = await fetchJson(`${base}/v1/chat/completions`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: name, max_tokens: 5, messages: [{ role: 'user', content: 'Reply with the word OK.' }] }),
        }, 30000);
        if (!chat.ok) {
            const reason = chat.body?.error?.message ?? chat.body?.message ?? chat.text.slice(0, 160);
            return { ok: false, message: `The model "${model}" did not answer (${chat.status}): ${reason}` };
        }
        return { ok: true, message: `The server answers and "${model}" works.` };
    } catch (e) { return fail(e); }
}

export async function testStorage(candidate: Candidate): Promise<TestResult> {
    const driver = pick(candidate, 'FILES_DRIVER') || (pick(candidate, 'S3_BUCKET') ? 's3' : 'gridfs');
    if (driver !== 's3') return { ok: true, message: 'Files are kept in MongoDB. Nothing to connect to.' };

    const bucket = pick(candidate, 'S3_BUCKET');
    const endpoint = pick(candidate, 'S3_ENDPOINT_URL');
    if (!bucket || !endpoint) return { ok: false, message: 'Enter the bucket and the endpoint.' };
    try {
        const url = new URL(endpoint);
        const client = new MinioClient({
            endPoint: url.hostname,
            port: url.port ? Number(url.port) : undefined,
            useSSL: url.protocol === 'https:',
            region: pick(candidate, 'S3_REGION') || 'us-east-1',
            accessKey: pick(candidate, 'S3_ACCESS_KEY'),
            secretKey: pick(candidate, 'S3_SECRET_KEY'),
            pathStyle: true,
        });
        const exists = await Promise.race([
            client.bucketExists(bucket),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Timed out after 10 seconds.')), 10000)),
        ]);
        if (!exists) return { ok: false, message: `Connected, but the bucket "${bucket}" does not exist.` };
        if (!pick(candidate, 'S3_PUBLIC_URL')) return { ok: true, message: 'The bucket is reachable. Also set the public address, or browsers cannot load files.' };
        return { ok: true, message: `The bucket "${bucket}" is reachable.` };
    } catch (e) { return fail(e); }
}

export async function testSearch(candidate: Candidate): Promise<TestResult> {
    const host = pick(candidate, 'MEILISEARCH_HOST').replace(/\/+$/, '');
    if (!host) return { ok: false, message: 'Enter the address first.' };
    try {
        const health = await fetchJson(`${host}/health`);
        if (!health.ok) return { ok: false, message: `The server answered ${health.status} on /health.` };
        const key = pick(candidate, 'MEILISEARCH_API_KEY');
        const stats = await fetchJson(`${host}/stats`, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
        if (stats.status === 401 || stats.status === 403) return { ok: false, message: 'Meilisearch is up, but rejected the API key.' };
        const version = await fetchJson(`${host}/version`, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
        const v = version.body?.pkgVersion as string | undefined;
        if (v) {
            const [major, minor] = v.split('.').map(Number);
            if (major < 1 || (major === 1 && minor < 12)) return { ok: false, message: `Meilisearch ${v} is too old; WebBites needs 1.12 or newer.` };
        }
        return { ok: true, message: v ? `Meilisearch ${v} is up and accepts the key.` : 'Meilisearch is up and accepts the key.' };
    } catch (e) { return fail(e); }
}

export async function testScreenshots(candidate: Candidate): Promise<TestResult> {
    const base = pick(candidate, 'SCREENSHOT_SERVICE_URL').replace(/\/+$/, '').replace(/\/(screenshot|render)$/, '');
    if (!base) return { ok: false, message: 'Enter the service address first.' };
    try {
        const health = await fetchJson(`${base}/health`);
        if (!health.ok) return { ok: false, message: `The service answered ${health.status} on /health.` };
        // An empty request is answered 400 when the key is right and 401 when it is not.
        const probe = await fetchJson(`${base}/screenshot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-Key': pick(candidate, 'SCREENSHOT_API_KEY') },
            body: '{}',
        });
        if (probe.status === 401) return { ok: false, message: 'The service is up, but rejected the API key.' };
        return { ok: true, message: 'The screenshot service is up and accepts the key.' };
    } catch (e) { return fail(e); }
}

export const SERVICE_TESTS: Record<string, (candidate: Candidate, sendTo?: string) => Promise<TestResult>> = {
    mail: testMail,
    ai: testAi,
    storage: testStorage,
    search: testSearch,
    screenshots: testScreenshots,
};
