/**
 * Secrets in stored settings are AES-256-GCM encrypted with a key derived from
 * SETTINGS_ENCRYPTION_KEY, so a database dump or backup alone does not reveal them.
 *
 * Wire format: `enc:v1:<iv>.<tag>.<ciphertext>` (base64 parts). apps/parse/src/settings.js reads
 * the same format; test/fixtures/api-encrypted.json there is produced by this file
 * (`bun run settings:fixture`).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';

const deriveKey = (secret: string) => createHash('sha256').update(`webbites-settings-v1:${secret}`).digest();

export const isEncrypted = (value: unknown): value is string => typeof value === 'string' && value.startsWith(PREFIX);

export function encryptSetting(plain: string, secret: string | undefined = process.env.SETTINGS_ENCRYPTION_KEY): string {
    if (!secret) throw new Error('SETTINGS_ENCRYPTION_KEY is not set, so secrets cannot be stored');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `${PREFIX}${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${body.toString('base64')}`;
}

export function decryptSetting(value: string, secret: string | undefined = process.env.SETTINGS_ENCRYPTION_KEY): string {
    if (!isEncrypted(value)) return value;
    if (!secret) throw new Error('SETTINGS_ENCRYPTION_KEY is not set');
    const [iv, tag, body] = value.slice(PREFIX.length).split('.');
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
}
