import { Client } from '@upstash/qstash';
import { getFlowControlConfig } from './flowControl';
import type { EnqueueOptions, EnqueueResult, JobQueue } from './types';

/** The two QStash calls the driver makes; lets tests inject a fake. */
export interface QstashPublisher {
    publishJSON(message: any): Promise<any>;
    batchJSON(messages: any[]): Promise<any>;
}

let client: Client | null = null;

/**
 * Built on first use, not at import: a self-hosted install has no QStash token
 * and must still be able to import this module.
 */
function defaultPublisher(): QstashPublisher {
    if (!client) client = new Client({ token: process.env.VITE_QSTASH_TOKEN });
    return client;
}

/**
 * The QStash driver. Moved from `sendToQstash` in serverUtils.ts: the message
 * that reaches QStash is unchanged.
 */
export function createQstashDriver(getPublisher: () => QstashPublisher = defaultPublisher): JobQueue {
    return {
        async enqueue(message: any | any[], { isBatch = false, queueName = null }: EnqueueOptions = {}): Promise<EnqueueResult> {
            try {
                const qstash = getPublisher();
                const urlDestination = `${process.env.VITE_BACKEND_URL}qstash-webhook`;
                // const urlDestination = process.env.NODE_ENV === 'development'
                // ? 'https://willingly-improved-dassie.ngrok-free.app/qstash-webhook'
                // : `${process.env.VITE_BACKEND_URL}qstash-webhook`;

                // Determine flow control key from queueName (legacy) or message type
                const flowKey = queueName || message?.type || 'default';
                const flowControl = getFlowControlConfig(flowKey);
                console.log('[sendToQstash] flowControl:', JSON.stringify(flowControl));

                let msgToSend: any = {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.CUSTOM_API_KEY}`
                    },
                    url: urlDestination,
                    body: message,
                    flowControl: {
                        key: flowControl.key,
                        rate: flowControl.rate,
                        period: flowControl.period,
                        parallelism: flowControl.parallelism
                    }
                }

                // Apply priority delay if configured (delay > 0)
                if (flowControl.delay && flowControl.delay > 0) {
                    msgToSend.delay = flowControl.delay;
                }

                return isBatch
                    ? await qstash.batchJSON((message as any[]).map((msg: any) => ({
                        ...msgToSend,
                        body: msg
                    })))
                    : await qstash.publishJSON(msgToSend);
            } catch (error) {
                console.log('Error sending to qstash: ', { message, isBatch, queueName })
                throw error;
            }
        },
    };
}
