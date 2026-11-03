/**
 * Structured logging utility for bookmark operations
 * Provides consistent, searchable logs with context
 */

import type { LogContext } from '../types/bookmark.types';

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  operation: string;
  message: string;
  context?: LogContext;
  error?: any;
}

class BookmarkLogger {
  private isProduction = process.env.NODE_ENV === 'production';

  private formatLog(entry: LogEntry): string {
    const contextStr = entry.context ? ` | ${JSON.stringify(entry.context)}` : '';
    return `${entry.message}${contextStr}`;
    // return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.operation}] ${entry.message}${contextStr}`;
  }

  private shouldLog(level: LogLevel): boolean {
    // In production, skip debug logs only — errors/warnings/info must still be
    // emitted (the previous version suppressed ALL levels in production,
    // making failures impossible to diagnose).
    if (this.isProduction && level === LogLevel.DEBUG) {
      return false;
    }
    return true;
  }

  private log(level: LogLevel, operation: string, message: string, context?: LogContext, error?: any): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      operation,
      message,
      context,
      error,
    };

    const formattedLog = this.formatLog(entry);

    switch (level) {
      case LogLevel.ERROR:
        console.error(formattedLog, error || '');
        break;
      case LogLevel.WARN:
        console.warn(formattedLog);
        break;
      case LogLevel.DEBUG:
        console.debug(formattedLog);
        break;
      default:
        console.log(formattedLog);
    }
  }

  debug(operation: string, message: string, context?: LogContext): void {
    this.log(LogLevel.DEBUG, operation, message, context);
  }

  info(operation: string, message: string, context?: LogContext): void {
    this.log(LogLevel.INFO, operation, message, context);
  }

  warn(operation: string, message: string, context?: LogContext): void {
    this.log(LogLevel.WARN, operation, message, context);
  }

  error(operation: string, message: string, error?: any, context?: LogContext): void {
    this.log(LogLevel.ERROR, operation, message, context, error);
  }

  // Specific bookmark operation loggers
  bookmarkSaved(userId: string, url: string, bookmarkId: string, fromCache: boolean, duration: number): void {
    this.info('bookmark.saved', 'Bookmark saved successfully', {
      userId,
      url,
      bookmarkId,
      fromCache,
      duration,
    });
  }

  batchStarted(userId: string, batchSize: number): void {
    this.info('bookmark.batch.started', 'Batch bookmark processing started', {
      userId,
      batchSize,
    });
  }

  batchCompleted(userId: string, savedCount: number, skippedCount: number, duration: number): void {
    this.info('bookmark.batch.completed', 'Batch bookmark processing completed', {
      userId,
      savedCount,
      skippedCount,
      duration,
      averageTimePerBookmark: duration / (savedCount + skippedCount),
    });
  }

  cacheHit(url: string, userId: string): void {
    this.debug('bookmark.cache.hit', 'Cache hit for bookmark', { url, userId });
  }

  cacheMiss(url: string, userId: string): void {
    this.debug('bookmark.cache.miss', 'Cache miss for bookmark', { url, userId });
  }

  metadataFetchStarted(url: string): void {
    this.debug('bookmark.metadata.fetch.started', 'Fetching metadata', { url });
  }

  metadataFetchCompleted(url: string, duration: number): void {
    this.debug('bookmark.metadata.fetch.completed', 'Metadata fetch completed', { url, duration });
  }

  metadataFetchFailed(url: string, error: any): void {
    this.error('bookmark.metadata.fetch.failed', 'Failed to fetch metadata', error, { url });
  }

  duplicateDetected(url: string, userId: string, bookmarkId: string): void {
    this.debug('bookmark.duplicate.detected', 'Duplicate bookmark detected', { url, userId, bookmarkId });
  }

  limitExceeded(userId: string, currentCount: number, maxCount: number): void {
    this.warn('bookmark.limit.exceeded', 'Bookmark limit exceeded', {
      userId,
      currentCount,
      maxCount,
    });
  }

  queuedForProcessing(bookmarkId: string, queueName: string, requestType: string): void {
    this.debug('bookmark.queued', 'Bookmark queued for processing', {
      bookmarkId,
      queueName,
      requestType,
    });
  }

  performanceMetric(operation: string, duration: number, context?: LogContext): void {
    this.info('bookmark.performance', `${operation} completed in ${duration}ms`, {
      ...context,
      operation,
      duration,
    });
  }
}

// Export singleton instance
export const bookmarkLogger = new BookmarkLogger();

// Convenience exports for backward compatibility
export const log = (message: string, context?: LogContext) => bookmarkLogger.info('bookmark', message, context);
export const errorLog = (message: string, error?: any, context?: LogContext) => bookmarkLogger.error('bookmark', message, error, context);
