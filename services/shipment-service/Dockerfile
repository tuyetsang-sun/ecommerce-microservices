FROM node:24-alpine

WORKDIR /app/services/shipment-service

ENV NODE_ENV=production
ENV PROTO_DIR=/app/proto

COPY services/shipment-service/package.json services/shipment-service/package-lock.json ./
RUN npm ci --omit=dev

COPY proto /app/proto
COPY services/shipment-service/src ./src
COPY services/shipment-service/scripts ./scripts

USER node

EXPOSE 50055

CMD ["node", "src/interfaces/grpc/server.js"]