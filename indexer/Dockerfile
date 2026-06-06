FROM node:20-alpine

WORKDIR /workspace/indexer

COPY indexer/package*.json ./

RUN npm ci

COPY indexer/src ./src
COPY indexer/tsconfig.json ./tsconfig.json

CMD ["npm", "start"]
