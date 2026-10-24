import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChatTalker — meet someone unexpected",
  description:
    "Find a friendly conversation, make a connection, and chat at your own pace.",
  applicationName: "ChatTalker",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
