/**
 * Shared size guard for drawing snapshots.
 *
 * Externalising pasted images into the bucket is what keeps a drawing row small, but a
 * pathological board — thousands of freehand strokes, each a point array — can still
 * grow. Mongo refuses any document over 16MB, and it refuses it at write time with an
 * error the user would see as "my drawing stopped saving". We'd rather fail loudly and
 * early, well short of that ceiling, than let a board creep up to a hard write failure.
 */

export const MAX_DRAWING_BYTES = 8 * 1024 * 1024

export function drawingByteSize(snapshot: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(snapshot), 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}
