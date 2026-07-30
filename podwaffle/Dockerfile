# Build with the monorepo root as context:
# docker build -f podwaffle/Dockerfile -t podwaffle:local .
FROM node:24-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile
COPY apps/server apps/server
COPY apps/web apps/web
COPY packages/contracts packages/contracts
RUN pnpm --filter @podwaffle/contracts build \
 && pnpm --filter @podwaffle/web build \
 && pnpm --filter @podwaffle/server build \
 && pnpm prune --prod

FROM node:24-alpine
ENV NODE_ENV=production \
    PODWAFFLE_DATA_DIR=/data \
    PODWAFFLE_OPTIONS_PATH=/data/options.json \
    PODWAFFLE_WEB_DIST=/app/apps/web/dist
WORKDIR /app
COPY --from=build /workspace/node_modules node_modules
COPY --from=build /workspace/apps/server/dist apps/server/dist
COPY --from=build /workspace/apps/server/node_modules apps/server/node_modules
COPY --from=build /workspace/apps/server/package.json apps/server/package.json
COPY --from=build /workspace/apps/web/dist apps/web/dist
COPY --from=build /workspace/packages/contracts/dist packages/contracts/dist
COPY --from=build /workspace/packages/contracts/package.json packages/contracts/package.json
COPY podwaffle/run.sh /run.sh
RUN chmod 0755 /run.sh && mkdir -p /data
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["/run.sh"]
