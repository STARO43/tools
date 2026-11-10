import { defineConfig } from 'vite';

// Cross-origin isolation нужна onnxruntime-web и OpenCV-wasm для SharedArrayBuffer
// (многопоточный WASM работает заметно быстрее однопоточного).
// Заголовки ниже действуют для `vite dev` и `vite preview`.
// Для продакшена их должен отдавать хостинг (см. чеклист: _headers / vercel.json / nginx).
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  server: {
    headers: isolationHeaders,
  },
  preview: {
    headers: isolationHeaders,
  },
  build: {
    target: 'es2022',
  },
  // Если в dev-режиме onnxruntime-web жалуется на повторную загрузку wasm-бинарников
  // (ошибка вида "attempted to instantiate more than one ort-wasm"), раскомментируйте:
  // optimizeDeps: { exclude: ['onnxruntime-web'] },
});
