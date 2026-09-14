import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "人味圆桌局",
  description: "在知乎问题里，分辨谁是人，谁在模仿人。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><head><link rel="stylesheet" href="https://db.onlinewebfonts.com/c/5ac3fe7c6abd2f62067f266d89671492?family=HelveticaNowDisplay-Medium" /><link rel="stylesheet" href="https://db.onlinewebfonts.com/c/1aa3377e489837a26d019bba501e779d?family=HelveticaNowDisplayW01-Rg" /></head><body>{children}</body></html>;
}
