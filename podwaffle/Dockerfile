ARG BUILD_VERSION=local
ARG BUILD_ARCH=local

# Home Assistant builds an add-on with only the add-on directory as context.
# Fetch the application source instead of trying to COPY files from the
# repository root, which is outside that context.
FROM node:24-alpine AS build
ARG BUILD_VERSION
ARG PODWAFFLE_REF=main
WORKDIR /workspace
RUN echo "Building Podwaffle ${BUILD_VERSION} from ${PODWAFFLE_REF}" \
 && apk add --no-cache git \
 && git init \
 && git remote add origin https://github.com/Invertee/Podwaffle.git \
 && git fetch --depth 1 origin "${PODWAFFLE_REF}" \
 && git checkout --detach FETCH_HEAD \
 && corepack enable
RUN pnpm install --frozen-lockfile \
    --filter . \
    --filter @podwaffle/server... \
    --filter @podwaffle/web...
RUN pnpm build \
 && pnpm --filter @podwaffle/server deploy --prod --legacy /production/server

FROM node:24-alpine
ARG BUILD_VERSION
ARG BUILD_ARCH
ENV NODE_ENV=production \
    PODWAFFLE_DATA_DIR=/data \
    PODWAFFLE_OPTIONS_PATH=/data/options.json \
    PODWAFFLE_WEB_DIST=/app/apps/web/dist
LABEL io.hass.type="app" \
      io.hass.version="${BUILD_VERSION}" \
      io.hass.arch="${BUILD_ARCH}" \
      org.opencontainers.image.title="Podwaffle" \
      org.opencontainers.image.description="Self-hosted podcast server and web client" \
      org.opencontainers.image.source="https://github.com/Invertee/Podwaffle"
WORKDIR /app
COPY --from=build /production/server apps/server
COPY --from=build /workspace/apps/web/dist apps/web/dist
COPY run.sh /run.sh
RUN chmod 0755 /run.sh && mkdir -p /data
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["/run.sh"]
