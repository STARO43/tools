import type { Metadata, Viewport } from "next";
import { Unbounded, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/* Два семейства, оба вариативные → минимум файлов.
   Unbounded — дисплейный гротеск (кириллица), JetBrains Mono — технический моно. */
const unbounded = Unbounded({
  subsets: ["latin", "cyrillic"],
  variable: "--font-display",
  display: "swap",
});

const jbMono = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Сканериньо",
  description:
    "Распознавание текста. Работает локально: ничего никуда не загружается. Русский и ещё 50+ языков.",
  keywords: ["OCR", "распознавание текста", "текст с фото", "скриншот в текст", "онлайн", "бесплатно", "распознать PDF"],
};

export const viewport: Viewport = {
  themeColor: "#f4f4f2",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning className={`${unbounded.variable} ${jbMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
