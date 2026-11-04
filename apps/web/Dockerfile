# syntax=docker/dockerfile:1.4

# Stage 1: build the Nuxt app. The output is plain JavaScript, so it is built once on the build
# machine's own architecture and copied into each target image (a build under emulation would be
# many times slower and runs out of memory).
FROM --platform=$BUILDPLATFORM oven/bun:1 AS builder
WORKDIR /app

# `patches/` too: package.json's patchedDependencies points at it and `bun install` fails without it.
COPY package.json bun.lock ./
COPY patches ./patches

RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts

COPY . .
RUN bunx nuxt prepare

# The client bundle needs a large heap; the default makes the build run out of memory.
# Lower BUILD_HEAP_MB on small CI runners if you have to (and expect it to be slower).
ARG BUILD_HEAP_MB=8192
ENV NODE_OPTIONS=--max-old-space-size=${BUILD_HEAP_MB}
# Smaller peak memory; source maps aren't needed in the image.
ENV NUXT_DISABLE_SOURCEMAPS=1

RUN bun run build

# Stage 2: production dependencies only
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY patches ./patches
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --ignore-scripts

# Stage 3: runtime
FROM oven/bun:1
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.output ./.output

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
EXPOSE 3000

# Maps the deploy env (PARSE_*, BACKEND_*, ...) onto the NUXT_* names Nitro reads at runtime.
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER bun
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["./docker-entrypoint.sh"]
