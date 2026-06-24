# Must be linux/amd64 for EigenCompute. Build:
#   docker build --platform linux/amd64 \
#     --build-arg GIT_SHA=$(git rev-parse --short HEAD) \
#     --build-arg BUILD_TIME=$(date -u +%FT%TZ) \
#     -t <registry/waybill:tag> .

# --- stage 1: build the TS + Tailwind SPA into /public ---
FROM --platform=linux/amd64 node:20-slim AS web
WORKDIR /web
COPY web/package.json ./
COPY web/vendor ./vendor
RUN npm install
COPY web/ ./
RUN npm run build   # vite outDir ../public -> /public

# --- stage 2: runtime ---
FROM --platform=linux/amd64 node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY tsconfig.json ./
COPY src ./src
COPY --from=web /public ./public

ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ENV GIT_SHA=$GIT_SHA BUILD_TIME=$BUILD_TIME

# App must listen on 0.0.0.0 (not localhost) and EXPOSE its port for the TEE.
EXPOSE 8080
CMD ["npm", "start"]
