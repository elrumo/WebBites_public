/** Talking to Parse's internal endpoints (apps/parse/src/index.js): its status, and a restart. */

/** Parse's origin inside the network (VITE_PARSE_URL is `http://parse:1337/parse`). */
function parseOrigin(): string {
    const url = process.env.VITE_PARSE_URL || '';
    try { return new URL(url).origin; } catch { return ''; }
}

const masterHeaders = () => ({ 'X-Parse-Master-Key': process.env.VITE_PARSE_MASTER_KEY || '' });

export interface ParseStatus {
    up: boolean;
    usedLastGood?: boolean;
    lastError?: string | null;
    revision?: string;
}

export async function parseStatus(): Promise<ParseStatus> {
    const origin = parseOrigin();
    if (!origin) return { up: false };
    try {
        const health = await fetch(`${origin}/parse/health`, { signal: AbortSignal.timeout(3000) });
        if (!health.ok) return { up: false };
    } catch { return { up: false }; }
    try {
        const response = await fetch(`${origin}/_internal/status`, { headers: masterHeaders(), signal: AbortSignal.timeout(3000) });
        if (response.ok) return { up: true, ...(await response.json() as object) };
    } catch { /* up, but no details */ }
    return { up: true };
}

/** Ask Parse to exit so its container restarts with the stored settings. */
export async function restartParse(retry = false): Promise<{ ok: boolean; reason?: string }> {
    const origin = parseOrigin();
    if (!origin) return { ok: false, reason: 'VITE_PARSE_URL is not set' };
    try {
        const response = await fetch(`${origin}/_internal/restart${retry ? '?retry=1' : ''}`, {
            method: 'POST', headers: masterHeaders(), signal: AbortSignal.timeout(5000),
        });
        return response.ok ? { ok: true } : { ok: false, reason: `Parse answered ${response.status}` };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
}
