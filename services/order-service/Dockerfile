FROM node:24-alpine

WORKDIR /app/services/order-service

ENV NODE_ENV=production
ENV PROTO_DIR=/app/proto

COPY services/order-service/package.json services/order-service/package-lock.json ./
RUN npm ci --omit=dev

COPY proto /app/proto
COPY services/order-service/src ./src
COPY services/order-service/scripts ./scripts

USER node

EXPOSE 50054

CMD ["node", "src/interfaces/grpc/server.js"]