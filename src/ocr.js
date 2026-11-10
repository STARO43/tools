// ============================================================================
// Обёртка над ppu-paddle-ocr. ЕДИНСТВЕННЫЙ файл проекта, знающий API библиотеки.
//
// API сверен с типами ppu-paddle-ocr@6.6.1 (.d.ts пакета):
//   - браузерный вход: субпуть "ppu-paddle-ocr/web" (корень — Node-сборка);
//   - new PaddleOcrService({ model, session, processing, debugging });
//   - model принимает и пресет, и готовые буферы: { detection, recognition,
//     charactersDictionary }: ArrayBuffer | string — мы скачиваем сами,
//     чтобы показывать реальный прогресс и не зависеть от внешних CDN;
//   - await service.recognize(ArrayBuffer | CanvasLike) →
//       { text: string, lines, confidence }.
//
// МЕСТА, ЧУВСТВИТЕЛЬНЫЕ К ВЕРСИИ (проверять при обновлении пакета):
//   [1] имя пресета: V5_CYRILLIC_MOBILE_MODEL;
//   [2] session.executionProviders + session.onSessionFallback;
//   [3] формат результата recognize(): поле .text (строки разделены \n);
//   [4] ImageBitmap в типах НЕТ — передаём canvas или ArrayBuffer.
// ============================================================================

// WASM-бинарники ORT берём из локального бандла (?url у Vite), а НЕ с
// cdn.jsdelivr.net, куда по умолчанию их направляет ppu-paddle-ocr: в ряде
// сетей (в частности, в РФ) jsdelivr недоступен — был 404 и WASM падал.
// Импорт делаем динамическим (page грузится быстрее), но СТРОГО до
// import('ppu-paddle-ocr/web'): библиотека перезаписывает wasmPaths,
// только если он ещё не задан ("explicit wins").
let ortWasmReady = null;

function ensureOrtWasmPaths() {
  if (ortWasmReady) return ortWasmReady;
  ortWasmReady = (async () => {
    const [{ env }, wasmMod, mjsMod] = await Promise.all([
      import('onnxruntime-web'),
      import('onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url'),
      import('onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url'),
    ]);
    env.wasm.wasmPaths = { wasm: wasmMod.default, mjs: mjsMod.default };
  })();
  return ortWasmReady;
}

const MODEL_CACHE = 'paddle-ocr-site-models-v1';
const FILE_TIMEOUT_MS = 45_000; // сколько ждём ответ/очередной кусок потока
const HF_ORIGIN = 'https://huggingface.co';

// Файлы моделей: первый источник — файлы, положенные в public/models/
// (работает офлайн и в сетях, где внешние CDN заблокированы). Остальные —
// запасные внешние источники на случай, если локальные файлы удалили.
const MODEL_FILES = [
  {
    label: 'детекция',
    urls: [
      '/models/PP-OCRv5_mobile_det_infer.onnx',
      `${HF_ORIGIN}/snowfluke/ppu-paddle-ocr-models/resolve/main/detection/PP-OCRv5_mobile_det_infer.onnx`,
      'https://hf-mirror.com/snowfluke/ppu-paddle-ocr-models/resolve/main/detection/PP-OCRv5_mobile_det_infer.onnx',
    ],
  },
  {
    label: 'распознавание',
    urls: [
      '/models/cyrillic_PP-OCRv5_mobile_rec_infer.onnx',
      `${HF_ORIGIN}/snowfluke/ppu-paddle-ocr-models/resolve/main/recognition/multi/cyrillic/v5/cyrillic_PP-OCRv5_mobile_rec_infer.onnx`,
      'https://hf-mirror.com/snowfluke/ppu-paddle-ocr-models/resolve/main/recognition/multi/cyrillic/v5/cyrillic_PP-OCRv5_mobile_rec_infer.onnx',
    ],
  },
  {
    label: 'словарь',
    urls: [
      '/models/ppocrv5_cyrillic_dict.txt',
      `${HF_ORIGIN}/snowfluke/ppu-paddle-ocr-models/resolve/main/recognition/multi/cyrillic/v5/ppocrv5_cyrillic_dict.txt`,
      'https://hf-mirror.com/snowfluke/ppu-paddle-ocr-models/resolve/main/recognition/multi/cyrillic/v5/ppocrv5_cyrillic_dict.txt',
    ],
  },
];

let service = null;
let initPromise = null;
let activeProvider = null; // 'webgpu' | 'wasm'
let webgpuSupported = false;

/** Готова ли модель к распознаванию. */
export function isReady() {
  return Boolean(service);
}

/** Активный бэкенд: 'webgpu' | 'wasm' | null (ещё грузится). */
export function getProvider() {
  return activeProvider;
}

function concatChunks(parts, length) {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out.buffer;
}

function sourceName(url) {
  if (url.startsWith('/')) return 'файлы проекта';
  if (url.startsWith('https://hf-mirror.com')) return 'hf-mirror.com';
  if (url.startsWith(HF_ORIGIN)) return 'huggingface.co';
  return url;
}

/**
 * Скачивает файл с первого рабочего источника, с прогрессом и таймаутами.
 * Внешние источники кешируются в Cache API (повторный запуск — без сети).
 *
 * @param {string[]} urls — источники по приоритету (первый — локальный).
 * @param {(p: {received: number, total: number, cached?: boolean, source: string}) => void} onProgress
 * @returns {Promise<ArrayBuffer>}
 */
async function fetchModelFile(urls, onProgress) {
  let cache = null;
  try {
    if (typeof caches !== 'undefined') cache = await caches.open(MODEL_CACHE);
  } catch {
    // Нет Cache API (небезопасный контекст) — обходимся без него.
  }

  let lastError = null;
  for (const url of urls) {
    // 1) Кеш для внешних источников: уже скачивали — из сети не ходим.
    if (cache && !url.startsWith('/')) {
      try {
        const hit = await cache.match(url);
        if (hit) {
          const buffer = await hit.arrayBuffer();
          onProgress({ received: buffer.byteLength, total: buffer.byteLength, cached: true, source: sourceName(url) });
          return buffer;
        }
      } catch {
        // игнорируем — пойдём в сеть
      }
    }

    // 2) Сеть/локальный файл.
    try {
      const controller = new AbortController();
      const resp = await fetch(url, { signal: controller.signal, mode: 'cors', redirect: 'follow' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const total = Number(resp.headers.get('content-length') || 0);
      const reader = resp.body.getReader();
      const parts = [];
      let received = 0;
      for (;;) {
        // Таймаут на «поток завис»: блокировки часто подвешивают ответ.
        const timer = setTimeout(() => controller.abort(), FILE_TIMEOUT_MS);
        let chunk;
        try {
          chunk = await reader.read();
        } finally {
          clearTimeout(timer);
        }
        if (chunk.done) break;
        parts.push(chunk.value);
        received += chunk.value.length;
        onProgress({ received, total, cached: false, source: sourceName(url) });
      }

      const buffer = concatChunks(parts, received);
      // Кешируем только внешние источники (локальные и так мгновенны).
      if (cache && !url.startsWith('/')) {
        try {
          await cache.put(
            new Request(url),
            new Response(buffer.slice(0), {
              headers: {
                'content-length': String(received),
                'content-type': resp.headers.get('content-type') || 'application/octet-stream',
              },
            }),
          );
        } catch {
          // Квота/приватный режим — не критично.
        }
      }
      return buffer;
    } catch (error) {
      const reason = error?.name === 'AbortError' ? 'нет ответа (таймаут)' : error?.message;
      lastError = new Error(`${url} — ${reason}`);
    }
  }
  throw lastError;
}

/**
 * Инициализация OCR-движка: выбор бэкенда, загрузка моделей, создание сессий.
 *
 * @param {object} [hooks]
 * @param {(s: object) => void} [hooks.onStage] — события для UI:
 *   { stage: 'probe' }
 *   { stage: 'download', fileIndex, fileCount, label, received, total, cached, source }
 *   { stage: 'init' }
 *   { stage: 'ready' }
 * @param {(error: unknown) => void} [hooks.onFallback] — WebGPU-сессия не создалась,
 *   библиотека молча пересоздала её на WASM.
 * @returns {Promise<{provider: 'webgpu'|'wasm', webgpuSupported: boolean}>}
 */
export function initOcr({ onStage = () => {}, onFallback = () => {} } = {}) {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
      throw new Error(
        'страница открыта как file:// — ES-модули и модель так не работают; запустите «npm run dev» или «npm run preview» и откройте http://localhost:…',
      );
    }

    onStage({ stage: 'probe' });
    // Сначала указываем ORT локальные wasm-файлы, только потом грузим SDK —
    // иначе библиотека перенаправит бинарники на внешний CDN.
    await ensureOrtWasmPaths();
    const {
      PaddleOcrService,
      V5_CYRILLIC_MOBILE_MODEL, // [1] — имя пресета сверяем при обновлении пакета
      isWebGpuAvailable,
      getDefaultWebExecutionProviders,
    } = await import('ppu-paddle-ocr/web');

    webgpuSupported = await isWebGpuAvailable();
    // [2] Порядок в массиве = приоритет; фолбэк WebGPU→WASM внутри библиотеки.
    const executionProviders = await getDefaultWebExecutionProviders();
    activeProvider = webgpuSupported ? 'webgpu' : 'wasm';

    // Загружаем 3 файла модели: с прогрессом, из локальных файлов или кеша.
    const buffers = [];
    for (let i = 0; i < MODEL_FILES.length; i++) {
      const file = MODEL_FILES[i];
      onStage({
        stage: 'download',
        fileIndex: i,
        fileCount: MODEL_FILES.length,
        label: file.label,
        received: 0,
        total: 0,
        source: sourceName(file.urls[0]),
      });
      const buffer = await fetchModelFile(file.urls, (p) =>
        onStage({
          stage: 'download',
          fileIndex: i,
          fileCount: MODEL_FILES.length,
          label: file.label,
          ...p,
        }),
      );
      buffers.push(buffer);
    }

    onStage({ stage: 'init' });
    let fallbackReported = false;
    service = new PaddleOcrService({
      model: {
        detection: buffers[0],
        recognition: buffers[1],
        charactersDictionary: buffers[2],
      },
      session: {
        executionProviders,
        onSessionFallback: (error) => {
          activeProvider = 'wasm';
          if (!fallbackReported) {
            fallbackReported = true;
            onFallback(error);
          }
        },
      },
      // "opencv" (по умолчанию) — рекомендуемая предобработка; WASM OpenCV
      // уже в бандле, внешних запросов не делает.
      processing: { engine: 'opencv' },
      debugging: { debug: false, verbose: false },
    });
    await service.initialize();

    onStage({ stage: 'ready' });
    return { provider: activeProvider, webgpuSupported };
  })();

  initPromise.catch(() => {
    service = null;
    initPromise = null;
  });

  return initPromise;
}

/**
 * Распознавание одного изображения.
 * @param {HTMLCanvasElement|OffscreenCanvas|ArrayBuffer} source
 * @returns {Promise<{text: string, confidence: number}>}
 */
export async function recognizeSource(source) {
  if (!service) throw new Error('OCR-модель ещё не инициализирована');

  // [3] По умолчанию возвращается { text, lines, confidence }, text — со \n.
  const result = await service.recognize(source);
  const text = typeof result?.text === 'string' ? result.text : '';
  return { text, confidence: Number(result?.confidence ?? 0) };
}

/** Сбросить кеш внешних моделей (например, если файлы побились). */
export async function clearModelCache() {
  try {
    if (typeof caches !== 'undefined') await caches.delete(MODEL_CACHE);
  } catch {
    // игнорируем
  }
}

/** Освободить ONNX-сессии. */
export async function destroyOcr() {
  if (service) {
    await service.destroy();
    service = null;
    initPromise = null;
  }
}
