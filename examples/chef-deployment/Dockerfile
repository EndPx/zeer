# syntax=docker/dockerfile:1
FROM node:24.14.0-trixie-slim@sha256:8c8f12cedb96c3b59642cf30d713943c2b223990c9919b96a141681f62e6e292 AS builder
WORKDIR /app
RUN npm install --global pnpm@10.21.0 --ignore-scripts && npm cache clean --force
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
# runtime:build generates chef.generated.ts locally before this build.
COPY tsconfig.json *.ts *.mjs *.graphql ./
RUN pnpm exec tsc --noEmit --project tsconfig.json && pnpm prune --prod --ignore-scripts
ARG INSTALL_SCANNER=0
RUN mkdir -p /opt/zeer-scanner && \
    case "$INSTALL_SCANNER" in \
      0) ;; \
      1) node install-scanner.mjs --dir /opt/zeer-scanner && \
         chmod 0555 /opt/zeer-scanner /opt/zeer-scanner/scanner-v0.1.0-testnet.1 /opt/zeer-scanner/scanner-v0.1.0-testnet.1/zeer-scanner ;; \
      *) exit 1 ;; \
    esac

FROM node:24.14.0-trixie-slim@sha256:8c8f12cedb96c3b59642cf30d713943c2b223990c9919b96a141681f62e6e292 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/*.ts /app/*.mjs /app/*.graphql ./
COPY --from=builder /opt/zeer-scanner /opt/zeer-scanner
USER 1000:1000
EXPOSE 39370
ENTRYPOINT ["node", "runtime.mjs"]
CMD ["api"]
