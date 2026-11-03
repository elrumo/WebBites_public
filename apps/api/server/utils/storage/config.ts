/**
 * Which file store this installation uses, and how to reach it.
 *
 *   FILES_DRIVER=gridfs (default)   Parse keeps uploaded files in MongoDB.
 *   FILES_DRIVER=s3                 Any S3-compatible store. Needs:
 *     S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY
 *     S3_ENDPOINT_URL   e.g. http://rustfs:9000 or https://s3.eu-west-1.amazonaws.com
 *                       (or S3_ENDPOINT host + S3_PORT + S3_USE_SSL, the older form)
 *     S3_REGION         default us-east-1
 *     S3_PUBLIC_URL     where browsers fetch files, e.g. https://example.com/s3
 *
 * Parse reads the same variables (apps/parse/src/files.js), so one set of values configures both.
 * With no FILES_DRIVER, setting S3_BUCKET selects s3.
 */

export type FilesDriver = 'gridfs' | 's3';

const env = (name: string) => (process.env[name] ?? '').trim();

export function filesDriver(): FilesDriver {
    const explicit = env('FILES_DRIVER').toLowerCase();
    if (explicit === 'gridfs' || explicit === 's3') return explicit;
    return env('S3_BUCKET') ? 's3' : 'gridfs';
}

export interface S3Settings {
    endPoint: string;
    port?: number;
    useSSL: boolean;
    region: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
    /** Where browsers fetch objects from, without a trailing slash. */
    publicUrl: string;
}

/** Connection settings for the s3 driver, or null when it is not selected or not fully configured. */
export function s3Settings(): S3Settings | null {
    if (filesDriver() !== 's3') return null;
    const bucket = env('S3_BUCKET');
    if (!bucket) return null;

    let endPoint = '';
    let port: number | undefined;
    let useSSL = !['0', 'false', 'no', 'off'].includes(env('S3_USE_SSL').toLowerCase());

    const endpointUrl = env('S3_ENDPOINT_URL');
    if (endpointUrl) {
        try {
            const url = new URL(endpointUrl);
            endPoint = url.hostname;
            port = url.port ? Number(url.port) : undefined;
            useSSL = url.protocol === 'https:';
        } catch {
            return null;
        }
    } else {
        // Older form: a bare host, optionally host:port.
        const [host, hostPort] = env('S3_ENDPOINT').replace(/^https?:\/\//, '').split(':');
        endPoint = host;
        port = Number(hostPort || env('S3_PORT')) || undefined;
    }
    if (!endPoint) return null;

    return {
        endPoint,
        port,
        useSSL,
        region: env('S3_REGION') || 'us-east-1',
        accessKey: env('S3_ACCESS_KEY'),
        secretKey: env('S3_SECRET_KEY'),
        bucket,
        publicUrl: env('S3_PUBLIC_URL').replace(/\/+$/, ''),
    };
}
