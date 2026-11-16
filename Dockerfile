# One image: Express serves the API and the built client on one origin (D18).

# --- build: install everything, compile shared → server → client ---
FROM node:24-alpine AS build
WORKDIR /app
# Manifests first, so the npm ci layer is reused when only source code changes.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY client client
RUN npm run build

# --- deps: production dependencies of the server and shared only ---
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace=server --workspace=shared

# --- runtime ---
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/client/dist
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/shared/package.json shared/
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
# Exec form: node is PID 1 and receives SIGTERM directly (graceful shutdown in main.ts).
CMD ["node", "server/dist/main.js"]
