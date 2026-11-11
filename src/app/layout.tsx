import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Сканериньо",
  description:
    "Распознавание текста. Работает прямо в браузере: ничего никуда не загружается. Русский и ещё 50+ языков.",
  keywords: ["OCR", "распознавание текста", "текст с фото", "скриншот в текст", "онлайн", "бесплатно"],
  icons: { icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/favicon.svg` },
};

export const viewport: Viewport = {
  themeColor: "#eef1f8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className={`${manrope.variable}`}>{children}</body>
    </html>
  );
}
