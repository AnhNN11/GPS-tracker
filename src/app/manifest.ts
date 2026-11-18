import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Campus Guard",
    short_name: "Campus Guard",
    description: "Quản lý vị trí và cảnh báo khuôn viên trường",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f7f6",
    theme_color: "#167d68",
    lang: "vi",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
