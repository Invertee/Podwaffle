ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.20
FROM ${BUILD_FROM}

WORKDIR /opt/podwaffle

RUN apk add --no-cache nodejs npm bash

COPY server/package*.json /opt/podwaffle/server/
RUN cd /opt/podwaffle/server && npm ci --omit=dev

COPY server /opt/podwaffle/server
COPY client /opt/podwaffle/client
COPY data /opt/podwaffle/data
COPY ha-addon/podwaffle/run.sh /run.sh

RUN chmod a+x /run.sh

EXPOSE 3000

CMD [ "/run.sh" ]
