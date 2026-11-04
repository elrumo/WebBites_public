# Use the official Bun image as a parent image (much faster than Node + npm)
# Use latest stable Bun 1.x to match local development
FROM oven/bun:1-alpine AS base

# Install dependencies
FROM base AS deps
WORKDIR /app

# Copy package files first for better layer caching
COPY package.json bun.lock* ./

# Install build tools and dependencies without caching
# Python and build tools needed for native dependencies (re2, sharp, etc.)
RUN apk add --no-cache \
        libc6-compat \
        python3 \
        make \
        g++ && \
    bun install --frozen-lockfile --ignore-scripts && \
    cd node_modules/sharp && bun run install

# Build the application
FROM base AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./

# Copy config files first (changes less frequently)
COPY tsconfig.json ./
COPY nitro.config.* ./

# Copy templates (changes occasionally)
COPY emailTemplates ./emailTemplates

# Imported by server/utils/mcpToolCatalogue.ts
COPY docs/mcp-tools.json ./docs/mcp-tools.json

# Copy source code last (changes most frequently)
COPY server ./server

# Build with Bun (without Sentry)
RUN bun run build

# Setup the runtime environment
# Use Bun for runtime since Nitro preset is set to 'bun'
FROM oven/bun:1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg transcodes uploaded audio to AAC and reads its length and waveform
# (server/utils/audioFile.ts). Without it a voice note recorded in Chrome stays
# WebM/Opus, which no Apple client can play.
RUN apk add --no-cache ffmpeg

# Create a non-root user in a single layer
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nitro -u 1001

# Copy only necessary files for production
COPY --from=builder --chown=nitro:nodejs /app/.output ./.output
COPY --from=builder --chown=nitro:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nitro:nodejs /app/package.json ./
COPY --from=builder --chown=nitro:nodejs /app/emailTemplates ./emailTemplates

# OCR language data (tesseract). Read from the working directory, so image text extraction
# works without reaching a CDN.
COPY --chown=nitro:nodejs *.traineddata ./

# Use the non-root user
USER nitro

EXPOSE 3000
ENV PORT=3000
ENV HOST=0.0.0.0

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=8 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", ".output/server/index.mjs"]