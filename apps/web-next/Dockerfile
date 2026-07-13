# Multi-stage build for the Sprinkler web app (Next.js standalone output).
# Build:  docker build -t rainbird-web-next .
# Run:    docker run -p 3000:3000 --env-file .env rainbird-web-next
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Bootstrap image (build with --target bootstrap): runs migrations + idempotent
# seed against DATABASE_URL, then exits. Used by the k8s post-sync Job.
FROM builder AS bootstrap
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
USER nextjs
CMD ["npm", "run", "db:bootstrap"]

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# SQL migration files shipped for reference/ops; apply them with
# `npm run db:migrate` from a checkout pointed at the same DATABASE_URL.
COPY --from=builder /app/drizzle ./drizzle
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
