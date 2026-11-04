## Tiến độ

- Đã tạo cấu trúc dự án theo 5 bounded context.
- Đã cấu hình Docker Compose cho 3 PostgreSQL, 2 MongoDB, Redis và Kafka.
- Đã kiểm tra health check và kết nối database.
- Đã kiểm tra Redis trả về PONG.
- Đã tạo topic order-created và infra-check.
- Đã kiểm tra gửi và nhận tin nhắn Kafka qua CLI.

Chưa triển khai các API nghiệp vụ.

## Khởi động hạ tầng

Mở Docker Desktop rồi chạy tại thư mục gốc của dự án:

docker compose up -d --wait --wait-timeout 240

Kiểm tra container:

docker compose ps -a
### Current authenticated identity

GET /api/auth/me

Required header: Authorization: Bearer <accessToken>

- 200: returns uid, username and role.
- 401: missing, invalid or expired token.
- 503/504: authentication service unavailable or timed out.

The gateway validates access through AuthService.VerifyToken.
Role-based permissions use the requireRoles middleware.
### Redis rate limiting

The Gateway uses Redis counters for authentication endpoints:

- POST /api/auth/register: 20 requests per IP per 60 seconds.
- POST /api/auth/login: 30 requests per IP per 60 seconds.
- Both successful and failed requests count toward the limit.
- Exceeding the limit returns HTTP 429 with Retry-After.
- Redis failure returns HTTP 503 for these endpoints.
- GET /health checks Auth Service and Redis.
- GET /health/live checks Gateway liveness.

Counters use an atomic Lua script and expire automatically.
The local setup uses trust proxy = false.

Verification:
docker compose exec -T api-gateway node scripts/check-rate-limit.cjs
### Customer Service foundation

Customer Service uses its own PostgreSQL database.

Tables:
- memberships: mid, mname, score.
- customers: uid, fullname, mid, created_at.

Rules:
- Customer uid comes from Auth Service and is not generated locally.
- There is no cross-service database foreign key.
- Customer mid references memberships in the same database.
- Default membership: normal, score 10.
- Membership score must be nonnegative.
- Membership names are unique without case sensitivity.

The service applies checksum-verified migrations before starting.
Its internal gRPC health check verifies database connectivity and schema.

Verification:
docker compose exec -T customer-service node scripts/healthcheck.cjs