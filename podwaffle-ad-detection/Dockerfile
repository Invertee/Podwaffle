FROM node:24-bookworm-slim AS native
ARG WHISPER_REF=v1.9.4
RUN apt-get update && apt-get install -y --no-install-recommends git cmake build-essential ca-certificates libssl-dev \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "${WHISPER_REF}" https://github.com/ggml-org/whisper.cpp /whisper \
 && cmake -S /whisper -B /whisper/build -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=OFF -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF \
 && cmake --build /whisper/build --target whisper-cli -j2

FROM node:24-bookworm-slim
ARG BUILD_VERSION=local
ARG BUILD_ARCH=local
ENV NODE_ENV=production DATA_DIR=/data
LABEL io.hass.type="addon" io.hass.version="${BUILD_VERSION}" io.hass.arch="${BUILD_ARCH}"
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates libgomp1 libssl3 tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=native /whisper/build/bin/whisper-cli /usr/local/bin/whisper-cli
RUN whisper-cli --help
COPY src ./src
COPY public ./public
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
 CMD node -e "fetch('http://127.0.0.1:5000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
