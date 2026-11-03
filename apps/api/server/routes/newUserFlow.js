import Parse from 'parse/node.js'
import { runBillingHook } from '../utils/billing'
import { sendToQstash, callBackendEndpoint } from '../utils/serverUtils.js'

Parse.initialize(process.env.VITE_PARSE_ID, process.env.VITE_PARSE_JS_KEY, process.env.VITE_PARSE_MASTER_KEY)
Parse.serverURL = process.env.VITE_PARSE_URL;

const UserOptions = Parse.Object.extend("userOptions");

export default defineEventHandler(async (event) => {
    try {
        const rawBody = await readBody(event)
        const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody
        let { userId } = body;

        const user = await getParseUser(userId);
        console.log('[newUserFlow] user: ', user.id);

        // Execute both operations concurrently for better performance
        const [billingResult, sitesResult, parseUserOptions] = await Promise.allSettled([
            setParseUserOptions(user).catch(error => {
                console.error("[newUserFlow] Failed to set user options: ", error);
                return null;
            }),
            // Billing provider hook (a Stripe customer on the hosted service; nothing otherwise)
            runBillingHook('onUserCreated', user),
            firstSitesToSave(userId).catch(error => {
                console.error("[newUserFlow] Failed to save user websites: ", error);
                return null;
            })
        ]);

        // // send welcome email

        // // Set user options

        return 'User created successfully'
    } catch (error) {
        console.log("[newUserFlow] Error creating user:", error)
        throw error;
    }
})

async function getParseUser(userId){
    const User = Parse.Object.extend("_User");
    const query = new Parse.Query(User);
    const user = await query.get(userId, { useMasterKey: true });
    if (!user) {
        throw new Error('[newUserFlow] User not found');
    }
    return user
}

async function firstSitesToSave(userId){
    // A note to start the library with. WELCOME_BOOKMARKS=false leaves new libraries empty.
    if (process.env.WELCOME_BOOKMARKS === 'false') return 'Welcome bookmarks disabled'

    const appName = process.env.APP_NAME || 'WebBites'
    const sitesToSave = [
        {
            savedFrom: 'firstLogin',
            type: 'textNote',
            textNote: `<h2>Welcome to ${appName}</h2><p>Save anything you want to keep: pages, articles, images, notes, PDFs. ` +
                `Install the browser extension to save as you browse, then search across everything you have saved.</p>`
        }
    ]

    log("Saving first sites")

    try {
        const batchItems = []

        for (const bookmark of sitesToSave) {
            batchItems.push({
                userId,
                url: bookmark.url,
                type: bookmark.type || 'website',
                savedFrom: 'firstLogin',
                fromCache: false,
                siteNotes: null,
                textNote: bookmark.textNote || null,
                customId: null,
                mediaBookmark: bookmark.mediaBookmark || null // Add mediaBookmark to batch item
            })
        }

        if (batchItems.length > 0) {
            try {
                await callBackendEndpoint('v1/content/saveBookmark', batchItems, { timeout: 120000, retries: 1 })
            } catch (error) {
                console.error('[newUserFlow] Failed batch save via saveBookmark:', error)
            }
        }


        return 'Websites saved!';
    } catch (error) {
        console.error("newUserFlow - Failed to save user websites: ", error);
        throw error;
    }
}

async function setParseUserOptions(user){
    const defaultUserOptions = {
        screenshotAsThumbnail: false,
        displayMode: 'grid',
        imageRatio: 'original',
        previewTags: true,
        summaryCardOnHover: true,
        orderBy: 'newFirst',
        language: 'en-GB',
        aiLanguage: 'en-GB',
      }

    try {
        let userOptions = new UserOptions();

        userOptions.set('user', user);
        userOptions.set('options', defaultUserOptions);
        userOptions.setACL(new Parse.ACL(user))
        
        user.set('userOptions', userOptions);
        await user.save(null, { useMasterKey: true });
    } catch (error) {
        console.log("newUserFlow - Failed to set user options: ", error);
    }
}
