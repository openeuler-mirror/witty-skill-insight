import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Skill-insight",
  description: "AI 辅助编码与运维效能监测",
};

import { Providers } from "@/components/providers";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
