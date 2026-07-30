FROM node:24-alpine AS build
WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile \
    --filter . \
    --filter @podwaffle/server... \
    --filter @podwaffle/web...

COPY packages/contracts packages/contracts
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm build \
 && pnpm --filter @podwaffle/server deploy --prod --legacy /production/server

FROM node:24-alpine
ARG BUILD_VERSION=local
ARG BUILD_ARCH=local
ENV NODE_ENV=production \
    PODWAFFLE_DATA_DIR=/data \
    PODWAFFLE_OPTIONS_PATH=/data/options.json \
    PODWAFFLE_WEB_DIST=/app/apps/web/dist
LABEL io.hass.type="app" \
      io.hass.version="${BUILD_VERSION}" \
      io.hass.arch="${BUILD_ARCH}" \
      org.opencontainers.image.title="Podwaffle" \
      org.opencontainers.image.description="Self-hosted podcast server and web client" \
      org.opencontainers.image.source="https://github.com/podwaffle/podwaffle"
WORKDIR /app
COPY --from=build /production/server apps/server
COPY --from=build /workspace/apps/web/dist apps/web/dist
COPY podwaffle/run.sh /run.sh
RUN chmod 0755 /run.sh && mkdir -p /data
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["/run.sh"]
