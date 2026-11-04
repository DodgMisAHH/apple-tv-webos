# apple-tv-webos

Màn hình chính và Control Centre lấy cảm hứng từ Apple TV dành cho TV LG webOS, với thanh ứng dụng yêu thích, lưới ứng dụng, hình nền và điều khiển bằng remote.

Đây là bản tùy biến độc lập từ [LG TV Vibehack](https://github.com/hoangvya19/lg-tv-webos-vibehack), không phải sản phẩm chính thức của Apple hoặc LG. ID ứng dụng vẫn là `com.gathin.tvhome` để giữ khả năng sử dụng lại cài đặt hiện có.

Tài liệu tiếng Anh là bản hướng dẫn được duy trì:

- [Tổng quan, tính năng và bản xem thử](README.md)
- [Cài đặt từ mã nguồn và khôi phục](docs/SETUP.md)
- [Đóng góp](CONTRIBUTING.md)
- [Bảo mật](SECURITY.md)
- [Nguồn và giấy phép tài nguyên](docs/ASSET-CREDITS.md)

Xem thử trên máy tính có Node.js 22 và Python 3:

```sh
node scripts/prepare-app.cjs
python3 scripts/preview.py
```

Mở [localhost:4795](http://127.0.0.1:4795). Dùng phím mũi tên, Enter và Escape; bản xem thử không điều khiển TV.

Hãy đóng gói mã nguồn của kho này theo hướng dẫn cài đặt. Trình cài đặt và bản phát hành của dự án gốc sử dụng giao diện khác. Các tính năng thay nút Home, tự chạy khi khởi động và Control Centre nổi cần TV đã root cùng cấu hình bổ sung. Tích hợp Home gốc phụ thuộc firmware; các kết quả thử nghiệm cũ không đảm bảo tương thích với mọi TV.

Mã nguồn giữ giấy phép [MIT](LICENSE) và ghi nhận tác giả gốc. Tài nguyên bên thứ ba có điều khoản riêng trong tài liệu nguồn tài nguyên.
