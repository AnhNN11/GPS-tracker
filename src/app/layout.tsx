import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import "./globals.css";
export const metadata: Metadata = {
  title: "Campus Guard · Quản lý khuôn viên",
  description: "Quản lý vị trí và ranh giới khuôn viên trường",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body>
        <AntdRegistry>{children}</AntdRegistry>
      </body>
    </html>
  );
}
