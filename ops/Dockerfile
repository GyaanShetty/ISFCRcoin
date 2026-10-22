# Build: install everything, build the web app, run the core tests, then drop dev dependencies.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/node/package.json apps/node/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages ./packages
COPY apps ./apps
COPY test-vectors ./test-vectors
RUN npm run build -w @isfcr/web \
 && npm test -w @isfcr/core \
 && npm prune --omit=dev

# Run: the node serves the API, the live feed and the built web app on one port.
FROM node:22-slim
WORKDIR /app
COPY --from=build /app ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DB_PATH=/data/isfcr.sqlite
VOLUME /data
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "apps/node/src/main.ts"]
