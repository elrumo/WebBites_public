/**
 * Puts stored settings into process.env so the rest of the code (mailer, aiClients, storage/config,
 * renderService...) needs no idea where a value came from. Those modules read the environment on
 * every call, which is what makes most changes take effect without a restart.
 *
 * Precedence: a variable that was already set (non-empty) when the process started is "from the
 * environment" and is never touched. Everything else follows what is stored.
 */
import { FIELDS } from './registry';
import { decryptSetting } from './crypto';

export interface StoredRow { key: string; value: string }

/** Keys the real environment set at start-up (captured once, before anything is applied). */
let envOrigin: Set<string> | null = null;
/** Keys currently set from stored settings, with the value applied. */
const applied = new Map<string, string>();

export function captureEnvOrigin(env: NodeJS.ProcessEnv = process.env): void {
    if (envOrigin) return;
    envOrigin = new Set(FIELDS.filter((f) => (env[f.key] ?? '') !== '').map((f) => f.key));
}

/** Test hook. */
export function resetApplyState(): void {
    envOrigin = null;
    applied.clear();
}

export type FieldSource = 'env' | 'settings' | 'default';

export function sourceOf(key: string, env: NodeJS.ProcessEnv = process.env): FieldSource {
    if (envOrigin?.has(key)) return 'env';
    if (applied.has(key)) return 'settings';
    return (env[key] ?? '') !== '' ? 'env' : 'default';
}

export interface ApplyReport { applied: string[]; removed: string[]; failed: Array<{ key: string; reason: string }> }

/** Make the environment match the stored rows (adding, changing and removing). */
export function applyRows(rows: StoredRow[], env: NodeJS.ProcessEnv = process.env, secret = process.env.SETTINGS_ENCRYPTION_KEY): ApplyReport {
    captureEnvOrigin(env);
    const report: ApplyReport = { applied: [], removed: [], failed: [] };
    const present = new Set<string>();

    for (const row of rows) {
        if (!FIELDS.some((f) => f.key === row.key)) continue;
        if (envOrigin!.has(row.key)) continue; // the environment wins
        present.add(row.key);
        try {
            const value = decryptSetting(row.value, secret);
            if (applied.get(row.key) !== value || env[row.key] !== value) {
                env[row.key] = value;
                applied.set(row.key, value);
                report.applied.push(row.key);
            }
        } catch (error) {
            report.failed.push({ key: row.key, reason: error instanceof Error ? error.message : String(error) });
        }
    }

    // A setting that was removed on the page goes back to its default.
    for (const key of [...applied.keys()]) {
        if (!present.has(key)) {
            delete env[key];
            applied.delete(key);
            report.removed.push(key);
        }
    }
    return report;
}
