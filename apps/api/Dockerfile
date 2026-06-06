FROM node:20-alpine

ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_mintimeout=20000 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm_config_jobs=1

WORKDIR /workspace

COPY packages/core/package*.json ./packages/core/
COPY apps/api/package*.json ./apps/api/

RUN cd packages/core && npm ci
RUN cd apps/api && npm ci

COPY packages/core/src ./packages/core/src
COPY apps/api/src ./apps/api/src
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json

WORKDIR /workspace/apps/api

CMD ["npm", "start"]
