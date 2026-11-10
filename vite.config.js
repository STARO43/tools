import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Cross-origin isolation нужна onnxruntime-web и OpenCV-wasm для SharedArrayBuffer
// (многопоточный WASM работает заметно быстрее однопоточного).
// Заголовки ниже действуют для `vite dev` и `vite preview`.
// Для продакшена их должен отдавать хостинг (см. чеклист: _headers / vercel.json / nginx).
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// onnxruntime-web не экспортирует свои .wasm/.mjs файлы в поле "exports",
// поэтому прямой импорт 'onnxruntime-web/dist/*.wasm?url' в dev-режиме падает.
// Плагин ведёт такой импорт к реальному файлу в node_modules (query ?url
// сохраняется): src/ocr.js благодаря этому раздаёт WASM-бинарники ORT из
// локального бандла, а не с cdn.jsdelivr.net (jsdelivr недоступен в части
// сетей — получался 404 и «модель не качается»).
const ortDist = fileURLToPath(
  new URL('./node_modules/onnxruntime-web/dist/', import.meta.url),
);

const ortWasmLocal = {
  name: 'ort-wasm-local',
  enforce: 'pre',
  resolveId(source) {
    const match = source.match(
      /^onnxruntime-web\/dist\/(ort-wasm-simd-threaded\.jsep\.(?:wasm|mjs))(\?.*)?$/,
    );
    if (match) return `${ortDist}${match[1]}${match[2] ?? ''}`;
    return null;
  },
};

export default defineConfig({
  // Относительные пути к ассетам (./assets/…): сайт работает и в корне
  // домена, и в подпапке хостинга (как shir-man.com/free-ocr/), и при
  // локальном открытии папки через любой статический сервер.
  base: './',
  server: {
    headers: isolationHeaders,
  },
  preview: {
    headers: isolationHeaders,
  },
  plugins: [ortWasmLocal],
  build: {
    target: 'es2022',
  },
  // Если в dev-режиме onnxruntime-web жалуется на повторную загрузку wasm-бинарников
  // (ошибка вида "attempted to instantiate more than one ort-wasm"), раскомментируйте:
  // optimizeDeps: { exclude: ['onnxruntime-web'] },
});
