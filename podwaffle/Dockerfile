# Home Assistant supplies this add-on directory, rather than the repository
# root, as the Docker build context. Fetch the pinned source revision instead
# of trying to COPY files which are outside that context.
FROM node:24-alpine AS build
ARG PODWAFFLE_REF=716df5271398bc30c6bcf7d8cccd6e1ab329354b
WORKDIR /workspace
RUN apk add --no-cache git \
 && git init \
 && git remote add origin https://github.com/podwaffle/podwaffle.git \
 && git fetch --depth 1 origin "${PODWAFFLE_REF}" \
 && git checkout --detach FETCH_HEAD \
 && corepack enable
RUN pnpm install --frozen-lockfile
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
COPY run.sh /run.sh
RUN chmod 0755 /run.sh && mkdir -p /data
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["/run.sh"]
