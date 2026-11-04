import Parse from 'parse/node.js';

/**
 * The language AI output (summaries, tags) must come back in.
 *
 * Stored per user as `userOptions.options.aiLanguage`, reusing the locale codes
 * the clients already use for their UI language, plus `'same'` meaning
 * "whatever the content is written in". Anything unknown or missing reads as
 * English, which is what a user who never opened settings gets.
 */
const AI_LANGUAGE_NAMES: Record<string, string> = {
    'en-GB': 'English',
    'en': 'English',
    'es-ES': 'Spanish',
    'es': 'Spanish',
    'es-419': 'Latin American Spanish',
    'fr': 'French',
    'de': 'German',
    'ca': 'Catalan',
    'zh': 'Chinese',
    'ja': 'Japanese',
    'ko': 'Korean',
    'same': 'the same language as the content',
};

export const DEFAULT_AI_LANGUAGE = AI_LANGUAGE_NAMES['en-GB'];

/**
 * The languages a page is told apart in: Jev picks one for `page.text` and the
 * code lands in `websites.language`. Pages in anything else stay unset.
 */
export const CONTENT_LANGUAGES: Record<string, string> = {
    en: 'English', es: 'Spanish', ca: 'Catalan', fr: 'French', de: 'German', it: 'Italian',
    pt: 'Portuguese', nl: 'Dutch', sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish',
    pl: 'Polish', cs: 'Czech', ro: 'Romanian', hu: 'Hungarian', el: 'Greek', tr: 'Turkish',
    ru: 'Russian', uk: 'Ukrainian', ar: 'Arabic', he: 'Hebrew', fa: 'Persian', hi: 'Hindi',
    th: 'Thai', vi: 'Vietnamese', id: 'Indonesian', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
};

/** The name for a stored `websites.language` code, or undefined when unset or unknown. */
export function contentLanguageName(code: unknown): string | undefined {
    return typeof code === 'string' && Object.hasOwn(CONTENT_LANGUAGES, code) ? CONTENT_LANGUAGES[code] : undefined;
}

/**
 * Maps a stored code to the phrase a prompt can use. With 'same' and a known
 * page language the phrase is that language's name. Pure — see the test.
 */
export function aiLanguageName(code: unknown, contentLanguage?: unknown): string {
    if (code === 'same') {
        const name = contentLanguageName(contentLanguage);
        if (name) return name;
    }
    return (typeof code === 'string' && AI_LANGUAGE_NAMES[code]) || DEFAULT_AI_LANGUAGE;
}

/**
 * Reads the user's AI output language. Never throws: a lookup failure is
 * English. `contentLanguage` is the page's `websites.language`, if known.
 */
export async function getAiLanguage(userId?: string | null, contentLanguage?: unknown): Promise<string> {
    if (!userId) return DEFAULT_AI_LANGUAGE;
    try {
        const options = await new Parse.Query('userOptions')
            .equalTo('user', { __type: 'Pointer', className: '_User', objectId: userId })
            .first({ useMasterKey: true });
        return aiLanguageName(options?.get('options')?.aiLanguage, contentLanguage);
    } catch (error: any) {
        console.error('[getAiLanguage] falling back to default:', error?.message || error);
        return DEFAULT_AI_LANGUAGE;
    }
}
