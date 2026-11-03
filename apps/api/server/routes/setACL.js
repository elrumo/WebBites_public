import Parse from 'parse/node.js'

Parse.initialize(import.meta.env.VITE_PARSE_ID, import.meta.env.VITE_PARSE_JS_KEY, import.meta.env.VITE_PARSE_MASTER_KEY);
Parse.serverURL = import.meta.env.VITE_PARSE_URL;

// Gets all parse users that have an ACL set to Public Read, and sets it to only their ID
export default defineEventHandler(async () => {
    let publicUsers = [];
    let processedCount = 0;
    let skip = 0;
    const batchSize = 10;
    let hasMore = true;
    
    while (hasMore) {
        const userQuery = new Parse.Query(Parse.User);
        userQuery.limit(batchSize);
        userQuery.skip(skip);
        userQuery.ascending('createdAt');
        
        const users = await userQuery.find({ useMasterKey: true });
        processedCount += users.length;
        
        if (users.length < batchSize) {
            hasMore = false;
        }
        
        const savePromises = [];
        for (const user of users) {
            const acl = user.getACL();
            if (acl && acl.getPublicReadAccess()) {
                publicUsers.push(user);
                user.setACL(new Parse.ACL(user));
                savePromises.push(user.save(null, { useMasterKey: true }));
            }
        }
        await Promise.all(savePromises);
        
        console.log(`Processed ${processedCount} users, found ${publicUsers.length} public users`);

        skip += batchSize;
    }

    return {
        total: publicUsers.length, 
        processedCount,
        publicUsers
    }
})