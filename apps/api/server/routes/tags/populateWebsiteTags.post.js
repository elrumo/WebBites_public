import Parse from 'parse/node.js';

defineRouteMeta({
  openAPI: {
    tags: ['Tags', 'Migration'],
    summary: 'Populate WebsiteTags junction table',
    description: 'Migrates existing website-tag relationships from websites.tags array to WebsiteTags junction table.',
    requestBody: {
      required: false,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              dryRun: {
                type: 'boolean',
                description: 'If true, only analyze without creating links',
                default: false
              },
              batchSize: {
                type: 'number',
                description: 'Number of websites to process per batch',
                default: 500
              },
              showLogs: {
                type: 'boolean',
                description: 'Show detailed logs',
                default: false
              }
            }
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                message: { type: 'string' },
                stats: { type: 'object' }
              }
            }
          }
        }
      }
    }
  }
});

export default defineEventHandler(async (event) => {
  const startTime = Date.now();

  try {
    const body = await readBody(event).catch(() => ({}));
    const { dryRun = false, batchSize = 500, showLogs = false } = body;

    // Initialize Parse
    if (!Parse.applicationId) {
      Parse.initialize(
        process.env.VITE_PARSE_ID,
        process.env.VITE_PARSE_JS_KEY,
        process.env.VITE_PARSE_MASTER_KEY
      );
      Parse.serverURL = process.env.VITE_PARSE_URL;
    }

    const log = (message) => {
      if (showLogs) {
        console.log(`[${new Date().toISOString()}] ${message}`);
      }
    };

    log('Starting WebsiteTags population...');

    // Build a map of normalized tag names to Tag objects for fast lookup
    log('Step 1: Loading all tags into memory...');
    const Tags = Parse.Object.extend('Tags');
    const tagMap = new Map(); // normalizedName -> Tag object

    let tagSkip = 0;
    let hasMoreTags = true;
    const tagBatchSize = 1000;

    while (hasMoreTags) {
      const tagQuery = new Parse.Query(Tags);
      tagQuery.select('nameNormalized');
      tagQuery.skip(tagSkip);
      tagQuery.limit(tagBatchSize);

      const tags = await tagQuery.find({ useMasterKey: true });
      hasMoreTags = tags.length === tagBatchSize;

      for (const tag of tags) {
        tagMap.set(tag.get('nameNormalized'), tag);
      }

      tagSkip += tagBatchSize;
      log(`Loaded ${tagMap.size} tags...`);
    }

    log(`Loaded ${tagMap.size} total tags into memory`);

    // Process websites and create WebsiteTag links
    log('Step 2: Processing websites...');

    const Website = Parse.Object.extend('websites');
    const WebsiteTags = Parse.Object.extend('WebsiteTags');

    let skip = 0;
    let hasMore = true;
    let totalWebsitesProcessed = 0;
    let totalLinksCreated = 0;
    let websitesWithTags = 0;
    let websitesWithoutUser = 0;
    let tagsNotFound = new Set();

    while (hasMore) {
      const websiteQuery = new Parse.Query(Website);
      websiteQuery.select('tags', 'user');
      websiteQuery.skip(skip);
      websiteQuery.limit(batchSize);
      websiteQuery.ascending('createdAt');

      const websites = await websiteQuery.find({ useMasterKey: true });
      hasMore = websites.length === batchSize;

      log(`[populateWebsiteTags] Processing batch: ${websites.length} websites (skip: ${skip})`);

      // Batch create links
      const linksToCreate = [];

      for (const website of websites) {
        totalWebsitesProcessed++;
        const tags = website.get('tags') || [];
        const user = website.get('user');

        if (!user) {
          websitesWithoutUser++;
          continue;
        }

        if (tags.length > 0) {
          websitesWithTags++;
        }

        for (const tagName of tags) {
          if (!tagName || typeof tagName !== 'string' || tagName.trim() === '') {
            continue;
          }

          const normalizedTagName = tagName.toLowerCase().trim();
          const tag = tagMap.get(normalizedTagName);

          if (!tag) {
            tagsNotFound.add(tagName);
            continue;
          }

          if (!dryRun) {
            const link = new WebsiteTags();
            link.set('website', website);
            link.set('tag', tag);
            link.set('user', user);
            link.set('addedAt', new Date());

            // Set ACL
            const acl = new Parse.ACL(user);
            link.setACL(acl);

            linksToCreate.push(link);
          }

          totalLinksCreated++;
        }
      }

      // Save links in batches
      if (!dryRun && linksToCreate.length > 0) {
        const saveBatchSize = 100;
        for (let i = 0; i < linksToCreate.length; i += saveBatchSize) {
          const batch = linksToCreate.slice(i, i + saveBatchSize);
          try {
            await Parse.Object.saveAll(batch, { useMasterKey: true });
          } catch (saveError) {
            console.error(`Error saving batch ${i}-${i + saveBatchSize}:`, saveError);
            // Continue with next batch
          }
        }
      }

      skip += batchSize;

      if (skip % (batchSize * 10) === 0 || !hasMore) {
        log(`Processed ${totalWebsitesProcessed} websites, created ${totalLinksCreated} links...`);
      }
    }

    const totalExecutionTime = Date.now() - startTime;
    log(`Population complete in ${totalExecutionTime}ms`);

    const stats = {
      totalWebsitesProcessed,
      websitesWithTags,
      websitesWithoutUser,
      totalLinksCreated,
      tagsLoaded: tagMap.size,
      tagsNotFoundCount: tagsNotFound.size,
      avgLinksPerWebsite: websitesWithTags > 0 ? Math.round((totalLinksCreated / websitesWithTags) * 100) / 100 : 0
    };

    if (dryRun) {
      return {
        success: true,
        message: 'DRY RUN: Analysis complete. No links were created.',
        dryRun: true,
        stats,
        tagsNotFoundSample: Array.from(tagsNotFound).slice(0, 20),
        performance: {
          totalExecutionTimeMs: totalExecutionTime
        }
      };
    }

    return {
      success: true,
      message: `Successfully created ${totalLinksCreated} WebsiteTag links`,
      stats,
      warnings: tagsNotFound.size > 0 ? {
        tagsNotFound: `${tagsNotFound.size} tags were not found in Tags table`,
        sample: Array.from(tagsNotFound).slice(0, 10)
      } : null,
      performance: {
        totalExecutionTimeMs: totalExecutionTime,
        linksPerSecond: totalLinksCreated > 0 ? Math.round((totalLinksCreated / (totalExecutionTime / 1000)) * 100) / 100 : 0
      },
      nextSteps: [
        '1. Verify data in Parse Dashboard',
        '2. Add compound indexes on WebsiteTags (user+tag, website+tag, user+website)',
        '3. Test read queries with new system',
        '4. Switch frontend to use new tag system',
        '5. Remove old tags array from websites after verification'
      ]
    };

  } catch (error) {
    const totalExecutionTime = Date.now() - startTime;
    console.error('Error in WebsiteTags population:', error);

    return {
      success: false,
      error: error.message || String(error),
      code: error.code,
      stack: error.stack,
      performance: {
        totalExecutionTimeMs: totalExecutionTime
      }
    };
  }
});
