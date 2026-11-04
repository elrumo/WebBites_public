/**
 * The spellings of `raw` that the backend could have stored, for duplicate
 * lookups before a save.
 *
 * `saveBookmark.ts` strips backticks, trims, and prepends `https://` when there
 * is no protocol, so a row saved earlier matches one of these exactly — which
 * is what lets the check be a single `containedIn` query.
 *
 * ponytail: string variants, not URL canonicalisation — `?utm_source=` and
 * `m.` hosts still read as different bookmarks. Swap in a real canonicaliser if
 * those turn out to be the duplicates people actually hit.
 */
export function bookmarkUrlVariants(raw) {
  const cleaned = (raw || '').replace(/`/g, '').trim();
  if (!cleaned) return [];

  const withProtocol = /^(?:f|ht)tps?:\/\//.test(cleaned) ? cleaned : 'https://' + cleaned;
  const bare = withProtocol.replace(/^(?:f|ht)tps?:\/\//, '');
  const trimmedBare = bare.replace(/\/+$/, '');
  const stems = new Set([bare, trimmedBare, trimmedBare + '/']);

  return [...stems].flatMap(stem => ['https://' + stem, 'http://' + stem]);
}
