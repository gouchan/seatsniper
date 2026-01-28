# SeatSniper Production Dockerfile
# Multi-stage build for minimal image size

# ============================================================================
# Build Stage
# ============================================================================
FROM node:22-slim AS builder

# Install pnpm for faster installs (optional, can use npm)
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml* package-lock.json* ./
COPY tsconfig.json tsup.config.ts ./

# Install dependencies
RUN if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile; \
    else \
      npm ci; \
    fi

# Copy source code
COPY src ./src

# Build TypeScript
RUN if [ -f pnpm-lock.yaml ]; then \
      pnpm build; \
    else \
      npm run build; \
    fi

# ============================================================================
# Production Stage
# ============================================================================
FROM node:22-slim AS production

# Security: Run as non-root user
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs seatsniper

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* pnpm-lock.yaml* ./

# Install production dependencies only
RUN if [ -f pnpm-lock.yaml ]; then \
      corepack enable && corepack prepare pnpm@latest --activate && \
      pnpm install --prod --frozen-lockfile; \
    else \
      npm ci --omit=dev; \
    fi

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Copy venue data
COPY src/venues ./venues

# Set ownership
RUN chown -R seatsniper:nodejs /app

# Switch to non-root user
USER seatsniper

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "dist/index.js"]
