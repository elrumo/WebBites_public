import Parse from 'parse/node.js';

defineRouteMeta({
  openAPI: {
    tags: ['Tags', 'Migration'],
    summary: 'Migrate existing tags to new Tags class',
    description: 'Migrates all existing tags from websites.tags array to the new Tags class. This creates normalized tag entries for all unique tags found across all websites.',
    requestBody: {
      required: false,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              dryRun: {
                type: 'boolean',
                description: 'If true, only analyze tags without creating them',
                default: false
              },
              batchSize: {
                type: 'number',
                description: 'Number of websites to process per batch',
                default: 1000
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
                stats: { type: 'object' },
                tags: { type: 'array' }
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
    const { dryRun = false, batchSize = 1000, showLogs = false } = body;

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

    log('Starting tag migration process...');

    // Step 1: Extract all unique tags from websites
    log('Step 1: Extracting unique tags from all websites...');

    const Website = Parse.Object.extend('websites');
    const tagMap = new Map(); // Map<normalizedTagName, { displayName, count, userSet }>

    let skip = 0;
    let hasMore = true;
    let totalWebsitesProcessed = 0;
    let websitesWithTags = 0;

    while (hasMore) {
      const websiteQuery = new Parse.Query(Website);
      websiteQuery.select('tags');
      websiteQuery.skip(skip);
      websiteQuery.limit(batchSize);
      websiteQuery.ascending('createdAt');

      const websites = await websiteQuery.find({ useMasterKey: true });
      hasMore = websites.length === batchSize;

      log(`[migrateTagsToNewSchema] Processing batch: ${websites.length} websites (skip: ${skip})`);

      for (const website of websites) {
        totalWebsitesProcessed++;
        const tags = website.get('tags') || [];

        if (tags.length > 0) {
          websitesWithTags++;
        }

        for (const tag of tags) {
          if (!tag || typeof tag !== 'string' || tag.trim() === '') continue;

          const normalizedTag = tag.toLowerCase().trim();

          if (!tagMap.has(normalizedTag)) {
            tagMap.set(normalizedTag, {
              displayName: tag.trim(), // Use first occurrence as display name
              count: 0,
              userSet: new Set()
            });
          }

          const tagData = tagMap.get(normalizedTag);
          tagData.count++;

          // Track unique users for this tag (if we want to set createdBy later)
          const userId = website.get('user')?.id;
          if (userId) {
            tagData.userSet.add(userId);
          }
        }
      }

      skip += batchSize;

      if (skip % (batchSize * 5) === 0 || !hasMore) {
        log(`Processed ${totalWebsitesProcessed} websites, found ${tagMap.size} unique tags...`);
      }
    }

    log(`Extraction complete: ${totalWebsitesProcessed} websites, ${tagMap.size} unique tags`);

    // Step 2: Create Tag objects in new Tags class
    const tagsToCreate = [];
    const tagStats = {
      totalUniqueTags: tagMap.size,
      totalWebsitesProcessed,
      websitesWithTags,
      tagsByFrequency: []
    };

    for (const [normalizedName, data] of tagMap.entries()) {
      tagStats.tagsByFrequency.push({
        name: data.displayName,
        normalized: normalizedName,
        occurrences: data.count,
        uniqueUsers: data.userSet.size
      });

      if (!dryRun) {
        const Tags = Parse.Object.extend('Tags');
        const tag = new Tags();

        tag.set('name', data.displayName);
        tag.set('nameNormalized', normalizedName);
        tag.set('isGlobal', true); // Mark as global since these are migrated tags

        // Optionally set createdBy to the first user who used this tag
        // const firstUserId = Array.from(data.userSet)[0];
        // if (firstUserId) {
        //   tag.set('createdBy', { __type: 'Pointer', className: '_User', objectId: firstUserId });
        // }

        tagsToCreate.push(tag);
      }
    }

    // Sort by frequency (most used first)
    tagStats.tagsByFrequency.sort((a, b) => b.occurrences - a.occurrences);

    if (dryRun) {
      log('DRY RUN - No tags were created');

      return {
        success: true,
        message: 'DRY RUN: Analysis complete. No tags were created.',
        dryRun: true,
        stats: tagStats,
        topTags: tagStats.tagsByFrequency.slice(0, 20),
        performance: {
          totalExecutionTimeMs: Date.now() - startTime
        }
      };
    }

    // Step 3: Batch save tags to Parse
    log(`Creating ${tagsToCreate.length} tag objects...`);

    const saveBatchSize = 100;
    let savedCount = 0;
    const createdTags = [];

    for (let i = 0; i < tagsToCreate.length; i += saveBatchSize) {
      const batch = tagsToCreate.slice(i, i + saveBatchSize);

      try {
        const saved = await Parse.Object.saveAll(batch, { useMasterKey: true });
        savedCount += saved.length;
        createdTags.push(...saved);

        if (tagsToCreate.length > saveBatchSize) {
          const percentage = Math.floor((savedCount / tagsToCreate.length) * 100);
          log(`Saved ${savedCount}/${tagsToCreate.length} tags (${percentage}%)`);
        }
      } catch (saveError) {
        console.error(`Error saving batch ${i}-${i + saveBatchSize}:`, saveError);

        // Try to continue with next batch
        if (saveError.message?.includes('duplicate') || saveError.code === 137) {
          log(`Skipping duplicate tags in batch ${i}-${i + saveBatchSize}`);
          continue;
        }

        throw saveError;
      }
    }

    const totalExecutionTime = Date.now() - startTime;
    log(`Migration complete: ${savedCount} tags created in ${totalExecutionTime}ms`);

    return {
      success: true,
      message: `Successfully migrated ${savedCount} unique tags to new Tags class`,
      stats: {
        ...tagStats,
        tagsCreated: savedCount,
        avgTimePerTag: savedCount > 0 ? Math.round(totalExecutionTime / savedCount * 100) / 100 : 0
      },
      topTags: tagStats.tagsByFrequency.slice(0, 20),
      performance: {
        totalExecutionTimeMs: totalExecutionTime,
        tagsPerSecond: savedCount > 0 ? Math.round((savedCount / (totalExecutionTime / 1000)) * 100) / 100 : 0
      },
      nextSteps: [
        '1. Verify tags in Parse Dashboard',
        '2. Add unique index on nameNormalized field',
        '3. Create WebsiteTags junction table',
        '4. Run migration to populate WebsiteTags',
        '5. Update triggers to maintain both systems'
      ]
    };

  } catch (error) {
    const totalExecutionTime = Date.now() - startTime;
    console.error('Error in tag migration:', error);

    return {
      success: false,
      error: error.message || String(error),
      code: error.code,
      stack: error.stack,
      performance: {
        totalExecutionTimeMs: totalExecutionTime,
        failedAt: error.stack ? error.stack.split('\n')[0] : 'Unknown location'
      }
    };
  }
});
