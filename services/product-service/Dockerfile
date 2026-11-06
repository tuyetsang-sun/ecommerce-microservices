FROM node:24-alpine

WORKDIR /app/services/product-service

ENV NODE_ENV=production
ENV PROTO_DIR=/app/proto

COPY services/product-service/package.json services/product-service/package-lock.json ./
RUN npm ci --omit=dev

COPY proto /app/proto
COPY services/product-service/src ./src
COPY services/product-service/scripts ./scripts
COPY services/product-service/tests ./tests
USER node

EXPOSE 50053

CMD ["sh", "-c", "node scripts/init-db.cjs && exec node src/interfaces/grpc/server.js"]