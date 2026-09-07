import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lububble App",
  description: "Built with Lububble",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
