ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.20
FROM ${BUILD_FROM}

WORKDIR /opt/podwaffle

RUN apk add --no-cache nodejs npm bash git

ARG REPO_URL=https://github.com/Invertee/PodWaffle.git
ARG REPO_REF=main
ARG BUILD_VERSION=dev

# The HA add-on build context only includes this folder, so fetch the app source
# at build time from the GitHub repository.
# BUILD_VERSION is included to force this layer to refresh when add-on version changes.
RUN echo "Building Podwaffle source for add-on version: ${BUILD_VERSION}" \
  && git clone --depth 1 --branch ${REPO_REF} ${REPO_URL} /opt/podwaffle/src \
  && cd /opt/podwaffle/src \
  && echo "Fetched source commit: $(git rev-parse HEAD)"

RUN cd /opt/podwaffle/src/server && npm ci --omit=dev

COPY run.sh /run.sh

RUN chmod a+x /run.sh

EXPOSE 3000

CMD [ "/run.sh" ]
