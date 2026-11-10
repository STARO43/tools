import type { NextConfig } from "next";

/**
 * Два режима сборки:
 *  - по умолчанию: standalone Node-сервер (`bun run start`) — для VPS/песочницы;
 *  - NEXT_OUTPUT=export: статический экспорт в out/ — для GitHub Pages.
 *    В этом режиме задаются:
 *      NEXT_PUBLIC_BASE_PATH=/имя-репозитория  (сайт живёт по подпути github.io/имя-репо)
 *      NEXT_PUBLIC_STATIC=1                    (same-origin релея /api не существует)
 */
const isExport = process.env.NEXT_OUTPUT === "export";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: isExport ? "export" : "standalone",
  ...(basePath ? { basePath } : {}),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
