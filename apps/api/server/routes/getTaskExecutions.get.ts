import Parse from 'parse/node.js'
import { defineEventHandler, getQuery } from 'h3';

// Initialize Parse
Parse.initialize(process.env.VITE_PARSE_ID, process.env.VITE_PARSE_JS_KEY, process.env.VITE_PARSE_MASTER_KEY)
Parse.serverURL = process.env.VITE_PARSE_URL

interface TaskExecutionQuery {
  taskName?: string;
  result?: 'success' | 'error';
  triggerSource?: 'manual' | 'scheduled';
  limit?: number;
  skip?: number;
  startDate?: string;
  endDate?: string;
  includePayload?: boolean;
}

// Define OpenAPI documentation
defineRouteMeta({
  openAPI: {
    tags: ["Task Management"],
    description: "Get task execution history and logs from Parse",
    parameters: [
      {
        name: "taskName",
        in: "query",
        description: "Filter by specific task name (e.g., 'analytics:smartSync')",
        schema: { type: "string" }
      },
      {
        name: "result",
        in: "query",
        description: "Filter by execution result",
        schema: { type: "string", enum: ["success", "error"] }
      },
      {
        name: "triggerSource",
        in: "query",
        description: "Filter by how task was triggered",
        schema: { type: "string", enum: ["manual", "scheduled"] }
      },
      {
        name: "limit",
        in: "query",
        description: "Number of results to return",
        schema: { type: "integer", default: 50, maximum: 200 }
      },
      {
        name: "skip",
        in: "query",
        description: "Number of results to skip (pagination)",
        schema: { type: "integer", default: 0 }
      },
      {
        name: "startDate",
        in: "query",
        description: "Filter executions after this date (ISO string)",
        schema: { type: "string", format: "date-time" }
      },
      {
        name: "endDate",
        in: "query",
        description: "Filter executions before this date (ISO string)",
        schema: { type: "string", format: "date-time" }
      },
      {
        name: "includePayload",
        in: "query",
        description: "Include full execution payload in results",
        schema: { type: "boolean", default: false }
      }
    ],
    responses: {
      "200": {
        description: "Task execution history",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean" },
                summary: { type: "object" },
                executions: { type: "array" },
                stats: { type: "object" }
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
    const query: TaskExecutionQuery = getQuery(event);
    const limit = Math.min(Number(query.limit) || 50, 200); // Max 200
    const skip = Number(query.skip) || 0;
    const includePayload = Boolean(query.includePayload);

    console.log(`📋 Fetching task execution history with filters:`, {
      taskName: query.taskName,
      result: query.result,
      triggerSource: query.triggerSource,
      limit,
      skip
    });

    // Build the query
    const executionQuery = new Parse.Query('TaskExecution');
    
    // Apply filters
    if (query.taskName) {
      executionQuery.equalTo('taskName', query.taskName);
    }
    if (query.result) {
      executionQuery.equalTo('result', query.result);
    }
    if (query.triggerSource) {
      executionQuery.equalTo('triggerSource', query.triggerSource);
    }
    if (query.startDate) {
      executionQuery.greaterThanOrEqualTo('executionDate', new Date(query.startDate));
    }
    if (query.endDate) {
      executionQuery.lessThanOrEqualTo('executionDate', new Date(query.endDate));
    }
    
    // Order by most recent first
    executionQuery.descending('executionDate');
    executionQuery.limit(limit);
    executionQuery.skip(skip);
    
    // Select fields based on includePayload
    if (!includePayload) {
      executionQuery.select([
        'taskName', 'result', 'message', 'executionTimeMs', 'executionDate',
        'totalUsersAnalyzed', 'usersNeedingSync', 'usersSynced', 'syncErrors',
        'skippedDueToThreshold', 'analyticsBatchId', 'isScheduled', 'triggerSource'
      ]);
    }
    
    const executions = await executionQuery.find({ useMasterKey: true });
    
    // Format results
    const formattedExecutions = executions.map(execution => {
      const result = {
        objectId: execution.id,
        taskName: execution.get('taskName'),
        result: execution.get('result'),
        message: execution.get('message'),
        executionTimeMs: execution.get('executionTimeMs'),
        executionDate: execution.get('executionDate'),
        totalUsersAnalyzed: execution.get('totalUsersAnalyzed') || 0,
        usersNeedingSync: execution.get('usersNeedingSync') || 0,
        usersSynced: execution.get('usersSynced') || 0,
        syncErrors: execution.get('syncErrors') || 0,
        skippedDueToThreshold: execution.get('skippedDueToThreshold') || false,
        analyticsBatchId: execution.get('analyticsBatchId'),
        isScheduled: execution.get('isScheduled'),
        triggerSource: execution.get('triggerSource'),
        createdAt: execution.createdAt,
        updatedAt: execution.updatedAt
      };
      
      if (includePayload) {
        (result as any).payload = execution.get('payload');
      }
      
      return result;
    });

    // Get summary statistics
    const statsQuery = new Parse.Query('TaskExecution');
    if (query.taskName) {
      statsQuery.equalTo('taskName', query.taskName);
    }
    if (query.startDate) {
      statsQuery.greaterThanOrEqualTo('executionDate', new Date(query.startDate));
    }
    if (query.endDate) {
      statsQuery.lessThanOrEqualTo('executionDate', new Date(query.endDate));
    }
    
    const totalExecutions = await statsQuery.count({ useMasterKey: true });
    
    // Get success/error counts
    const successQuery = new Parse.Query('TaskExecution');
    if (query.taskName) {
      successQuery.equalTo('taskName', query.taskName);
    }
    if (query.startDate) {
      successQuery.greaterThanOrEqualTo('executionDate', new Date(query.startDate));
    }
    if (query.endDate) {
      successQuery.lessThanOrEqualTo('executionDate', new Date(query.endDate));
    }
    successQuery.equalTo('result', 'success');
    const successCount = await successQuery.count({ useMasterKey: true });
    
    const errorQuery = new Parse.Query('TaskExecution');
    if (query.taskName) {
      errorQuery.equalTo('taskName', query.taskName);
    }
    if (query.startDate) {
      errorQuery.greaterThanOrEqualTo('executionDate', new Date(query.startDate));
    }
    if (query.endDate) {
      errorQuery.lessThanOrEqualTo('executionDate', new Date(query.endDate));
    }
    errorQuery.equalTo('result', 'error');
    const errorCount = await errorQuery.count({ useMasterKey: true });
    
    // Get recent task activity (last 7 days)
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 7);
    
    const recentQuery = new Parse.Query('TaskExecution');
    recentQuery.greaterThanOrEqualTo('executionDate', recentDate);
    if (query.taskName) {
      recentQuery.equalTo('taskName', query.taskName);
    }
    
    const recentExecutions = await recentQuery.count({ useMasterKey: true });
    
    // Calculate daily activity for last 7 days
    const dailyActivity = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      
      const dayQuery = new Parse.Query('TaskExecution');
      dayQuery.greaterThanOrEqualTo('executionDate', date);
      dayQuery.lessThan('executionDate', nextDate);
      if (query.taskName) {
        dayQuery.equalTo('taskName', query.taskName);
      }
      
      const dayCount = await dayQuery.count({ useMasterKey: true });
      
      dailyActivity.push({
        date: date.toISOString().split('T')[0],
        executions: dayCount
      });
    }
    
    const summary = {
      totalExecutions,
      returnedExecutions: formattedExecutions.length,
      successCount,
      errorCount,
      successRate: totalExecutions > 0 ? `${((successCount / totalExecutions) * 100).toFixed(1)}%` : '0%',
      recentActivity: recentExecutions,
      pagination: {
        limit,
        skip,
        hasMore: formattedExecutions.length === limit
      },
      filters: {
        taskName: query.taskName,
        result: query.result,
        triggerSource: query.triggerSource,
        dateRange: query.startDate || query.endDate ? {
          start: query.startDate,
          end: query.endDate
        } : null
      }
    };

    const stats = {
      dailyActivity,
      averageExecutionTime: formattedExecutions.length > 0 
        ? Math.round(formattedExecutions.reduce((sum, exec) => sum + (exec.executionTimeMs || 0), 0) / formattedExecutions.length)
        : 0,
      lastExecution: formattedExecutions.length > 0 ? formattedExecutions[0].executionDate : null
    };

    console.log(`✅ Retrieved task execution history:`, {
      totalFound: totalExecutions,
      returned: formattedExecutions.length,
      successRate: summary.successRate
    });

    return {
      success: true,
      summary,
      executions: formattedExecutions,
      stats,
      timestamp: new Date().toISOString()
    };

  } catch (error: any) {
    console.error('Error fetching task execution history:', error);
    
    return {
      success: false,
      error: error.message || 'Unknown error occurred',
      timestamp: new Date().toISOString()
    };
  }
});