/**
 * The filter `/v1/search` hands to Meilisearch: the caller's own clauses,
 * inside the scope the server decides.
 *
 * Kept out of the route so the rules can be tested without a Nitro runtime,
 * and because `buildFilter` is a security boundary: it is the only thing
 * standing between one user's search and everyone else's bookmarks.
 * `sanitizeMeilisearchFilters` is the route's own, moved here unchanged.
 */

import {
  NOT_DELETED_FILTER, DELETED_ONLY_FILTER,
  NOT_HIDDEN_FILTER, HIDDEN_ONLY_FILTER,
} from './meilisearchTrash';
import type { SearchScope } from './meilisearchTrash';

/**
 * The mandatory part of every filter: this user's bookmarks, and — unless the
 * caller is the deleted section or the Private section — only the ones that are
 * neither in the trash nor hidden.
 *
 * Deleted and hidden bookmarks both keep their document in the index (see
 * `meilisearchTrash.ts`), so this is what keeps them out of the grid, out of
 * search, and out of every type, tag and colour listing built on search.
 */
export function mandatoryFilters(userId: string, scope: SearchScope): string[] {
  const expressions = [`user.objectId = "${userId}"`];
  if (!scope.flagsFilterable) return expressions;

  if (scope.deletedOnly) {
    // No hidden clause here on purpose: deleting a hidden bookmark must still
    // leave it somewhere it can be restored from. See `dropOutOfScopeHits`,
    // which mirrors this.
    expressions.push(DELETED_ONLY_FILTER);
    return expressions;
  }

  expressions.push(NOT_DELETED_FILTER);
  expressions.push(scope.hiddenOnly ? HIDDEN_ONLY_FILTER : NOT_HIDDEN_FILTER);
  return expressions;
}

/**
 * The mandatory scope ANDed with the caller's filter, as separate elements of
 * Meilisearch's array syntax — never spliced into one string.
 *
 * Meilisearch parses each element of the array on its own and ANDs the
 * results, so nothing in the caller's filter can reach the scope: a malformed
 * one is rejected, it can't widen anything. Splicing it into
 * `scope AND (${filters})` could. An unbalanced `)` closed the group early, and
 * since AND binds tighter than OR, `type = website) OR (type = website` read as
 * `(scope AND type = website) OR (type = website)` — every user's websites.
 */
export function buildFilter(userId: string, filters: string | string[] | null | undefined, scope: SearchScope): string[] {
  const mandatory = mandatoryFilters(userId, scope);
  if (Array.isArray(filters)) return [...mandatory, ...filters.filter((f) => f.trim() !== '')];
  if (typeof filters === 'string' && filters.trim() !== '') return [...mandatory, filters];
  return mandatory;
}

/**
 * Normalises whatever a client sent as `filters` into Meilisearch syntax.
 *
 * Accepts:
 * - Algolia-style string filters: "tags:programming AND siteAuthor:'John Doe'"
 * - Meilisearch-style string filters: "tags = 'programming' AND siteAuthor = 'John Doe'"
 * - Object filters: { tags: ['programming','web'], siteAuthor: 'John Doe' }
 * - Array of string filters: ["tags:programming", "siteAuthor:'John Doe'"]
 */
export function sanitizeMeilisearchFilters(filters: any): string | string[] | null {
  if (!filters) return null;

  // Helper to detect numeric values
  const isNumeric = (val: string) => /^-?\d+(?:\.\d+)?$/.test(val);
  const needsQuoting = (val: string) => !isNumeric(val) && !(val.startsWith('"') || val.startsWith("'")) && val.toLowerCase() !== 'true' && val.toLowerCase() !== 'false';

  const convertColonExprToMeili = (expr: string) => {
    // Convert key:value to key = "value" when suitable
    // Preserve existing Meili comparators or quoted values
    return expr.replace(/([a-zA-Z0-9_.]+)\s*:\s*("[^"]*"|'[^']*'|[^\s()]+)/g, (_m, key: string, rawVal: string) => {
      let val = rawVal.trim();
      if (needsQuoting(val)) {
        val = `"${val}"`;
      }
      return `${key} = ${val}`;
    });
  };

  // String filters
  if (typeof filters === 'string') {
    const trimmed = filters.trim();
    // If it already looks like Meili syntax (contains '=' or comparison operators), return as-is
    if (/([=<>])/.test(trimmed)) {
      return trimmed;
    }
    // Otherwise, treat as Algolia-style and convert ':' to Meili '=' with quoting
    return convertColonExprToMeili(trimmed);
  }

  // Array of string filters
  if (Array.isArray(filters)) {
    const out: string[] = [];
    for (const item of filters) {
      if (typeof item === 'string') {
        const converted = /[=<>]/.test(item) ? item : convertColonExprToMeili(item);
        out.push(converted);
      }
    }
    return out.length ? out : null;
  }

  // Object filters -> array of OR/AND expressions
  if (typeof filters === 'object') {
    const out: string[] = [];
    for (const [key, value] of Object.entries(filters)) {
      if (Array.isArray(value)) {
        const parts = value
          .map(v => {
            const sv = String(v).trim();
            const quoted = needsQuoting(sv) ? `"${sv}"` : sv;
            return `${key} = ${quoted}`;
          })
          .join(' OR ');
        out.push(`(${parts})`);
      } else if (value != null) {
        const sv = String(value).trim();
        const quoted = needsQuoting(sv) ? `"${sv}"` : sv;
        out.push(`${key} = ${quoted}`);
      }
    }
    return out.length ? out : null;
  }

  return null;
}
