/**
 * What a new account's library starts with (server/routes/newUserFlow.js).
 *
 * By default, one note that says what the app is for. A deployment can replace the list from a
 * Nitro plugin with `registerWelcomeBookmarks()` (the hosted service does, with its own demo
 * bookmarks). WELCOME_BOOKMARKS=false leaves new libraries empty whatever is registered.
 */

export interface WelcomeBookmark {
    url?: string;
    type?: string;
    textNote?: string;
    mediaBookmark?: Record<string, unknown>;
}

let registered: (() => WelcomeBookmark[]) | null = null;

/** Replace the default welcome bookmarks. Call once at startup, from a Nitro plugin. */
export function registerWelcomeBookmarks(list: WelcomeBookmark[] | (() => WelcomeBookmark[])): void {
    registered = typeof list === 'function' ? list : () => list;
}

export function welcomeBookmarks(): WelcomeBookmark[] {
    if (process.env.WELCOME_BOOKMARKS === 'false') return [];
    if (registered) return registered();

    const appName = process.env.APP_NAME || 'WebBites';
    return [
        {
            type: 'textNote',
            textNote: `<h2>Welcome to ${appName}</h2><p>Save anything you want to keep: pages, articles, images, notes, PDFs. ` +
                `Install the browser extension to save as you browse, then search across everything you have saved.</p>`,
        },
    ];
}
