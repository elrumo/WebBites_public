import { createClient } from 'redis'

export type RedisClientType = ReturnType<typeof createClient>

// Use globalThis to persist across hot-reloads in development
const globalForRedis = globalThis as unknown as {
  redisClient: RedisClientType | undefined
  isConnecting: boolean
  connectionPromise: Promise<void> | undefined
  lastConnectionError: Date | undefined
  connectionFailures: number
}

export function getRedisClient(): RedisClientType {
  if (!globalForRedis.redisClient) {
    const url = process.env.REDIS_URL || process.env.VITE_WEBBITES_AUTH_REDIS_HOST

    if (!url) throw new Error('REDIS_URL must be set (redis://host:6379)');

    console.log('[Redis] Initializing Redis client (lazy mode, no connection yet)');

    const client = createClient({
      url,
      socket: {
        reconnectStrategy: false, // Disable automatic reconnection
        connectTimeout: 5000, // 5 seconds (reduced from 10)
        keepAlive: true, // Enable TCP keep-alive
        noDelay: true, // Disable Nagle's algorithm for faster response
      },
    })

    // Handle connection events
    client.on('error', (err) => {
      // Only log errors if we're actually trying to connect
      if (globalForRedis.isConnecting || client.isOpen) {
        console.error('[Redis] Client error:', err.message)
      }
    })

    client.on('connect', () => {
      console.log('[Redis] Connected successfully')
    })

    client.on('ready', () => {
      console.log('[Redis] Client ready')
    })

    client.on('reconnecting', () => {
      console.log('[Redis] Reconnecting...')
    })

    // Store the client immediately (but don't connect yet - lazy connection)
    globalForRedis.redisClient = client
  }

  return globalForRedis.redisClient
}

// Helper to ensure connection is established
export async function ensureRedisConnected(): Promise<void> {
  const client = getRedisClient()

  // If already connected, return immediately
  if (client.isReady) {
    globalForRedis.connectionFailures = 0 // Reset failures on successful connection
    return
  }

  // If we've failed recently (within last 30 seconds), throw immediately to avoid blocking
  const BACKOFF_DURATION = 30000 // 30 seconds
  if (globalForRedis.lastConnectionError) {
    const timeSinceError = Date.now() - globalForRedis.lastConnectionError.getTime()
    if (timeSinceError < BACKOFF_DURATION && globalForRedis.connectionFailures >= 3) {
      throw new Error(`Redis unavailable (${globalForRedis.connectionFailures} failures, retry in ${Math.ceil((BACKOFF_DURATION - timeSinceError) / 1000)}s)`)
    }
  }

  // If already connecting, wait for the existing connection promise
  if (globalForRedis.isConnecting && globalForRedis.connectionPromise) {
    await globalForRedis.connectionPromise
    return
  }

  // Start a new connection
  globalForRedis.isConnecting = true

  globalForRedis.connectionPromise = (async () => {
    try {
      console.log('[Redis] Connecting to Redis...')
      await client.connect()
      console.log('[Redis] Connection established and ready')
      globalForRedis.connectionFailures = 0
      globalForRedis.lastConnectionError = undefined
    } catch (err: any) {
      console.error('[Redis] Failed to connect:', err.message)
      globalForRedis.connectionFailures = (globalForRedis.connectionFailures || 0) + 1
      globalForRedis.lastConnectionError = new Date()
      throw err
    } finally {
      globalForRedis.isConnecting = false
    }
  })()

  await globalForRedis.connectionPromise
}

// Check if Redis is available without throwing
export function isRedisAvailable(): boolean {
  const client = globalForRedis.redisClient
  return !!(client && client.isReady)
}
