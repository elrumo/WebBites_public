/**
 * What the Meilisearch sync has to do to one index for one user. Pure, so it
 * can be tested without Parse or Meilisearch; the IO is in
 * `server/services/meilisearchSync.ts`.
 *
 * The embeddings are the one thing Meilisearch holds that Parse does not: the
 * `openai` embedder renders each document through its template and asks
 * OpenAI. The sync keeps a copy in Parse (`SearchEmbedding`, one row per
 * bookmark) and hands it back when a document has to be written to an index
 * that doesn't already hold that embedding, so the index takes it instead of
 * asking OpenAI again. Measured on Meilisearch 1.22:
 *
 * - `_vectors.openai = { embeddings, regenerate: true }` is used as given, and
 *   the document still re-embeds on its own the next time its text changes.
 * - `regenerate: false` would freeze it: later text changes never re-embed.
 * - A provided embedding is trusted even when the text has changed since it
 *   was made. That is why every backup carries the hash of the text it was
 *   made from, and is only handed back while Parse still has that text.
 * - Writing a document whose template text is unchanged does not re-embed, so
 *   rewriting a document that drifted in some other field costs nothing.
 */

import { createHash } from 'node:crypto'

export const EMBEDDER = 'openai'

// The fields `MEILISEARCH_CONFIG.embedderConfig.documentTemplate` reads. A
// field here that the template doesn't use only means an occasional backup
// that isn't reused; a field the template uses that is missing here would hand
// back embeddings of text that has changed, so add to this when the template
// grows.
const TEMPLATE_FIELDS = ['siteTitle', 'title', 'siteDescription', 'siteBody', 'tags', 'type', 'subType', 'colorDescription']

export type SearchDocument = { id: string; [field: string]: any }
export type Backup = { textHash: string; vector: string }

/**
 * Everything besides the document that decides what the embedder is sent. Two
 * indexes whose embedders differ in any of it never share backups.
 */
export function embedderKey(embedder: Record<string, any>, searchableAttributes: unknown): string {
  const { source, model, dimensions, documentTemplate, documentTemplateMaxBytes } = embedder
  return JSON.stringify([source, model, dimensions, documentTemplate, documentTemplateMaxBytes, searchableAttributes])
}

export function textHash(doc: SearchDocument, key: string): string {
  return createHash('sha256')
    .update(JSON.stringify([key, ...TEMPLATE_FIELDS.map((field) => doc[field] ?? null)]))
    .digest('base64url')
}

// Meilisearch keeps embeddings as f32, so a Float32Array holds them exactly:
// 8 KB of base64 for text-embedding-3-small instead of ~30 KB of JSON numbers.
export function encodeVector(vector: number[]): string {
  return Buffer.from(new Float32Array(vector).buffer).toString('base64')
}

export function decodeVector(encoded: string): number[] {
  // Copied into a fresh buffer: a Buffer can sit at an offset that isn't a
  // multiple of 4, which Float32Array refuses.
  return Array.from(new Float32Array(Uint8Array.from(Buffer.from(encoded, 'base64')).buffer))
}

const canonical = (value: any): any =>
  Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]))
    : value

const same = (a: SearchDocument, b?: SearchDocument) => !!b && JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

export interface TargetPlan {
  /** Text hash of every Parse document, by id. */
  hashes: Map<string, string>
  /** Missing from the index or different there. `vector` is a backup to hand back. */
  write: Array<{ doc: SearchDocument; vector?: string }>
  /** In the index for this user but no longer in Parse. */
  remove: string[]
  /** Ids whose embedding in this index matches Parse's text and isn't backed up yet. */
  backUp: string[]
}

/**
 * @param parseDocs  the user's documents as `buildMeilisearchDocument` makes them, JSON round-tripped
 * @param indexDocs  what the index holds for the user, by id
 * @param backups    the user's `SearchEmbedding` rows, by website id
 */
export function planTarget(
  parseDocs: SearchDocument[],
  indexDocs: Map<string, SearchDocument>,
  backups: Map<string, Backup>,
  key: string
): TargetPlan {
  const hashes = new Map(parseDocs.map((doc) => [doc.id, textHash(doc, key)]))
  const indexHash = (id: string) => {
    const doc = indexDocs.get(id)
    return doc && textHash(doc, key)
  }

  const backUp = [...indexDocs.keys()].filter((id) =>
    hashes.has(id) && indexHash(id) === hashes.get(id) && backups.get(id)?.textHash !== hashes.get(id))

  const write = parseDocs
    .filter((doc) => !same(doc, indexDocs.get(doc.id)))
    .map((doc) => {
      const hash = hashes.get(doc.id)
      const backup = backups.get(doc.id)
      // An index that already embedded this text keeps its embedding on a rewrite.
      return indexHash(doc.id) !== hash && backup?.textHash === hash ? { doc, vector: backup.vector } : { doc }
    })

  const remove = [...indexDocs.keys()].filter((id) => !hashes.has(id))

  return { hashes, write, remove, backUp }
}

export function toIndexDocument({ doc, vector }: TargetPlan['write'][number]): SearchDocument {
  return vector
    ? { ...doc, _vectors: { [EMBEDDER]: { embeddings: [decodeVector(vector)], regenerate: true } } }
    : doc
}
