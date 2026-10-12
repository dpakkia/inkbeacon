# InkBeacon: self-hosted image. Data lives in /data (mount a volume there).
# Build and run with docker compose (see INSTALL.md), or:
#   docker build -t inkbeacon .
#   docker run -p 3000:3000 -v inkbeacon-data:/data -e STUDIO_ACCESS_KEY=… inkbeacon

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    STORAGE=filesystem \
    STORAGE_DIR=/data
RUN addgroup -S inkbeacon && adduser -S inkbeacon -G inkbeacon \
    && mkdir -p /data && chown inkbeacon:inkbeacon /data
COPY --from=build --chown=inkbeacon:inkbeacon /app/.next/standalone ./
COPY --from=build --chown=inkbeacon:inkbeacon /app/.next/static ./.next/static
COPY --from=build --chown=inkbeacon:inkbeacon /app/public ./public
USER inkbeacon
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/session >/dev/null || exit 1
CMD ["node", "server.js"]
