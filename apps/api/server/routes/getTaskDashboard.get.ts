import Parse from 'parse/node.js'
import { defineEventHandler, getQuery } from 'h3';

// Initialize Parse
Parse.initialize(import.meta.env.VITE_PARSE_ID, import.meta.env.VITE_PARSE_JS_KEY, import.meta.env.VITE_PARSE_MASTER_KEY)
Parse.serverURL = import.meta.env.VITE_PARSE_URL

// Define OpenAPI documentation
defineRouteMeta({
  openAPI: {
    tags: ["Task Management"],
    description: "Get task execution dashboard with overview statistics and recent activity",
    parameters: [
      {
        name: "days",
        in: "query",
        description: "Number of days to include in dashboard statistics",
        schema: { type: "integer", default: 30, maximum: 365 }
      }
    ],
    responses: {
      "200": {
        description: "Task execution dashboard data",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean" },
                overview: { type: "object" },
                tasks: { type: "object" },
                recentExecutions: { type: "array" },
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
    const days = Math.min(Number(query.days) || 30, 365);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    console.log(`📊 Generating task execution dashboard for last ${days} days`);

    // Get all task executions in the period
    const periodQuery = new Parse.Query('TaskExecution');
    periodQuery.greaterThanOrEqualTo('executionDate', startDate);
    periodQuery.limit(10000); // Should cover most use cases
    
    const allExecutions = await periodQuery.find({ useMasterKey: true });

    // Overall statistics
    const totalExecutions = allExecutions.length;
    const successfulExecutions = allExecutions.filter(exec => exec.get('result') === 'success').length;
    const errorExecutions = allExecutions.filter(exec => exec.get('result') === 'error').length;
    const successRate = totalExecutions > 0 ? ((successfulExecutions / totalExecutions) * 100).toFixed(1) : '0';

    // Task-specific statistics
    const taskStats = {};
    allExecutions.forEach(execution => {
      const taskName = execution.get('taskName');
      if (!taskStats[taskName]) {
        taskStats[taskName] = {
          name: taskName,
          total: 0,
          successful: 0,
          errors: 0,
          totalUsersAnalyzed: 0,
          totalUsersSynced: 0,
          totalSyncErrors: 0,
          averageExecutionTime: 0,
          lastExecution: null,
          scheduledRuns: 0,
          manualRuns: 0
        };
      }
      
      const stats = taskStats[taskName];
      stats.total++;
      
      if (execution.get('result') === 'success') {
        stats.successful++;
      } else {
        stats.errors++;
      }
      
      stats.totalUsersAnalyzed += execution.get('totalUsersAnalyzed') || 0;
      stats.totalUsersSynced += execution.get('usersSynced') || 0;
      stats.totalSyncErrors += execution.get('syncErrors') || 0;
      
      const execTime = execution.get('executionTimeMs') || 0;
      stats.averageExecutionTime = Math.round((stats.averageExecutionTime * (stats.total - 1) + execTime) / stats.total);
      
      const execDate = execution.get('executionDate');
      if (!stats.lastExecution || execDate > stats.lastExecution) {
        stats.lastExecution = execDate;
      }
      
      if (execution.get('triggerSource') === 'scheduled') {
        stats.scheduledRuns++;
      } else {
        stats.manualRuns++;
      }
    });

    // Recent executions (last 10)
    const recentQuery = new Parse.Query('TaskExecution');
    recentQuery.descending('executionDate');
    recentQuery.limit(10);
    
    const recentExecutions = await recentQuery.find({ useMasterKey: true });
    const formattedRecent = recentExecutions.map(execution => ({
      objectId: execution.id,
      taskName: execution.get('taskName'),
      result: execution.get('result'),
      message: execution.get('message'),
      executionTimeMs: execution.get('executionTimeMs'),
      executionDate: execution.get('executionDate'),
      triggerSource: execution.get('triggerSource'),
      usersAnalyzed: execution.get('totalUsersAnalyzed'),
      usersSynced: execution.get('usersSynced'),
      syncErrors: execution.get('syncErrors')
    }));

    // Daily execution trends (last 14 days)
    const dailyTrends = [];
    for (let i = 13; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      
      const dayExecutions = allExecutions.filter(exec => {
        const execDate = exec.get('executionDate');
        return execDate >= date && execDate < nextDate;
      });
      
      const dayStats = {
        date: date.toISOString().split('T')[0],
        total: dayExecutions.length,
        successful: dayExecutions.filter(exec => exec.get('result') === 'success').length,
        errors: dayExecutions.filter(exec => exec.get('result') === 'error').length,
        tasks: {}
      };
      
      // Break down by task
      dayExecutions.forEach(exec => {
        const taskName = exec.get('taskName');
        if (!dayStats.tasks[taskName]) {
          dayStats.tasks[taskName] = 0;
        }
        dayStats.tasks[taskName]++;
      });
      
      dailyTrends.push(dayStats);
    }

    // Health indicators
    const last24Hours = new Date();
    last24Hours.setHours(last24Hours.getHours() - 24);
    
    const recent24h = allExecutions.filter(exec => exec.get('executionDate') >= last24Hours);
    const recentErrors = recent24h.filter(exec => exec.get('result') === 'error');
    
    const healthIndicators = {
      isHealthy: recentErrors.length === 0,
      recentErrors: recentErrors.length,
      last24hExecutions: recent24h.length,
      alertLevel: recentErrors.length === 0 ? 'green' : recentErrors.length <= 2 ? 'yellow' : 'red'
    };

    // Performance metrics
    const executionTimes = allExecutions
      .map(exec => exec.get('executionTimeMs'))
      .filter(time => time != null)
      .sort((a, b) => a - b);
    
    const performanceMetrics = {
      averageExecutionTime: executionTimes.length > 0 
        ? Math.round(executionTimes.reduce((sum, time) => sum + time, 0) / executionTimes.length)
        : 0,
      fastestExecution: executionTimes.length > 0 ? executionTimes[0] : 0,
      slowestExecution: executionTimes.length > 0 ? executionTimes[executionTimes.length - 1] : 0,
      medianExecutionTime: executionTimes.length > 0 
        ? executionTimes[Math.floor(executionTimes.length / 2)]
        : 0
    };

    const overview = {
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString()
      },
      totalExecutions,
      successfulExecutions,
      errorExecutions,
      successRate: `${successRate}%`,
      uniqueTasks: Object.keys(taskStats).length,
      healthIndicators,
      performanceMetrics
    };

    console.log(`✅ Generated task dashboard:`, {
      totalExecutions,
      successRate: `${successRate}%`,
      uniqueTasks: Object.keys(taskStats).length,
      period: `${days} days`
    });

    return {
      success: true,
      overview,
      tasks: taskStats,
      recentExecutions: formattedRecent,
      trends: {
        daily: dailyTrends
      },
      timestamp: new Date().toISOString()
    };

  } catch (error: any) {
    console.error('Error generating task dashboard:', error);
    
    return {
      success: false,
      error: error.message || 'Unknown error occurred',
      timestamp: new Date().toISOString()
    };
  }
});