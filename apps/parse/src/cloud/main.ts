declare var require: any;

require('./userFuncs.js')
require('./newMain.js')

// A text note: a bookmark row with no URL, only text and tags.
Parse.Cloud.define("saveNote", async (request: any) => {
    // A session-authenticated caller may only write to itself. Only a master-key
    // caller (the backend's startSaveProcess, which authenticates the Raycast user
    // first) may name someone else. Without this, anyone holding the public app id
    // and JS key (both ship in every client) could plant content in any account.
    if (!request.master && !request.user) {
        throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Login required');
    }
    const ownerId = request.master ? request.params.userId : request.user.id;
    if (!ownerId) {
        throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Missing userId');
    }

    try {
        const Websites = Parse.Object.extend("websites");
        const website = new Websites();
        const userQuery = new Parse.Query(Parse.User);
        let user = await userQuery.get(ownerId, { useMasterKey: true });

        website.setACL(new Parse.ACL(user));
        website.set("url", ' ');
        website.set("user", user);
        website.set("textNote", request.params.textNote);
        website.set("tags", request.params.tags);
        website.set("type", 'textNote');

        await website.save(null, { useMasterKey: true });

        return { websiteId: website.id };
    } catch (error) {
        console.log("error saving textNote: ", error);
        throw error;
    }
});
