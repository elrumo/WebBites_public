export default defineTask({
  meta: {
    name: "analytics:runUserCountsManual",
    description: "Manually trigger getUserCounts analytics. Supports: { userIds: string[], batchSize?: number } or { allUsers: true, batchSize?: number }",
  },
  async run({ payload, context }) {
    const startTime = new Date();
    console.log(`[analytics:runUserCountsManual] 🚀 Manually triggering getUserCounts analytics...`);
    
    // Validate and log the payload configuration
    let configDescription = '';
    
    if (payload?.allUsers) {
      configDescription = "Running analytics for ALL users from Parse";
      console.log(`[analytics:runUserCountsManual] 📋 ${configDescription}`);
    } else if (payload?.userIds && Array.isArray(payload.userIds) && payload.userIds.length > 0) {
      configDescription = `Running analytics for ${payload.userIds.length} specific users`;
      console.log(`[analytics:runUserCountsManual] 📋 ${configDescription}:`, payload.userIds.slice(0, 5), payload.userIds.length > 5 ? '...' : '');
    } else {
      configDescription = "No specific configuration provided - will use default behavior";
      console.log(`[analytics:runUserCountsManual] ⚠️  ${configDescription}`);
    }
    
    // Log batch size if specified
    if (payload?.batchSize) {
      console.log(`[analytics:runUserCountsManual] 📦 Using custom batch size: ${payload.batchSize}`);
    }
    
    try {
      console.log(`[analytics:runUserCountsManual] ⏳ Starting main analytics via HTTP route...`);
      
      // Call the HTTP route directly instead of runTask
      const baseURL = process.env.VITE_BACKEND_URL;
      
      const result = await $fetch('/v1/sync/getUserCounts', {
        method: 'POST',
        body: payload,
        baseURL,
        timeout: 300000, // 5 minute timeout for large operations
        retry: 1
      });
      
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const durationText = `${Math.round(duration / 1000)}s`;
      
      console.log(`[analytics:runUserCountsManual] ✅ Manual analytics task completed in ${durationText}:`, {
        result: result,
        summary: (result as any)?.summary,
        duration: durationText
      });
      
      // Provide more detailed success information
      if ((result as any)?.summary) {
        const summary = (result as any).summary;
        console.log(`[analytics:runUserCountsManual] 📊 Final Results:`, {
          totalUsers: summary.totalUsers,
          successful: summary.successful,
          failed: summary.failed,
          successRate: `${((summary.successful / summary.totalUsers) * 100).toFixed(1)}%`
        });
      }
      
      return {
        result: "success",
        message: "Manual analytics task completed successfully",
        config: configDescription,
        data: result,
        duration: durationText,
        timestamp: endTime.toISOString()
      };
      
    } catch (error: any) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const durationText = `${Math.round(duration / 1000)}s`;
      
      console.error(`[analytics:runUserCountsManual] 💥 Error running manual analytics task (after ${durationText}):`, {
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 3).join('\n') // First 3 lines of stack
      });
      
      return {
        result: "error",
        message: error.message || 'Unknown error occurred',
        config: configDescription,
        duration: durationText,
        timestamp: endTime.toISOString(),
        errorDetails: {
          name: error.name,
          cause: error.cause,
          code: error.code
        }
      };
    }
  },
});