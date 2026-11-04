# syntax=docker/dockerfile:1.4

# Build: install with the lockfile, compile the cloud code (TypeScript) to dist/.
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN bun run build

# Production dependencies only.
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Parse Server runs on Node.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    DOCKER_ENV=true \
    PORT=1337

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY src ./src
COPY email_templates ./email_templates
COPY scripts ./scripts

USER node
EXPOSE 1337
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||1337)+(process.env.PARSE_MOUNT_PATH||'/parse')+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
