import Parse from 'parse/node';
import { ensureParseInitialized } from '../utils/parseRuntime'

export default defineEventHandler(async (event) => {
  ensureParseInitialized()

  // Normalize request body across web fetch and Tauri plugin-http
  let body;
  try {
    // 1) Try raw body first to avoid JSON parse exceptions
    let raw = await readRawBody(event);
    if (Buffer.isBuffer(raw)) {
      raw = raw.toString('utf-8');
    }

    if (typeof raw === 'string' && raw.length) {
      try {
        body = JSON.parse(raw);
      } catch (_) {
        // Not valid JSON; leave body undefined and try parsed body next
      }
    } else if (raw && typeof raw === 'object') {
      body = raw;
    }

    // 2) If still empty/null, try parsed body (may throw on invalid JSON)
    if (!body || (typeof body === 'object' && Object.keys(body).length === 0)) {
      try {
        body = await readBody(event);
      } catch (_) {
        // Swallow invalid JSON errors and continue with empty object
        body = {};
      }
    }

    // 3) Unwrap possible { type: 'Json', payload: {...} } structure
    if (body && typeof body === 'object' && 'payload' in body && body.type === 'Json') {
      body = body.payload;
    }
  } catch (error) {
    console.error('[authFlow] Error normalizing body:', error);
    body = {};
  }

  // Guard against non-object bodies
  if (!body || typeof body !== 'object') {
    body = {};
  }

  try {
      let funcName = body?.funcName || 'authFlow';
      let email = body.email ? body.email : null;
      let name = body.name ? body.name : null;
      let password = body.password ? body.password : null;
      let isNewUser = true;

      const query = new Parse.Query(Parse.User);
      if (funcName == 'signup'){
          console.log("funcName: ", funcName);
          try {

              // TODO: Update to use Qstash
              let userObj = {
                  email: email,
                  username: name,
                  password: password
              }

              let newUser = await $fetch('/api/callBackend', { method: 'post', body: { endpoint: 'signUpUser', data: userObj }});

              // let newUser = await Parse.Cloud.run("signUpUser", {
              //     email: email,
              //     name: name,
              //     password: password
              // });

              isNewUser = true;

              return { isNewUser, newUser }
          } catch (error) {
              console.log("error signup:", error);
              return {error}
          }
      }

      if (funcName == 'findEmail'){
        console.log('email: ', email)
        const users = await query.equalTo("email", email).find({ useMasterKey: true });
        isNewUser = users.length == 0;

        return { isNewUser }
        // return {users}
      }

      return
  } catch (error) {
      console.log('error in saveWaitlist: ', error)
      throw error
  }
})
