FROM node:24-alpine

WORKDIR /app/services/customer-service

ENV NODE_ENV=production
ENV PROTO_DIR=/app/proto

COPY services/customer-service/package.json services/customer-service/package-lock.json ./
RUN npm ci --omit=dev

COPY proto /app/proto
COPY services/customer-service/src ./src
COPY services/customer-service/scripts ./scripts
COPY services/customer-service/migrations ./migrations
COPY services/customer-service/tests ./tests

USER node

EXPOSE 50052

CMD ["sh", "-c", "node scripts/migrate.cjs && exec node src/interfaces/grpc/server.js"]