# Sync Endpoints

This directory contains endpoints for synchronizing and reconciling data across the application.

## Endpoints

### POST /v1/sync/reconcileBookmarkCounts

Reconciles the `usage.currentMonth.bookmarksTotal` field with the actual `bookmarksTotal` counter for a user.

**Purpose:** Fixes sync issues caused by race conditions during bulk bookmark imports.

**Request:**
```json
{
  "userId": "abc123def456"
}
```

**Response (Success):**
```json
{
  "success": true,
  "actualTotal": 95,
  "syncedTotal": 95,
  "previousTotal": 85,
  "difference": 10,
  "timestamp": "2023-12-31T23:59:59.999Z"
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "User not found",
  "timestamp": "2023-12-31T23:59:59.999Z"
}
```

**Usage:**
- Automatically called when import sessions complete
- Can be manually triggered for users with sync issues
- Safe to call multiple times (idempotent)

**Example:**
```bash
curl -X POST https://api.webbites.io/v1/sync/reconcileBookmarkCounts \
  -H "Content-Type: application/json" \
  -d '{"userId": "abc123def456"}'
```
