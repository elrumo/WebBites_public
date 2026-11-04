# Playwright's base image already carries Chromium and the system libraries it needs.
# Keep the tag in step with the playwright version in package.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY package.json ./
# The browsers ship in the base image; don't download them again.
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force
COPY src ./src

# pwuser is the unprivileged user the base image provides.
USER pwuser
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
