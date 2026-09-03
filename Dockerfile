FROM node:20-alpine

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies cleanly
RUN npm ci --omit=dev

# Copy application source code and web assets
COPY src/ ./src/
COPY public/ ./public/
COPY scripts/ ./scripts/

EXPOSE 5001

ENV PORT=5001
ENV NODE_ENV=production
ENV IS_DOCKER=true

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:5001/api/health || exit 1

CMD ["node", "src/server.js"]
