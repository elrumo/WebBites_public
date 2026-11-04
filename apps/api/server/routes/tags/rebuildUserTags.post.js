import { useParse } from '../../utils/serverUtils.js';

defineRouteMeta({
  openAPI: {
    tags: ['Tags'],
    summary: 'Rebuild user tags',
    description: 'Rebuilds all tag occurrences for a user from scratch. Useful for fixing data inconsistencies or initial migration.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['userId'],
            properties: {
              userId: {
                type: 'string',
                description: 'Parse User objectId'
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
                totalWebsites: {
                  type: 'number',
                  description: 'Total number of websites processed'
                },
                totalTags: {
                  type: 'number',
                  description: 'Total number of unique tags found'
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'List of all tag names'
                }
              }
            }
          }
        }
      },
      400: {
        description: 'Bad request - missing userId',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                error: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const startTime = Date.now();
  
  try {
    const body = await readBody(event);
    const { userId, showLogs = false } = body;

    // Utility function for conditional logging
    const log = (message) => {
      if (showLogs) {
        console.log(`[${new Date().toISOString()}] ${message}`);
      }
    };

    if (!userId) {
      return {
        success: false,
        error: 'User ID is required'
      };
    }

    log(`Starting tag rebuild for user ${userId}`);

    const Parse = useParse();
    const TagOccurrence = Parse.Object.extend('TagOccurrences');
    const Website = Parse.Object.extend('websites');

    // Delete all existing TagOccurrences for this user in batches
    log('Deleting existing TagOccurrences...');
    let deletedCount = 0;
    
    try {
      const deleteQuery = new Parse.Query(TagOccurrence);
      deleteQuery.equalTo('user', {
        __type: 'Pointer',
        className: '_User',
        objectId: userId
      });
      deleteQuery.limit(1000); // Delete in batches to avoid timeout

      let toDelete;
      do {
        toDelete = await deleteQuery.find({ useMasterKey: true });
        if (toDelete.length > 0) {
          await Parse.Object.destroyAll(toDelete, { useMasterKey: true });
          deletedCount += toDelete.length;
          log(`Deleted ${deletedCount} TagOccurrences so far...`);
        }
      } while (toDelete.length > 0);

      log(`Deleted ${deletedCount} existing TagOccurrences for user ${userId}`);
    } catch (deleteError) {
      log(`Warning: Error during deletion (continuing): ${deleteError.message}`);
      // Continue execution even if deletion fails partially
    }

    // Process websites in batches to avoid memory issues
    log(`Starting batch processing of websites for user ${userId}...`);
    const batchSize = 1000;
    let skip = 0;
    let hasMore = true;
    let totalWebsitesProcessed = 0;

    // Use Maps for better performance with large datasets
    const tagCounts = new Map();
    const tagWebsites = new Map();

    while (hasMore) {
      const websiteQuery = new Parse.Query(Website);
      websiteQuery.equalTo('user', {
        __type: 'Pointer',
        className: '_User',
        objectId: userId
      });
      websiteQuery.select('tags');
      websiteQuery.skip(skip);
      websiteQuery.limit(batchSize);
      websiteQuery.ascending('createdAt'); // Consistent ordering

      const websiteBatch = await websiteQuery.find({ useMasterKey: true });
      hasMore = websiteBatch.length === batchSize;
      
      log(`Processing batch: ${websiteBatch.length} websites (skip: ${skip})`);
      
      // Process this batch
      for (const website of websiteBatch) {
        totalWebsitesProcessed++;
        const tags = website.get('tags') || [];
        
        for (const tag of tags) {
          // Update tag counts
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
          
          // Track websites for this tag
          if (!tagWebsites.has(tag)) {
            tagWebsites.set(tag, []);
          }
          tagWebsites.get(tag).push(website.id);
        }
      }
      
      skip += batchSize;
      
      // Log progress every few batches
      if (skip % (batchSize * 5) === 0 || !hasMore) {
        log(`Processed ${totalWebsitesProcessed} websites so far...`);
      }
    }
    
    log(`Tag aggregation complete. Processed ${totalWebsitesProcessed} websites and found ${tagCounts.size} unique tags.`);

    // Create new TagOccurrences with relations in single operation
    log('Creating TagOccurrence objects with relations...');
    const newTagOccurrences = [];
    const totalTags = tagCounts.size;
    let processedTags = 0;
    const tagLogInterval = Math.max(1, Math.floor(totalTags / 10)); // Log every 10% or at least once
    
    const startCreateTime = Date.now();
    
    for (const [tagName, count] of tagCounts.entries()) {
      processedTags++;
      if (processedTags % tagLogInterval === 0 || processedTags === totalTags) {
        const percentage = Math.floor((processedTags / totalTags) * 100);
        log(`Creating TagOccurrences: ${processedTags}/${totalTags} (${percentage}%)`);
      }
      
      const tagOccurrence = new TagOccurrence();
      tagOccurrence.set('user', {
        __type: 'Pointer',
        className: '_User',
        objectId: userId
      });
      tagOccurrence.set('tagName', tagName);
      tagOccurrence.set('count', count);

      // Set ACL
      const acl = new Parse.ACL();
      acl.setReadAccess(userId, true);
      acl.setWriteAccess(userId, true);
      tagOccurrence.setACL(acl);

      // Add website relations immediately (before save)
      const websiteIds = tagWebsites.get(tagName);
      if (websiteIds && websiteIds.length > 0) {
        const websiteRelation = tagOccurrence.relation('websites');
        for (const websiteId of websiteIds) {
          websiteRelation.add(Website.createWithoutData(websiteId));
        }
      }

      newTagOccurrences.push(tagOccurrence);
    }

    const createTimeMs = Date.now() - startCreateTime;
    log(`Created ${newTagOccurrences.length} TagOccurrence objects with relations in ${createTimeMs}ms`);

    // Single save operation with all data and relations
    log(`Saving ${newTagOccurrences.length} TagOccurrence objects with relations to database...`);
    const startSaveTime = Date.now();
    
    // Process saves in smaller batches to avoid timeout on large datasets
    const saveBatchSize = 100;
    let savedCount = 0;
    
    for (let i = 0; i < newTagOccurrences.length; i += saveBatchSize) {
      const batch = newTagOccurrences.slice(i, i + saveBatchSize);
      await Parse.Object.saveAll(batch, { useMasterKey: true });
      savedCount += batch.length;
      
      if (newTagOccurrences.length > saveBatchSize) {
        const percentage = Math.floor((savedCount / newTagOccurrences.length) * 100);
        log(`Saved ${savedCount}/${newTagOccurrences.length} TagOccurrences (${percentage}%)`);
      }
    }
    
    const saveTimeMs = Date.now() - startSaveTime;
    log(`Saved ${newTagOccurrences.length} TagOccurrences with relations in ${saveTimeMs}ms`);

    log(`Created ${newTagOccurrences.length} TagOccurrences for user ${userId}`);
    const tagProcessingTime = Date.now() - startCreateTime;
    log(`Total TagOccurrence processing time: ${tagProcessingTime}ms`);

    const totalExecutionTime = Date.now() - startTime;
    log(`Total execution time: ${totalExecutionTime}ms`);
    log(`Tag rebuild completed successfully for user ${userId}`);

    return {
      success: true,
      message: 'Tag occurrences rebuilt successfully',
      totalWebsites: totalWebsitesProcessed,
      totalTags: newTagOccurrences.length,
      tags: Array.from(tagCounts.keys()),
      performance: {
        deletedTagOccurrences: deletedCount,
        tagProcessingTimeMs: tagProcessingTime,
        totalExecutionTimeMs: totalExecutionTime,
        averageTimePerWebsite: totalWebsitesProcessed > 0 ? Math.round(totalExecutionTime / totalWebsitesProcessed * 100) / 100 : 0
      }
    };
  } catch (error) {
    const totalExecutionTime = Date.now() - startTime;
    console.error('Error rebuilding user tags:', error);
    
    return {
      success: false,
      error: error.message,
      performance: {
        totalExecutionTimeMs: totalExecutionTime,
        failedAt: error.stack ? error.stack.split('\n')[0] : 'Unknown location'
      }
    };
  }
});