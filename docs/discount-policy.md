# Quy tắc giảm giá MVP

Quy tắc do dự án quy định:

| Score | Giảm giá |
| --- | --- |
| 0–99 | 0% |
| 100–499 | 5% |
| 500–999 | 10% |
| Từ 1000 | 15% |

- Score lấy từ hạng thành viên do Customer Service trả về.
- Tên hạng không quyết định tỷ lệ giảm.
- Khách không được tự gửi score hoặc tỷ lệ giảm trong body đặt hàng.
- Tính giảm giá trên tổng tiền hàng.
- Làm tròn tiền giảm đến 2 chữ số thập phân; nửa đơn vị làm tròn lên.
- Khi lưu đơn, lưu score, tỷ lệ và số tiền tại thời điểm đặt.
- Đổi hạng sau đó không tính lại các đơn đã lưu.
- Ví dụ: score 500, mua 2 sản phẩm giá 100:
  tổng 200, giảm 20, thanh toán 180.