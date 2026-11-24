/**
 * Tests for following a queued Meilisearch write to its outcome. Run:
 *
 *   npm run test:meiliTask
 */

import { watchMeilisearchTask, describeFailedTask, type MeiliTaskLike } from './meilisearchTask';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}`); }
};

const clientReturning = (task: MeiliTaskLike) => ({ tasks: { waitForTask: async () => task } });
const clientThrowing = (message: string) => ({ tasks: { waitForTask: async () => { throw new Error(message); } } });

const quota: MeiliTaskLike = {
    uid: 2566,
    status: 'failed',
    error: { code: 'vector_embedding_error', message: 'insufficient_quota' },
};

(async () => {
    // A failed task is reported, with the code that names the cause.
    let errors: Error[] = [];
    await watchMeilisearchTask(clientReturning(quota), 2566, 'afterSave', (e) => errors.push(e));
    check('failed task is reported once', errors.length === 1);
    check('report carries the Meilisearch error code', errors[0]?.message.includes('vector_embedding_error'));
    check('report carries the task uid and context', errors[0]?.message.includes('2566') && errors[0]?.message.includes('afterSave'));
    check('report carries the message', errors[0]?.message.includes('insufficient_quota'));

    // A canceled task never landed either.
    errors = [];
    await watchMeilisearchTask(clientReturning({ uid: 1, status: 'canceled' }), 1, 'x', (e) => errors.push(e));
    check('canceled task is reported', errors.length === 1);

    // A task that succeeded is silent.
    errors = [];
    await watchMeilisearchTask(clientReturning({ uid: 3, status: 'succeeded' }), 3, 'x', (e) => errors.push(e));
    check('succeeded task is not reported', errors.length === 0);

    // A wait that errors says nothing about the task: no report, and no throw.
    errors = [];
    const warn = console.warn; console.warn = () => {};
    let threw = false;
    try { await watchMeilisearchTask(clientThrowing('timed out'), 4, 'x', (e) => errors.push(e)); } catch { threw = true; }
    console.warn = warn;
    check('a failed wait does not throw', !threw);
    check('a failed wait is not reported as a failed task', errors.length === 0);

    check('describe handles a missing error body', describeFailedTask({ uid: 5, status: 'failed' }, 'x').includes('no error message'));

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
