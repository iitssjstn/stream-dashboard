# syntax=docker/dockerfile:1

# ---------- build the dashboard + overlay (static files) ----------
FROM node:22-bookworm-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---------- server dependencies ----------
FROM node:22-bookworm-slim AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
# better-sqlite3 ships prebuilt binaries for linux x64/arm64 (glibc + musl), so no compiler is needed.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && node -e "new (require('better-sqlite3'))(':memory:').exec('select 1')"

# ---------- runtime ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    WEB_DIST=/app/web/dist
WORKDIR /app/server
COPY --from=server-deps /app/server/node_modules ./node_modules
COPY server/package.json server/tsconfig.json ./
COPY server/src ./src
COPY server/drizzle ./drizzle
COPY --from=web /app/web/dist /app/web/dist
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/index.ts"]
