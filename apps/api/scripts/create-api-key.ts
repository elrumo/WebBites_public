#!/usr/bin/env bun
/**
 * CLI script to create API keys
 * Usage: bun run scripts/create-api-key.ts <userId> [name]
 */

import { getRedisClient, ensureRedisConnected } from '../server/utils/redis'
import { randomBytes } from 'crypto'

function generateApiKey(): string {
  const randomPart = randomBytes(24).toString('base64url')
  return `wb_live_${randomPart}`
}

async function createApiKey(userId: string, name?: string) {
  const redis = getRedisClient()
  await ensureRedisConnected()

  const apiKey = generateApiKey()

  // Store the API key
  await redis.set(`api_key:${apiKey}`, userId)

  // Store metadata
  if (name) {
    await redis.hSet(`api_key_meta:${apiKey}`, {
      userId,
      name,
      createdAt: new Date().toISOString()
    })
  }

  // Add to user's list
  await redis.sAdd(`user_api_keys:${userId}`, apiKey)

  console.log('\n✅ API Key created successfully!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`User ID: ${userId}`)
  if (name) console.log(`Name: ${name}`)
  console.log(`API Key: ${apiKey}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('\n⚠️  Save this key securely. You won\'t be able to see it again.\n')
  console.log('Usage in requests:')
  console.log(`  Authorization: Bearer ${apiKey}\n`)

  // Close the Redis connection
  await redis.quit()
}

const userId = process.argv[2]
const name = process.argv[3]

if (!userId) {
  console.error('Usage: bun run scripts/create-api-key.ts <userId> [name]')
  console.error('Example: bun run scripts/create-api-key.ts user123 "Chrome Extension"')
  process.exit(1)
}

createApiKey(userId, name).catch(console.error)
