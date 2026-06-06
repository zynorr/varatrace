FROM node:20-alpine

WORKDIR /workspace/apps/web

COPY apps/web/package*.json ./

RUN npm ci

COPY apps/web ./

CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0"]
