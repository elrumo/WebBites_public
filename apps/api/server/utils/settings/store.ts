/** Reads and writes the `AppSettings` Parse class (master key only; see apps/parse/src/schema.js). */
import Parse from 'parse/node.js';
import { initParseForBoards } from '../boardUtils';
import { encryptSetting } from './crypto';
import { fieldByKey } from './registry';
import type { StoredRow } from './apply';

const CLASS = 'AppSettings';

export async function readStoredRows(): Promise<Array<StoredRow & { updatedAt?: Date }>> {
    initParseForBoards();
    const rows = await new Parse.Query(CLASS).limit(1000).find({ useMasterKey: true });
    return rows.map((r) => ({ key: r.get('key') as string, value: r.get('value') as string, updatedAt: r.updatedAt }));
}

export interface WhoChanged { userId: string; email?: string }

/**
 * Store validated changes: a string sets, null removes. Secrets are encrypted here. Returns the keys
 * that really changed (not those saved with the value they already had).
 */
export async function writeChanges(values: Record<string, string | null>, who: WhoChanged): Promise<string[]> {
    initParseForBoards();
    const existing = new Map<string, Parse.Object>();
    for (const row of await new Parse.Query(CLASS).limit(1000).find({ useMasterKey: true })) existing.set(row.get('key'), row);

    const { decryptSetting } = await import('./crypto');
    const changed: string[] = [];
    const toSave: Parse.Object[] = [];
    const toDelete: Parse.Object[] = [];

    for (const [key, value] of Object.entries(values)) {
        const field = fieldByKey(key)!;
        const row = existing.get(key);
        if (value === null) {
            if (row) { toDelete.push(row); changed.push(key); }
            continue;
        }
        if (row) {
            let same = false;
            try { same = decryptSetting(row.get('value')) === value; } catch { /* unreadable: overwrite */ }
            if (same) continue;
        }
        const target = row ?? new Parse.Object(CLASS);
        target.set('key', key);
        target.set('secret', field.kind === 'secret');
        target.set('value', field.kind === 'secret' ? encryptSetting(value) : value);
        target.set('updatedBy', who.userId);
        toSave.push(target);
        changed.push(key);
    }

    if (toSave.length) await Parse.Object.saveAll(toSave, { useMasterKey: true });
    if (toDelete.length) await Parse.Object.destroyAll(toDelete, { useMasterKey: true });

    if (changed.length) {
        // Names only. A value, even an encrypted one, never goes in the log.
        const audit = new Parse.Object('SettingsAudit');
        audit.set('userId', who.userId);
        audit.set('email', who.email ?? '');
        audit.set('keys', changed);
        audit.set('action', 'update');
        await audit.save(null, { useMasterKey: true });
    }
    return changed;
}
