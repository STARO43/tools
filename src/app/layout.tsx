import type { Metadata, Viewport } from "next";
import { Unbounded, JetBrains_Mono } from "next/font/google";
import "./globals.css";


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

const UNSUPPORTED_CHECK = `
(function () {
  var ok = false;
  try {
    ok =
      typeof Promise !== "undefined" &&
      typeof Worker !== "undefined" &&
      typeof WebAssembly === "object" &&
      typeof createImageBitmap === "function" &&
      WebAssembly.validate(
        new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11])
      );
  } catch (e) { ok = false; }
  if (ok) return;
  var css =
    "body>*:not(.unsup){display:none!important}" +
    ".unsup{position:fixed;left:0;top:0;right:0;bottom:0;display:-webkit-flex;display:flex;" +
    "-webkit-align-items:center;align-items:center;-webkit-justify-content:center;justify-content:center;" +
    "padding:24px;background:#f4f4f2;color:#121214;z-index:99999;" +
    "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}" +
    ".unsup__card{max-width:480px;width:100%;box-sizing:border-box;padding:36px 32px;" +
    "border:1px solid rgba(18,18,20,.16);border-radius:20px;background:#ececea;text-align:center}" +
    ".unsup__logo{font-size:13px;letter-spacing:.02em;color:rgba(18,18,20,.5);margin-bottom:20px}" +
    ".unsup__title{font-size:20px;font-weight:600;margin:0 0 14px}" +
    ".unsup__text{font-size:14px;line-height:1.55;color:rgba(18,18,20,.72);margin:0 0 8px}" +
    ".unsup__text:last-child{margin-bottom:0}";
  var style = document.createElement("style");
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
  var show = function () {
    var root = document.createElement("div");
    root.className = "unsup";
    root.innerHTML =
      '<div class="unsup__card">' +
      '<div class="unsup__logo">Сканериньо</div>' +
      '<h1 class="unsup__title">Устройство не подходит</h1>' +
      '<p class="unsup__text">Ваше устройство не поддерживает распознавание текста в браузере.</p>' +
      '<p class="unsup__text">Откройте сайт с планшета/ноута/компа</p>' +
      "</div>";
    document.body.appendChild(root);
    window.__UNSUPPORTED__ = true;
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", show);
  } else {
    show();
  }
})();
`;
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning className={`${unbounded.variable} ${jbMono.variable}`}>
    <script dangerouslySetInnerHTML={{ __html: UNSUPPORTED_CHECK }} />
{children}
    </html>
  );
}
