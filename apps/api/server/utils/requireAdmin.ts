import Parse from 'parse/node.js';
import { createError, type H3Event } from 'h3';
import { requireUserId } from './requireUser';
import { initParseForBoards } from './boardUtils';

/**
 * 403 unless the signed-in user is an administrator: their `role` pointer names the `_Role` called
 * "admin" (the same rule as the website's checkIsAdmin). The first account on a self-hosted install
 * gets it automatically (apps/parse/src/cloud/instance.js).
 */
export async function requireAdmin(event: H3Event): Promise<{ userId: string; email: string }> {
    const userId = await requireUserId(event);
    initParseForBoards();
    const user = await new Parse.Query(Parse.User).include('role').get(userId, { useMasterKey: true });
    if (user.get('role')?.get('name') !== 'admin') throw createError({ statusCode: 403, statusMessage: 'Admins only' });
    return { userId, email: (user.get('email') as string) || '' };
}
