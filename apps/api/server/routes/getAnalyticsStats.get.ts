import Parse from 'parse/node.js'
import { defineEventHandler, getQuery } from 'h3';

// Initialize Parse
Parse.initialize(
  process.env.VITE_PARSE_ID,
  process.env.VITE_PARSE_JS_KEY,
  process.env.VITE_PARSE_MASTER_KEY
)
Parse.serverURL = process.env.VITE_PARSE_URL

// Define OpenAPI documentation
defineRouteMeta({
  openAPI: {
    tags: ["Analytics"],
    description: "Get analytics dashboard statistics and aggregated data",
    parameters: [
      {
        name: "days",
        in: "query",
        description: "Number of days to look back for statistics",
        schema: { type: "integer", default: 30 }
      }
    ],
    responses: {
      "200": {
        description: "Analytics dashboard statistics",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean" },
                stats: { type: "object" },
                recentBatches: { type: "array" },
                trends: { type: "object" }
              }
            }
          }
        }
      }
    }
  }
});

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event);
    const daysBack = Math.min(Number(query.days) || 30, 365); // Max 1 year
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    console.log(`📈 Generating analytics dashboard stats for last ${daysBack} days`);

    // Get batch summaries for the period
    const batchQuery = new Parse.Query('AnalyticsBatchSummary');
    batchQuery.greaterThanOrEqualTo('reportDate', startDate);
    batchQuery.descending('reportDate');
    batchQuery.limit(1000); // Should be enough for most use cases
    
    const batches = await batchQuery.find({ useMasterKey: true });

    // Get user results count for the period
    const userResultsQuery = new Parse.Query('AnalyticsUserResult');
    userResultsQuery.greaterThanOrEqualTo('reportDate', startDate);
    const totalUserResults = await userResultsQuery.count({ useMasterKey: true });

    // Calculate statistics
    const stats = {
      totalBatches: batches.length,
      totalUserResults,
      totalUsersAnalyzed: batches.reduce((sum, batch) => sum + batch.get('totalUsers'), 0),
      successfulAnalyses: batches.reduce((sum, batch) => sum + batch.get('successful'), 0),
      failedAnalyses: batches.reduce((sum, batch) => sum + batch.get('failed'), 0),
      averageExecutionTime: batches.length > 0 
        ? Math.round(batches.reduce((sum, batch) => sum + batch.get('executionTimeMs'), 0) / batches.length)
        : 0,
      reportTypes: {},
      requestSources: {}
    };

    // Calculate overall success rate
    const totalAnalyzed = stats.successfulAnalyses + stats.failedAnalyses;
    (stats as any).overallSuccessRate = totalAnalyzed > 0
      ? `${((stats.successfulAnalyses / totalAnalyzed) * 100).toFixed(1)}%`
      : '0%';

    // Analyze report types and request sources
    batches.forEach(batch => {
      const reportType = batch.get('reportType') || 'unknown';
      const metadata = batch.get('metadata') || {};
      const requestSource = metadata.requestSource || 'unknown';
      
      stats.reportTypes[reportType] = (stats.reportTypes[reportType] || 0) + 1;
      stats.requestSources[requestSource] = (stats.requestSources[requestSource] || 0) + 1;
    });

    // Get recent batches for dashboard
    const recentBatches = batches.slice(0, 10).map(batch => ({
      batchId: batch.get('batchId'),
      totalUsers: batch.get('totalUsers'),
      successful: batch.get('successful'),
      failed: batch.get('failed'),
      successRate: batch.get('successRate'),
      reportType: batch.get('reportType'),
      executionTimeMs: batch.get('executionTimeMs'),
      reportDate: batch.get('reportDate'),
      metadata: batch.get('metadata')
    }));

    // Calculate daily trends (last 7 days)
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      
      const dayBatches = batches.filter(batch => {
        const batchDate = batch.get('reportDate');
        return batchDate >= date && batchDate < nextDate;
      });
      
      last7Days.push({
        date: date.toISOString().split('T')[0],
        batches: dayBatches.length,
        usersAnalyzed: dayBatches.reduce((sum, batch) => sum + batch.get('totalUsers'), 0),
        successful: dayBatches.reduce((sum, batch) => sum + batch.get('successful'), 0),
        failed: dayBatches.reduce((sum, batch) => sum + batch.get('failed'), 0)
      });
    }

    // Performance metrics
    const performanceMetrics = {
      fastestExecution: batches.length > 0 
        ? Math.min(...batches.map(b => b.get('executionTimeMs')))
        : 0,
      slowestExecution: batches.length > 0 
        ? Math.max(...batches.map(b => b.get('executionTimeMs')))
        : 0,
      averageBatchSize: batches.length > 0
        ? Math.round(batches.reduce((sum, batch) => {
            const metadata = batch.get('metadata') || {};
            return sum + (metadata.batchSize || 0);
          }, 0) / batches.length)
        : 0
    };

    console.log(`✅ Generated analytics dashboard stats:`, {
      totalBatches: stats.totalBatches,
      totalUserResults: stats.totalUserResults,
      period: `${daysBack} days`
    });

    return {
      success: true,
      period: {
        days: daysBack,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString()
      },
      stats,
      recentBatches,
      trends: {
        daily: last7Days
      },
      performance: performanceMetrics,
      timestamp: new Date().toISOString()
    };

  } catch (error: any) {
    console.error('Error generating analytics dashboard stats:', error);
    
    return {
      success: false,
      error: error.message || 'Unknown error occurred',
      timestamp: new Date().toISOString()
    };
  }
});