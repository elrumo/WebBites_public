import Parse from 'parse/node.js'
Parse.initialize(import.meta.env.VITE_PARSE_ID, import.meta.env.VITE_PARSE_JS_KEY, import.meta.env.VITE_PARSE_MASTER_KEY);
Parse.serverURL = import.meta.env.VITE_PARSE_URL;

export default defineEventHandler(async (event) => {
    let body = await readBody(event)  
    let userId = body.userId
    let returnOnly = body.returnOnly !== undefined ? body.returnOnly : true; // Fixed typo: boyd -> body
    let users = [];

    try {
        if (!userId) {
            const userQuery = new Parse.Query(Parse.User);
            userQuery.select('websiteCount');
            userQuery.greaterThanOrEqualTo('websiteCount', 2);
            users = await userQuery.find({ useMasterKey: true });
        } else {
            const userQuery = new Parse.Query(Parse.User);
            userQuery.select('websiteCount');
            userQuery.equalTo('objectId', userId);
            users = [await userQuery.first({ useMasterKey: true })]
        }

        let allDuplicates = [];
        let totalRemoved = 0;

        for (const user of users) {
            const websiteQuery = new Parse.Query('websites');
            websiteQuery.equalTo('user', user);
            websiteQuery.limit(9999);
            websiteQuery.select('url');
            const websites = await websiteQuery.find({ useMasterKey: true });

            const urlMap = new Map();
            const duplicates = [];

            for (const website of websites) {
                const url = website.get('url');
                if (urlMap.has(url)) {
                    duplicates.push(website);
                } else {
                    urlMap.set(url, true);
                }
            }

            if (returnOnly) {
                // Return list of duplicate items
                allDuplicates.push(...duplicates.map(d => ({
                    id: d.id,
                    url: d.get('url'),
                    userId: user.id
                })));
            } else {
                // Remove duplicates from DB
                for (const duplicate of duplicates) {
                    await duplicate.destroy({ useMasterKey: true });
                }
                totalRemoved += duplicates.length;
            }
        }

        if (returnOnly) {
            return { duplicates: allDuplicates, count: allDuplicates.length };
        } else {
            return { totalRemoved };
        }

    } catch (error) {
        console.log("Error processing websites for user: ", userId, error.message);
        return { error: error.message, userId };
    }
})