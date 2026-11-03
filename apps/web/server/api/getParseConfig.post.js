import Parse from 'parse/node';
// import Parse from 'parse/node';


export default defineEventHandler(async (event) => {
    try {
        let body = await readBody(event)
        const config = await Parse.Config.get();

        return config
    } catch (error) {
        console.log("Error gettng parse config: ", error);
        return {error}
    }
})