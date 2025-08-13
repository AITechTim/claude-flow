# Multi-stage Dockerfile for Claude Flow Tracing System
# Optimized for production deployment with security and performance

# Build stage
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    curl

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY tsconfig.build.json ./

# Install dependencies (including dev dependencies for building)
RUN npm ci --only=production=false

# Copy source code
COPY src/ ./src/
COPY tests/ ./tests/

# Build the application
RUN npm run build:tracing

# Run tests during build (fail fast)
RUN npm run test:tracing:unit

# Production stage
FROM node:20-alpine AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S tracing -u 1001

# Install runtime dependencies only
RUN apk add --no-cache \
    tini \
    curl \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/src/tracing/config/ ./dist/config/

# Create necessary directories with correct permissions
RUN mkdir -p /app/logs /app/tmp /app/data && \
    chown -R tracing:nodejs /app

# Copy health check script
COPY docker/healthcheck.sh /usr/local/bin/healthcheck.sh
RUN chmod +x /usr/local/bin/healthcheck.sh

# Switch to non-root user
USER tracing

# Expose ports
EXPOSE 3000 8080 9090

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD /usr/local/bin/healthcheck.sh

# Set environment variables
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512" \
    LOG_LEVEL=info \
    TRACING_PORT=3000 \
    HEALTH_PORT=8080 \
    METRICS_PORT=9090

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application
CMD ["node", "dist/tracing/server.js"]

# Labels for metadata
LABEL maintainer="Claude Flow Team" \
      version="1.0.0" \
      description="Claude Flow Tracing System" \
      org.opencontainers.image.title="Claude Flow Tracing" \
      org.opencontainers.image.description="Distributed tracing system for Claude Flow" \
      org.opencontainers.image.vendor="Claude Flow" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/ruvnet/claude-flow" \
      org.opencontainers.image.documentation="https://github.com/ruvnet/claude-flow/docs"