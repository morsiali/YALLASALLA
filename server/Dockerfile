FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspace=server --include-workspace-root
COPY db db
COPY server server
RUN npm run build -w server
ENV NODE_ENV=production
EXPOSE 4000
# Apply migrations (idempotent) and seed demo data only when SEED_DEMO=1, then start.
CMD ["sh", "-c", "node server/dist/migrate.js && ([ \"$SEED_DEMO\" = \"1\" ] && node server/dist/seed/seed.js || true) && node server/dist/index.js"]
