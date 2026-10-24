import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chat Talker",
  description:
    "Find a friendly conversation, make a connection, and chat at your own pace.",
  applicationName: "Chat Talker",
  icons: {
    icon: "/ct-app-logo.png",
    apple: "/ct-app-logo.png",
  },
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
