// ============================================================================
// Логика страницы: drag&drop, изображения, PDF (pdfjs-dist), прогресс, вывод.
// API распознавания спрятано в ./ocr.js, постобработка текста — в ./postprocess.js.
//
// СХЕМА КАК У shir-man.com/free-ocr: страница открывается мгновенно, ничего
// сама не грузит. Движок скачивается ТОЛЬКО по кнопке «Скачать OCR-движок».
// Файлы можно выбирать в любой момент: до готовности движка они встают в
// очередь и обрабатываются автоматически, как только он готов.
// ============================================================================

import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { initOcr, recognizeSource } from './ocr.js';
import { fixCyrillicHomoglyphs } from './postprocess.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Ресурсы pdf.js (используются только для экзотических PDF: CJK-cmaps,
// не-встроенные стандартные шрифты). Это статические данные, не ваши файлы.
const PDFJS_VERSION = '6.5.438';
const PDFJS_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/`;

// Длинная сторона растрового изображения, подаваемого в OCR. Больше — точнее
// мелкий текст, но медленнее. 2200 px — практичный оптимум для A4-документов.
const OCR_TARGET_SIDE = 2200;

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const els = {
  providerBadge: $('providerBadge'),
  providerLabel: $('providerLabel'),
  modelStatus: $('modelStatus'),
  modelBar: $('modelBar'),
  downloadBtn: $('downloadBtn'),
  gpuNotice: $('gpuNotice'),
  dzHint: document.querySelector('.dz-hint'),
  dropZone: $('dropZone'),
  fileInput: $('fileInput'),
  progressCard: $('progressCard'),
  fileStatus: $('fileStatus'),
  fileBar: $('fileBar'),
  errorCard: $('errorCard'),
  resultCard: $('resultCard'),
  resultMeta: $('resultMeta'),
  result: $('result'),
  copyBtn: $('copyBtn'),
  clearBtn: $('clearBtn'),
};

let modelReady = false;
let busy = false;
let initStarted = false; // движок запускаем один раз: кнопкой или выбором файла
const queuedFiles = []; // файлы, выбранные до готовности модели

// Готовый текст накапливается по файлам; <pre> всегда заполняется через
// textContent — никакого HTML-инъекции из содержимого документов.
const chunks = [];
const metas = [];

// ---------------------------------------------------------------------------
// Вспомогательные функции UI
// ---------------------------------------------------------------------------
function showFatalError(message) {
  els.errorCard.hidden = false;
  els.errorCard.innerHTML = '';
  const p = document.createElement('p');
  p.textContent = message;
  els.errorCard.append(p);
}

function showFileError(message) {
  els.errorCard.hidden = false;
  const p = document.createElement('p');
  p.textContent = message;
  els.errorCard.append(p);
}

function mb(bytes) {
  return (bytes / 1_048_576).toFixed(1);
}

function setBar(el, ratio /* 0..1 или null = неопределённый */) {
  if (ratio == null) {
    el.parentElement.classList.add('indeterminate');
    el.style.width = '';
  } else {
    el.parentElement.classList.remove('indeterminate');
    el.style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
  }
}

function setBusy(state) {
  busy = state;
  els.dropZone.classList.toggle('disabled', state);
  els.progressCard.hidden = !state;
  if (!state && queuedFiles.length === 0) {
    els.fileStatus.textContent = '';
    setBar(els.fileBar, 0);
  }
}

function renderResult() {
  els.result.textContent = chunks.join('\n\n');
  els.resultCard.hidden = chunks.length === 0;
  els.copyBtn.disabled = chunks.length === 0;
  els.resultMeta.textContent = metas.join(' · ');
}

function providerBadge(text, ok) {
  els.providerBadge.hidden = false;
  els.providerBadge.classList.toggle('ok', Boolean(ok));
  els.providerLabel.textContent = text;
}

// ---------------------------------------------------------------------------
// Движок скачивается ТОЛЬКО по кнопке (как «Download OCR Engine» у
// shir-man.com/free-ocr): до клика страница ничего не качает — виснуть нечему.
// ---------------------------------------------------------------------------
function handleModelStage(s) {
  if (s.stage === 'probe') {
    els.modelStatus.textContent = 'Проверяем поддержку WebGPU…';
  } else if (s.stage === 'download') {
    // Честный прогресс: сколько байт пришло и из какого источника.
    els.modelBar.hidden = false;
    const head = `Скачиваем движок (${s.fileIndex + 1}/${s.fileCount} — ${s.label})`;
    if (s.cached) {
      els.modelStatus.textContent = `${head}: уже в кеше браузера.`;
      setBar(els.modelBar, (s.fileIndex + 1) / s.fileCount);
    } else if (s.total > 0) {
      els.modelStatus.textContent = `${head}: ${mb(s.received)} из ${mb(s.total)} МБ · источник: ${s.source}`;
      setBar(els.modelBar, (s.fileIndex + s.received / s.total) / s.fileCount);
    } else {
      els.modelStatus.textContent = `${head}: ${mb(s.received)} МБ · источник: ${s.source}`;
      setBar(els.modelBar, null);
    }
  } else if (s.stage === 'init') {
    els.modelStatus.textContent =
      'Создаём сессию распознавания (на WebGPU может занять несколько секунд)…';
    setBar(els.modelBar, null);
  }
}

function startInit() {
  initStarted = true;
  els.downloadBtn.hidden = true;
  els.errorCard.hidden = true;
  els.errorCard.innerHTML = '';
  els.modelBar.hidden = false;
  els.modelStatus.textContent = 'Проверяем поддержку WebGPU…';
  setBar(els.modelBar, null);

  initOcr({ onStage: handleModelStage, onFallback: showFallbackNotice })
    .then(({ provider, webgpuSupported }) => {
      modelReady = true;
      els.modelBar.hidden = true;
      els.modelStatus.textContent =
        provider === 'webgpu'
          ? 'Движок готов. Ускорение: WebGPU.'
          : 'Движок готов. Режим: WASM.';
      providerBadge(provider === 'webgpu' ? 'WebGPU активен' : 'Работает через WASM', true);
      els.dzHint.textContent = 'PNG, JPG, WEBP или PDF. Ничего не загружается на сервер.';

      // Понятное сообщение, если WebGPU не поддерживается, — приложение
      // всё равно полноценно работает через WASM (требование №12).
      if (!webgpuSupported) {
        els.gpuNotice.hidden = false;
        els.gpuNotice.textContent =
          'Браузер не поддерживает WebGPU — работаем через WASM: медленнее, но тот же результат. ' +
          'WebGPU есть в актуальных версиях Chrome, Edge, Firefox и Safari.';
      }

      // Обрабатываем файлы, выбранные, пока движок загружался.
      const queued = queuedFiles.splice(0);
      if (queued.length > 0) handleFiles(queued);
    })
    .catch((error) => {
      console.error('OCR init failed:', error);
      els.modelBar.hidden = true;
      els.modelStatus.textContent =
        'Движок загрузить не удалось — смотрите причину ниже.';
      // Та же кнопка становится «Повторить».
      els.downloadBtn.hidden = false;
      els.downloadBtn.textContent = 'Повторить загрузку движка';
      showFatalError(
        'Не удалось загрузить OCR-движок. Причина последней попытки: ' +
          (error?.message || 'неизвестная ошибка') +
          '. Обычно движок берётся из файлов проекта (папка models рядом со страницей) и сеть не нужна — ' +
          'проверьте, что папка models залита на хостинг вместе со страницей и что страница открыта ' +
          'по адресу http(s), а не как file://. Внешние источники (huggingface.co) нужны только как ' +
          'запасные и могут быть заблокированы в вашей сети. Уже выбранные файлы останутся в очереди.',
      );
    });
}

els.downloadBtn.addEventListener('click', startInit);

function showFallbackNotice() {
  els.gpuNotice.hidden = false;
  els.gpuNotice.textContent =
    'WebGPU-сессию создать не удалось (драйвер или GPU заняты/запрещены) — переключились на WASM. Скорость ниже, качество то же.';
}

// ---------------------------------------------------------------------------
// Ввод файлов: drag&drop + input[type=file]. Окно выбора открывается ВСЕГДА,
// пока идёт обработка; файлы, выбранные до готовности модели, встают в очередь.
// ---------------------------------------------------------------------------
function preventWindowNav(event) {
  event.preventDefault();
}

window.addEventListener('dragover', preventWindowNav);
window.addEventListener('drop', preventWindowNav);

function openPicker() {
  if (busy) return;
  els.fileInput.click();
}

els.dropZone.addEventListener('click', openPicker);
els.dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openPicker();
  }
});
els.dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  els.dropZone.classList.add('dragover');
});
els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('dragover'));
els.dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  els.dropZone.classList.remove('dragover');
  handleFiles(e.dataTransfer?.files);
});
els.fileInput.addEventListener('change', () => {
  handleFiles(els.fileInput.files);
  els.fileInput.value = ''; // можно выбрать тот же файл повторно
});

function isPdf(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function queueFiles(files) {
  queuedFiles.push(...files);
  els.progressCard.hidden = false;
  const names = files.map((f) => f.name).join(', ');
  els.fileStatus.textContent = `В очереди: ${queuedFiles.length} (${names}) — обработаем, как только движок загрузится.`;
  setBar(els.fileBar, 0);
}

async function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  const files = Array.from(fileList);
  if (busy) return;

  if (!modelReady) {
    queueFiles(files);
    // Если движок ещё не запускали — сразу качаем его, не дожидаясь клика:
    // пользователь уже выразил намерение работать.
    if (!initStarted) startInit();
    return;
  }

  setBusy(true);
  for (const file of files) {
    try {
      if (isPdf(file)) await processPdf(file);
      else if (file.type.startsWith('image/')) await processImage(file);
      else showFileError(`«${file.name}»: неподдерживаемый тип файла (нужны PNG, JPG, WEBP или PDF).`);
    } catch (error) {
      console.error('Processing failed:', file.name, error);
      const hint =
        error?.name === 'PasswordException'
          ? 'PDF защищён паролем — снимите защиту и попробуйте снова.'
          : error?.message || 'Неизвестная ошибка обработки.';
      showFileError(`«${file.name}»: ${hint}`);
    }
  }
  setBusy(false);
}

// ---------------------------------------------------------------------------
// Изображения: PNG / JPG / WEBP → canvas → OCR
// ---------------------------------------------------------------------------
async function processImage(file) {
  els.fileStatus.textContent = `Распознавание: ${file.name}…`;
  setBar(els.fileBar, null);

  // from-image — уважаем EXIF-поворот телефонных снимков.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const canvas = bitmapToCanvas(bitmap);
  bitmap.close();

  const started = performance.now();
  const { text, confidence } = await recognizeSource(canvas);
  const seconds = (performance.now() - started) / 1000;

  pushResult(file.name, text, confidence, seconds);
}

/** Рисуем битмап на canvas с белой подложкой (прозрачность ломает OCR). */
function bitmapToCanvas(bitmap) {
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, OCR_TARGET_SIDE / longest);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// ---------------------------------------------------------------------------
// PDF: постранично pdf.js → canvas → OCR (требование №7)
// ---------------------------------------------------------------------------
async function processPdf(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  // destroy() есть у loading task, а не у PDFDocumentProxy (pdfjs-dist v6).
  const task = pdfjsLib.getDocument({
    data,
    cMapUrl: `${PDFJS_CDN}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_CDN}standard_fonts/`,
  });
  const pdf = await task.promise;

  const multiPage = pdf.numPages > 1;
  const started = performance.now();

  for (let n = 1; n <= pdf.numPages; n++) {
    els.fileStatus.textContent = `Страница ${n} из ${pdf.numPages}: рендер…`;
    setBar(els.fileBar, (n - 1) / pdf.numPages);

    const page = await pdf.getPage(n);
    const canvas = await renderPageToCanvas(page);
    const { text, confidence } = await recognizeSource(canvas);

    const body = multiPage ? `— Страница ${n} —\n${text}` : text;
    chunks.push(fixCyrillicHomoglyphs(body));

    const seconds = (performance.now() - started) / 1000;
    metas.push(
      `${file.name}, стр. ${n} — ${seconds.toFixed(1)} с, точность ${Math.round(confidence * 100)}%`,
    );
    renderResult();

    page.cleanup();
  }

  await task.destroy();
}

async function renderPageToCanvas(page) {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, OCR_TARGET_SIDE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

// ---------------------------------------------------------------------------
// Вывод результата
// ---------------------------------------------------------------------------
function pushResult(fileName, rawText, confidence, seconds) {
  const text = fixCyrillicHomoglyphs(rawText);
  chunks.push(text);
  metas.push(
    `${fileName} — ${seconds.toFixed(1)} с, точность ${Math.round(confidence * 100)}%`,
  );
  renderResult();
}

els.copyBtn.addEventListener('click', async () => {
  const text = chunks.join('\n\n');
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Фолбэк для контекстов без Clipboard API (например, обычный http).
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const original = els.copyBtn.textContent;
  els.copyBtn.textContent = 'Скопировано';
  els.copyBtn.disabled = true;
  setTimeout(() => {
    els.copyBtn.textContent = original;
    els.copyBtn.disabled = false;
  }, 1500);
});

els.clearBtn.addEventListener('click', () => {
  chunks.length = 0;
  metas.length = 0;
  els.errorCard.hidden = true;
  els.errorCard.innerHTML = '';
  renderResult();
});
