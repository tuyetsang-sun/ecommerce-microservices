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