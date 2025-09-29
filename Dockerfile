# ---- Base Stage ----
FROM oven/bun:1 as base
WORKDIR /usr/src/app

# ---- Dependencies Stage ----
FROM base as deps
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

# ---- Production Stage ----
FROM base as production
# Copy dependencies
COPY --from=deps /usr/src/app/node_modules ./node_modules

# Copy source code
COPY src ./src
COPY package.json ./
COPY config.json ./

# Create logs directory
RUN mkdir -p logs

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8088

EXPOSE 8088

# Use non-root user
USER bun

CMD ["bun", "run", "src/master.ts"]
