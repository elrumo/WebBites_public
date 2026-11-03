import Parse from 'parse/node';
import { ensureParseInitialized } from '../utils/parseRuntime'
import { verifySession } from '../utils/sessionCache'

/**
 * The image side of a drawing.
 *
 * Two directions, because a drawing's images have to cross the origin boundary twice:
 *
 *   { data, name, type }  ->  { url }      dehydration: park a pasted image in the
 *                                          bucket so the snapshot column stays small
 *   { fetchUrl }          ->  { dataUrl }  hydration fallback: pull a parked image back
 *                                          inline so the board's canvas stays untainted
 *
 * The fetch direction only exists because the browser may not be allowed to read the
 * bucket directly (it needs Access-Control-Allow-Origin on files.webbites.io). It is
 * therefore a URL fetcher driven by client input, which is an SSRF shape — so it is
 * locked to the file hosts we actually serve, and refuses everything else. The native
 * app never touches this branch; it fetches over URLSession, where CORS does not apply.
 */

const MAX_ASSET_BYTES = 12 * 1024 * 1024 // generous for a photo, far below the row budget

/** Hosts a drawing asset is allowed to live on. */
function allowedAssetHosts() {
    const config = useRuntimeConfig()
    const hosts = new Set()

    // The public addresses, the in-network ones, and wherever object storage is served from.
    for (const candidate of [config.public.parseServerUrl, config.public.backendUrl, config.parseInternalUrl,
        config.backendInternalUrl, process.env.S3_PUBLIC_URL]) {
        try {
            if (candidate) hosts.add(new URL(candidate).host)
        } catch { /* not a URL, skip */ }
    }

    return hosts
}

export default defineEventHandler(async (event) => {
    ensureParseInitialized()

    const sessionUser = await verifySession(getCookie(event, 'parse.session'))
    if (!sessionUser) {
        throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
    }

    const body = await readBody(event)

    // ─── hydration: bucket URL -> data URL ──────────────────────────────
    if (body.fetchUrl) {
        let target
        try {
            target = new URL(body.fetchUrl)
        } catch {
            throw createError({ statusCode: 400, statusMessage: 'Invalid asset URL' })
        }

        if (target.protocol !== 'https:' || !allowedAssetHosts().has(target.host)) {
            throw createError({ statusCode: 403, statusMessage: 'Asset host not allowed' })
        }

        const res = await fetch(target.toString())
        if (!res.ok) {
            throw createError({ statusCode: 502, statusMessage: `Asset fetch failed: ${res.status}` })
        }

        const buffer = Buffer.from(await res.arrayBuffer())
        if (buffer.byteLength > MAX_ASSET_BYTES) {
            throw createError({ statusCode: 413, statusMessage: 'Asset too large' })
        }

        const mime = res.headers.get('content-type') || 'image/png'
        return { dataUrl: `data:${mime};base64,${buffer.toString('base64')}` }
    }

    // ─── dehydration: data URL -> bucket URL ────────────────────────────
    try {
        const { data, name, type } = body
        if (!data) throw createError({ statusCode: 400, statusMessage: 'No asset data provided' })

        // Rough byte count of the base64 payload before we hand it to Parse.
        const base64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data
        if (base64.length * 0.75 > MAX_ASSET_BYTES) {
            throw createError({ statusCode: 413, statusMessage: 'Asset too large' })
        }

        // Parse.File strips the `data:<mime>;base64,` prefix itself.
        const file = new Parse.File(name || 'drawing-asset.png', { base64: data }, type || 'image/png')
        await file.save(null, { useMasterKey: true })

        return { url: file.url() }
    } catch (error) {
        if (error.statusCode) throw error
        console.log('error saving drawing asset: ', error);
        throw createError({ statusCode: 500, statusMessage: 'Error saving drawing asset' })
    }
})
