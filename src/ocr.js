// ============================================================================
// Обёртка над ppu-paddle-ocr. ЕДИНСТВЕННЫЙ файл проекта, знающий API библиотеки.
//
// API сверен с типами ppu-paddle-ocr@6.6.1 (файлы .d.ts пакета), а не по памяти:
//   - браузерный вход: субпуть "ppu-paddle-ocr/web" (корневой "." — Node-сборка);
//   - класс PaddleOcrService и пресет V5_CYRILLIC_MOBILE_MODEL экспортируются из "/web";
//   - конструктор: new PaddleOcrService({ model, session, processing, debugging, ... });
//   - await service.initialize() — скачивает det/rec ONNX и словарь с CDN (HuggingFace),
//     браузер кеширует их на последующие запуски;
//   - await service.recognize(ArrayBuffer | CanvasLike) →
//       { text: string, lines: RecognitionResult[][], confidence: number }
//
// МЕСТА, ЧУВСТВИТЕЛЬНЫЕ К ВЕРСИИ (сверьте с README/типами при обновлении пакета):
//   [1] имя пресета: V5_CYRILLIC_MOBILE_MODEL;
//   [2] имя опции бэкендов: session.executionProviders (массив, порядок = приоритет);
//   [3] формат результата recognize(): поле .text (строка, строки разделены \n);
//   [4] recognize() типизирован для ArrayBuffer | CanvasLike (canvas c getContext('2d')).
//       ImageBitmap в типах НЕТ, хотя README его упоминает, — поэтому main.js
//       рисует всё в canvas и передаёт именно canvas;
//   [5] колбэка прогресса скачивания модели в v6.6.1 НЕТ — прогресс ниже
//       «неопределённый» (indeterminate). Если в новой версии появится колбэк,
//       подключайте его в initializeModel() (помечено TODO-PROGRESS).
// ============================================================================

let service = null;
let initPromise = null;
let activeProvider = null; // 'webgpu' | 'wasm' — фактический бэкенд на данный момент
let webgpuSupported = false;

/** Готова ли модель к распознаванию. */
export function isReady() {
  return Boolean(service);
}

/** Активный бэкенд: 'webgpu' | 'wasm' | null (ещё грузится). */
export function getProvider() {
  return activeProvider;
}

/**
 * Инициализация OCR-движка: выбор бэкенда, скачивание и прогрев модели.
 *
 * @param {object} [hooks]
 * @param {(s: {stage: 'probe'|'download'|'ready'}) => void} [hooks.onStage]
 *        Этапы инициализации — для UI-статуса и прогресс-бара.
 * @param {(error: unknown) => void} [hooks.onFallback]
 *        Вызывается, если сессия на WebGPU не создалась и библиотека молча
 *        пересоздала её на WASM (встроенный фолбэк ppu-paddle-ocr).
 * @returns {Promise<{provider: 'webgpu'|'wasm', webgpuSupported: boolean}>}
 */
export function initOcr({ onStage = () => {}, onFallback = () => {} } = {}) {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Динамический импорт: грузим SDK только тогда, когда он реально нужен.
    const {
      PaddleOcrService,
      V5_CYRILLIC_MOBILE_MODEL, // [1]
      isWebGpuAvailable,
      getDefaultWebExecutionProviders,
    } = await import('ppu-paddle-ocr/web');

    onStage({ stage: 'probe' });
    webgpuSupported = await isWebGpuAvailable();

    // [2] Порядок в массиве = приоритет. Библиотека сама вернёт
    // ["webgpu", "wasm"] там, где WebGPU доступен, иначе ["wasm"].
    const executionProviders = await getDefaultWebExecutionProviders();
    activeProvider = webgpuSupported ? 'webgpu' : 'wasm';

    let fallbackReported = false;
    service = new PaddleOcrService({
      // Кириллический пресет PP-OCRv5: det (mobile) + rec (cyrillic) + словарь.
      model: V5_CYRILLIC_MOBILE_MODEL,

      session: {
        executionProviders,
        // Встроенный тихий фолбэк WebGPU → WASM: сигналим в UI ровно один раз.
        onSessionFallback: (error) => {
          activeProvider = 'wasm';
          if (!fallbackReported) {
            fallbackReported = true;
            onFallback(error);
          }
        },
      },

      // engine: "opencv" (по умолчанию) — рекомендуемая предобработка.
      // Если захотите меньше вес/зависимостей ценой точности на сложной
      // геометрии текста: processing: { engine: "canvas-native" }.
      processing: { engine: 'opencv' },

      debugging: { debug: false, verbose: false },
    });

    onStage({ stage: 'download' });
    // TODO-PROGRESS: в v6.6.1 initialize() не отдаёт прогресс скачивания.
    // Если в новой версии появится колбэк — транслируйте его в onStage.
    await service.initialize();

    onStage({ stage: 'ready' });
    return { provider: activeProvider, webgpuSupported };
  })();

  // Чтобы «висящий» промис не блокировал повторные попытки после ошибки,
  // сбрасываем состояние — страница покажет сообщение и даст перезапустить.
  initPromise.catch(() => {
    service = null;
    initPromise = null;
  });

  return initPromise;
}

/**
 * Распознавание одного изображения.
 *
 * @param {HTMLCanvasElement|OffscreenCanvas|ArrayBuffer} source
 *        Canvas (с getContext('2d')) или ArrayBuffer с байтами изображения. [4]
 * @returns {Promise<{text: string, confidence: number}>}
 */
export async function recognizeSource(source) {
  if (!service) throw new Error('OCR-модель ещё не инициализирована');

  // [3] По умолчанию (flatten: false) возвращается { text, lines, confidence },
  // где text — готовый текст со строками через \n. Если в будущей версии
  // формат изменится — адаптируйте только этот доступ к полям.
  const result = await service.recognize(source);

  const text = typeof result?.text === 'string' ? result.text : '';
  return { text, confidence: Number(result?.confidence ?? 0) };
}

/** Освободить ONNX-сессии (для полноты — SPA обычно живёт вместе со страницей). */
export async function destroyOcr() {
  if (service) {
    await service.destroy();
    service = null;
    initPromise = null;
  }
}
