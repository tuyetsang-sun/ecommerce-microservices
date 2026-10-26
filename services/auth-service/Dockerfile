FROM node:24-alpine

WORKDIR /app/services/auth-service

ENV NODE_ENV=production
ENV PROTO_DIR=/app/proto

COPY services/auth-service/package.json services/auth-service/package-lock.json ./

RUN npm ci --omit=dev

COPY proto /app/proto
COPY services/auth-service/src ./src
COPY services/auth-service/scripts ./scripts

USER node

EXPOSE 50051

CMD ["node", "src/interfaces/grpc/server.js"]