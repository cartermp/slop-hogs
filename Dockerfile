FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --engine-strict
COPY . .
RUN npm run build

FROM node:24.19.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
# Keep TypeScript for Next's next.config.ts loader and the operational scripts.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json /app/next.config.ts /app/tsconfig.json ./
COPY --from=build --chown=node:node /app/config ./config
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/migrations ./migrations
USER node
EXPOSE 3000
CMD ["sh", "scripts/start-production.sh"]
