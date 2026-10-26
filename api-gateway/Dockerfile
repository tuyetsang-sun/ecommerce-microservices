FROM node:24-alpine

WORKDIR /app/api-gateway

ENV NODE_ENV=production
ENV PROTO_DIR=/app/proto

COPY api-gateway/package.json api-gateway/package-lock.json ./

RUN npm ci --omit=dev

COPY proto /app/proto
COPY api-gateway/src ./src
COPY api-gateway/scripts ./scripts

USER node

EXPOSE 3000

CMD ["node", "src/server.js"]