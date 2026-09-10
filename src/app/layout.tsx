import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "人味圆桌局",
  description: "在知乎问题里，分辨谁是人，谁在模仿人。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
