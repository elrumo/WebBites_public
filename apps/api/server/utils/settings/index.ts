/**
 * Loading stored settings into the running process.
 *
 * `loadSettings()` runs at start-up (plugins/00-settings.ts) and again whenever the admin page saves.
 * Anything that must see the stored values at boot awaits `settingsReady()` first.
 */
import { applyRows, captureEnvOrigin, type ApplyReport } from './apply';
import { readStoredRows } from './store';

let ready: Promise<void> | null = null;
let lastReport: ApplyReport | null = null;
let lastLoadError: string | null = null;

export function settingsLastReport() { return { report: lastReport, error: lastLoadError }; }

/** Read the rows and apply them. One failure is logged, never thrown: the environment alone is a valid setup. */
export async function loadSettings(): Promise<ApplyReport | null> {
    captureEnvOrigin();
    try {
        const rows = await readStoredRows();
        lastReport = applyRows(rows);
        lastLoadError = null;
        if (lastReport.applied.length) console.log(`[settings] applied from the admin page: ${lastReport.applied.join(', ')}`);
        for (const f of lastReport.failed) console.warn(`[settings] ${f.key}: ${f.reason}`);
        return lastReport;
    } catch (error) {
        lastLoadError = error instanceof Error ? error.message : String(error);
        console.warn(`[settings] could not read stored settings: ${lastLoadError}`);
        return null;
    }
}

/** Start-up load with a few retries, since Parse may still be coming up. */
export function startSettingsLoad(attempts = 15, delayMs = 2000): Promise<void> {
    if (!ready) {
        captureEnvOrigin();
        ready = (async () => {
            for (let i = 0; i < attempts; i++) {
                if (await loadSettings()) return;
                await new Promise((r) => setTimeout(r, delayMs));
            }
        })();
    }
    return ready;
}

export function settingsReady(): Promise<void> {
    return ready ?? Promise.resolve();
}
