/**
 * Every setting the admin page can change, in one list. The page renders from it, the API
 * validates against it, and `parse: true` marks the ones Parse reads too (it restarts to pick
 * them up; the allow-list in apps/parse/src/settings.js must match, see scripts/check-settings-keys.mjs).
 *
 * The key IS the environment variable name. Precedence: a variable set in the real environment
 * wins (the field shows as locked), then what is stored here, then the built-in default.
 */

export type FieldKind = 'text' | 'secret' | 'number' | 'url' | 'select';

export interface SettingField {
    key: string;
    group: string;
    label: string;
    kind: FieldKind;
    help?: string;
    placeholder?: string;
    options?: Array<{ value: string; label: string }>;
    min?: number;
    max?: number;
    /** Parse reads this too, and needs a restart to see a change. */
    parse?: boolean;
    /** How the API picks up a change: immediately, or only after it restarts. */
    api: 'live' | 'restart';
}

export interface SettingGroup {
    id: string;
    title: string;
    description: string;
    /** Something to read before changing it. */
    warning?: string;
    /** Whether the page offers a connection test for the group. */
    testable: boolean;
}

export const GROUPS: SettingGroup[] = [
    { id: 'mail', title: 'Email', testable: true,
      description: 'Used for password resets, board invitations and email-address changes. Without it, invitation links are shown in the app to copy by hand.' },
    { id: 'ai', title: 'AI endpoint', testable: true,
      description: 'Any OpenAI-compatible server: OpenAI, LiteLLM, Ollama, vLLM, OpenRouter. Turns on summaries, tagging, audio and semantic search.',
      warning: 'Changing the embedding model leaves older bookmarks embedded with the old one until they are re-indexed.' },
    { id: 'storage', title: 'File storage', testable: true,
      description: 'Where uploaded files, screenshots and saved pages live: inside MongoDB (default) or in any S3-compatible bucket.',
      warning: 'Switching does not move existing files. Files saved before the change keep their old address and are lost to the app if the old store goes away.' },
    { id: 'search', title: 'Search (Meilisearch)', testable: true,
      description: 'Use an existing Meilisearch instead of the bundled one.',
      warning: 'A new Meilisearch starts empty. Re-index from the Search index tab afterwards.' },
    { id: 'screenshots', title: 'Screenshot service', testable: true,
      description: 'The headless-browser service that takes page screenshots. Without it, bookmark cards use the page\'s own preview image.' },
    { id: 'branding', title: 'Name and contact', testable: false,
      description: 'Shown in emails and sign-in screens.' },
];

const yesNo = [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }];

export const FIELDS: SettingField[] = [
    // ---- email --------------------------------------------------------------------------------
    { key: 'MAIL_PROVIDER', group: 'mail', label: 'Provider', kind: 'select', parse: true, api: 'live',
      options: [{ value: 'smtp', label: 'SMTP' }, { value: 'mailgun', label: 'Mailgun' }, { value: 'none', label: 'Off' }] },
    { key: 'MAIL_FROM', group: 'mail', label: 'Send from', kind: 'text', parse: true, api: 'live', placeholder: 'WebBites <noreply@example.com>' },
    { key: 'SMTP_HOST', group: 'mail', label: 'SMTP server', kind: 'text', parse: true, api: 'live', placeholder: 'smtp.example.com' },
    { key: 'SMTP_PORT', group: 'mail', label: 'SMTP port', kind: 'number', parse: true, api: 'live', min: 1, max: 65535, placeholder: '587' },
    { key: 'SMTP_SECURE', group: 'mail', label: 'Use TLS from the start', kind: 'select', parse: true, api: 'live', options: yesNo,
      help: 'Yes for port 465. No for 587, which upgrades with STARTTLS.' },
    { key: 'SMTP_USER', group: 'mail', label: 'SMTP user', kind: 'text', parse: true, api: 'live' },
    { key: 'SMTP_PASS', group: 'mail', label: 'SMTP password', kind: 'secret', parse: true, api: 'live' },
    { key: 'MAILGUN_API_KEY', group: 'mail', label: 'Mailgun API key', kind: 'secret', parse: true, api: 'live' },
    { key: 'MAILGUN_DOMAIN', group: 'mail', label: 'Mailgun domain', kind: 'text', parse: true, api: 'live' },
    { key: 'MAILGUN_API_URL', group: 'mail', label: 'Mailgun API address', kind: 'url', parse: true, api: 'live',
      placeholder: 'https://api.mailgun.net', help: 'https://api.eu.mailgun.net for the EU region.' },

    // ---- AI -----------------------------------------------------------------------------------
    { key: 'AI_API_BASE_URL', group: 'ai', label: 'Server address', kind: 'url', api: 'live',
      placeholder: 'https://api.openai.com', help: 'The server root, without /v1.' },
    { key: 'AI_API_KEY', group: 'ai', label: 'API key', kind: 'secret', api: 'live' },
    { key: 'AI_API_STYLE', group: 'ai', label: 'Model names', kind: 'select', api: 'live',
      options: [{ value: 'openai', label: 'As typed (OpenAI, Ollama, vLLM...)' }, { value: 'litellm', label: 'Prefixed with the vendor (LiteLLM proxy)' }] },
    { key: 'AI_TEXT_MODEL', group: 'ai', label: 'Text model', kind: 'text', api: 'live', placeholder: 'gpt-4o-mini' },
    { key: 'AI_MULTIMODAL_MODEL', group: 'ai', label: 'Model for images', kind: 'text', api: 'live', help: 'Defaults to the text model.' },
    { key: 'EMBEDDING_MODEL', group: 'ai', label: 'Embedding model', kind: 'text', api: 'live', placeholder: 'text-embedding-3-small' },

    // ---- storage ------------------------------------------------------------------------------
    { key: 'FILES_DRIVER', group: 'storage', label: 'Keep files in', kind: 'select', parse: true, api: 'live',
      options: [{ value: 'gridfs', label: 'MongoDB' }, { value: 's3', label: 'S3-compatible bucket' }] },
    { key: 'S3_BUCKET', group: 'storage', label: 'Bucket', kind: 'text', parse: true, api: 'live' },
    { key: 'S3_ENDPOINT_URL', group: 'storage', label: 'Endpoint', kind: 'url', parse: true, api: 'live', placeholder: 'https://s3.eu-west-1.amazonaws.com' },
    { key: 'S3_REGION', group: 'storage', label: 'Region', kind: 'text', parse: true, api: 'live', placeholder: 'us-east-1' },
    { key: 'S3_ACCESS_KEY', group: 'storage', label: 'Access key', kind: 'secret', parse: true, api: 'live' },
    { key: 'S3_SECRET_KEY', group: 'storage', label: 'Secret key', kind: 'secret', parse: true, api: 'live' },
    { key: 'S3_PUBLIC_URL', group: 'storage', label: 'Public address of the bucket', kind: 'url', parse: true, api: 'live',
      help: 'Where browsers load files from, for example https://cdn.example.com or https://example.com/s3/webbites.' },

    // ---- search -------------------------------------------------------------------------------
    { key: 'MEILISEARCH_HOST', group: 'search', label: 'Address', kind: 'url', api: 'restart', placeholder: 'http://meilisearch:7700' },
    { key: 'MEILISEARCH_API_KEY', group: 'search', label: 'API key', kind: 'secret', api: 'restart' },

    // ---- screenshots --------------------------------------------------------------------------
    { key: 'SCREENSHOT_SERVICE_URL', group: 'screenshots', label: 'Service address', kind: 'url', api: 'live', placeholder: 'http://screenshot:3000' },
    { key: 'SCREENSHOT_API_KEY', group: 'screenshots', label: 'API key', kind: 'secret', api: 'live' },

    // ---- branding -----------------------------------------------------------------------------
    { key: 'APP_NAME', group: 'branding', label: 'Name', kind: 'text', parse: true, api: 'live', placeholder: 'WebBites' },
    { key: 'SUPPORT_EMAIL', group: 'branding', label: 'Support address', kind: 'text', api: 'live', placeholder: 'help@example.com' },
];

export const fieldByKey = (key: string): SettingField | undefined => FIELDS.find((f) => f.key === key);

/** The keys Parse is allowed to read; apps/parse/src/settings.js lists the same. */
export const PARSE_KEYS = FIELDS.filter((f) => f.parse).map((f) => f.key);

export interface ValidationResult {
    ok: boolean;
    /** key -> normalised value, or null to remove the stored setting */
    values: Record<string, string | null>;
    errors: Record<string, string>;
}

/** Check a set of changes. `null` or an empty string removes a stored value. */
export function validateChanges(changes: Record<string, unknown>): ValidationResult {
    const values: Record<string, string | null> = {};
    const errors: Record<string, string> = {};

    for (const [key, raw] of Object.entries(changes ?? {})) {
        const field = fieldByKey(key);
        if (!field) { errors[key] = 'Not a setting that can be changed here.'; continue; }
        if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) { values[key] = null; continue; }
        if (typeof raw !== 'string' && typeof raw !== 'number') { errors[key] = 'Must be text.'; continue; }
        const value = String(raw).trim();
        const max = field.kind === 'secret' ? 4000 : 500;
        if (value.length > max) { errors[key] = `Too long (at most ${max} characters).`; continue; }
        if (/[\r\n\0]/.test(value)) { errors[key] = 'Must be a single line.'; continue; }

        if (field.kind === 'select' && !field.options!.some((o) => o.value === value)) {
            errors[key] = `Must be one of: ${field.options!.map((o) => o.value).join(', ')}.`; continue;
        }
        if (field.kind === 'number') {
            const n = Number(value);
            if (!Number.isInteger(n) || n < (field.min ?? 0) || n > (field.max ?? Number.MAX_SAFE_INTEGER)) {
                errors[key] = `Must be a whole number${field.min !== undefined ? ` from ${field.min} to ${field.max}` : ''}.`; continue;
            }
        }
        if (field.kind === 'url') {
            try {
                const u = new URL(value);
                if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
            } catch { errors[key] = 'Must be a full http:// or https:// address.'; continue; }
        }
        values[key] = value;
    }
    return { ok: Object.keys(errors).length === 0, values, errors };
}

/** What a change needs before it takes effect. */
export function restartNeeded(changedKeys: string[]): { parse: boolean; api: boolean } {
    let parse = false;
    let api = false;
    for (const key of changedKeys) {
        const field = fieldByKey(key);
        if (!field) continue;
        if (field.parse) parse = true;
        if (field.api === 'restart') api = true;
    }
    return { parse, api };
}
