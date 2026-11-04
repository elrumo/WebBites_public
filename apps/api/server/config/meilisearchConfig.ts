/**
 * Shared Meilisearch configuration
 * Used across migration scripts and search index operations
 */

export const MEILISEARCH_CONFIG = {
  INDEX_NAME: 'webbites',
  BATCH_SIZE: 100,

  searchableAttributes: [
    "siteTitle",
    "textNote",
    "siteDescription",
    "tags",
    "colorCategories",
    "siteBody",
    "sitePublisher",
    "aiSummary.tldr",
    "aiSummary.pointsThatBestDescribeThePage.title",
    "aiSummary.pointsThatBestDescribeThePage.oneLineDescription",
    "type",
    "metaData.publisher",
    "metaData.author",
    "siteAuthor",
    "mediaTypeObject",
    "colorNames",
    "colorDescription",
    "url",
  ] as string[],

  filterableAttributes: [
    'subType',
    // The trash lives in the index rather than out of it: a deleted bookmark
    // keeps its document (marked) so it can be restored and so the deleted
    // section can search it, and every other search filters it out.
    'isDeleted',
    'deletedAt',
    // "Hidden" is the trash's quieter sibling: the bookmark is kept, and kept
    // out of the library, but it is not on its way to being purged. Same
    // mechanics as isDeleted — the document stays indexed so the Private
    // section can search it, and every other search filters it out.
    'hiddenFrom',
    'tags',
    'type',
    'user.objectId',
    'userId',
    'objectId',
    'favorited',
    'pinned',
    'createdAt',
    'updatedAt',
    'baseUrl',
    'siteAuthor',
    'sitePublisher',
    'siteDate',
    'colorDescription',
    'colorCategories',
    'colorNames'
  ] as string[],

  sortableAttributes: [
    'createdAt',
    'updatedAt',
    'title',
    'siteDate'
  ] as string[],

  // The per-user tag list is a facet distribution over `tags`, so the cap has
  // to be higher than any one user's tag count (the default is 100).
  faceting: {
    maxValuesPerFacet: 10000,
    sortFacetValuesBy: { tags: 'count' } as Record<string, 'count' | 'alpha'>
  },

  embedderConfig: {
    source: 'openAi' as const,
    model: 'text-embedding-3-small',
    documentTemplate: `{% for field in fields %}{% if field.is_searchable and field.value != nil %}{% case field.name %}{% when "siteTitle", "title" %}{{ field.value }} {% when "siteDescription" %}{{ field.value }} {% when "siteBody" %}{{ field.value }} {% when "tags" %}{{ field.value | join: " " }} {% when "type" %}{{ field.value }} {% when "subType" %}{{ field.value | join: " " }} {% when "colorDescription" %}{{ field.value }}{% endcase %} {% endif %}{% endfor %}`,
    documentTemplateMaxBytes: 4000
  }
};
