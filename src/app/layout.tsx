import type { Metadata, Viewport } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import "./globals.css";
export const viewport: Viewport = { themeColor: "#167d68" };
export const metadata: Metadata = {
  appleWebApp: {
    capable: true,
    title: "Campus Guard",
    statusBarStyle: "default",
  },
  icons: { apple: "/apple-touch-icon.png" },
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
