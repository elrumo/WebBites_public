'use strict';
/**
 * Who administers this installation.
 *
 * The admin is a user whose `role` pointer names the `_Role` called "admin" (the web
 * app and the API both check it that way). On a self-hosted install nobody has set that
 * by hand, so the first account created claims it:
 *
 *   - INITIAL_ADMIN_EMAIL set: only a user signing up with that address becomes admin.
 *   - otherwise: the very first user to sign up does.
 *
 * "First" has to survive two sign-ups landing at once. Parse keeps `_Role.name` unique, so
 * creating a role called `instance-owner` succeeds exactly once; whoever's create succeeds
 * is the owner. Later sign-ups hit the duplicate-value error and stay normal users.
 */
const ADMIN_ROLE = 'admin';
const CLAIM_ROLE = 'instance-owner';

function privateAcl() {
  // No public access of any kind: the master key is the only way in.
  const acl = new Parse.ACL();
  acl.setPublicReadAccess(false);
  acl.setPublicWriteAccess(false);
  return acl;
}

async function ensureAdminRole() {
  const query = new Parse.Query(Parse.Role);
  query.equalTo('name', ADMIN_ROLE);
  const existing = await query.first({ useMasterKey: true });
  if (existing) return existing;
  try {
    return await new Parse.Role(ADMIN_ROLE, privateAcl()).save(null, { useMasterKey: true });
  } catch (error) {
    // Lost a race with another instance creating it: read it back.
    const again = await new Parse.Query(Parse.Role).equalTo('name', ADMIN_ROLE).first({ useMasterKey: true });
    if (again) return again;
    throw error;
  }
}

/** True for exactly one caller, ever (until the claim role is deleted). */
async function claimOwnership() {
  try {
    await new Parse.Role(CLAIM_ROLE, privateAcl()).save(null, { useMasterKey: true });
    return true;
  } catch (error) {
    if (error && error.code === Parse.Error.DUPLICATE_VALUE) return false;
    throw error;
  }
}

async function makeAdmin(user) {
  const admin = await ensureAdminRole();
  user.set('role', admin);
  await user.save(null, { useMasterKey: true });
  console.log(`[instance] ${user.get('email') || user.id} is now the administrator`);
}

/** Called from the User afterSave hook (userFuncs.js) for every newly created account. */
async function assignAdminToNewUser(user) {
  try {
    const wanted = (process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
    if (wanted) {
      const email = String(user.get('email') || user.get('username') || '').toLowerCase();
      if (email === wanted) await makeAdmin(user);
      return;
    }
    if (await claimOwnership()) await makeAdmin(user);
  } catch (error) {
    console.error('[instance] could not assign the administrator:', error);
  }
}

module.exports = { ADMIN_ROLE, CLAIM_ROLE, ensureAdminRole, claimOwnership, makeAdmin, assignAdminToNewUser };
