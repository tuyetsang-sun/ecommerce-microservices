FROM node:24-alpine

WORKDIR /app/services/order-service

ENV NODE_ENV=production
ENV PROTO_DIR=/app/proto

COPY services/order-service/package.json services/order-service/package-lock.json ./
RUN npm ci --omit=dev

COPY proto /app/proto
COPY services/order-service/src ./src
COPY services/order-service/scripts ./scripts
COPY services/order-service/migrations ./migrations
COPY services/order-service/tests ./tests

USER node

EXPOSE 50054

CMD ["sh", "-c", "node scripts/migrate.cjs && exec node src/interfaces/grpc/server.js"]