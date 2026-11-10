import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jbMono = JetBrains_Mono({
  variable: "--font-jbmono",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TuxOCR — бесплатное распознавание текста в браузере",
  description:
    "Бесплатный OCR в стиле Linux-терминала: русский и 40+ языков через PP-OCRv5 (ppu-paddle-ocr), WebGPU с фолбэком WASM. Изображения не покидают ваш браузер.",
  keywords: ["OCR", "распознавание текста", "PaddleOCR", "PP-OCRv5", "WebGPU", "браузер", "русский"],
  icons: { icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/favicon.svg` },
};

export const viewport: Viewport = {
  themeColor: "#040906",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className={`${jbMono.variable} antialiased crt-breathe`}>{children}</body>
    </html>
  );
}
