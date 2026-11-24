/**
 * Meilisearch answers `addDocuments` as soon as the write is *queued*. Whether
 * it lands is decided later, and a failure there (an embedder with no OpenAI
 * credit, a document it rejects) never reaches the caller: the save looks
 * fine, the bookmark is in Parse, and it is simply missing from search.
 *
 * `watchMeilisearchTask` follows the queued task in the background and reports
 * a failed one. It is deliberately not awaited by the save path — a failing
 * embedder retries for minutes (about 8 per task), and a bookmark save must
 * not wait on that.
 *
 *   npm run test:meiliTask
 */

export interface MeiliTaskLike {
    uid: number;
    status: string;
    error?: { message?: string; code?: string; type?: string } | null;
}

export interface MeiliTasksClient {
    tasks: {
        waitForTask(uid: number, options?: { timeout?: number; interval?: number }): Promise<MeiliTaskLike>;
    };
}

/** Longer than a failing embedder's retries, so its failure is seen. */
export const TASK_WATCH_TIMEOUT_MS = 20 * 60_000;
const TASK_WATCH_INTERVAL_MS = 2_000;

/** The one-line description of a failed task, with the code that names the cause. */
export function describeFailedTask(task: MeiliTaskLike, context: string): string {
    const code = task.error?.code ? ` [${task.error.code}]` : '';
    return `Meilisearch task ${task.uid} (${context}) ${task.status}${code}: ${task.error?.message ?? 'no error message'}`;
}

/**
 * Resolves once the task is final; never rejects. `onFailure` gets an Error, and the task
 * itself (its `error.code` says why), for a task that failed or was canceled. A wait that itself errors (timeout,
 * network) says nothing about the task, so it is only logged.
 */
export async function watchMeilisearchTask(
    client: MeiliTasksClient,
    taskUid: number,
    context: string,
    onFailure: (error: Error, task: MeiliTaskLike) => void,
    options: { timeout?: number; interval?: number } = {},
): Promise<void> {
    let task: MeiliTaskLike;
    try {
        task = await client.tasks.waitForTask(taskUid, {
            timeout: options.timeout ?? TASK_WATCH_TIMEOUT_MS,
            interval: options.interval ?? TASK_WATCH_INTERVAL_MS,
        });
    } catch (error: any) {
        console.warn(`[meilisearchTask] stopped waiting for task ${taskUid} (${context}): ${error?.message || error}`);
        return;
    }

    if (task.status === 'failed' || task.status === 'canceled') {
        onFailure(new Error(describeFailedTask(task, context)), task);
    }
}
