/**
 * Движок TuxOCR: каталог языковых пакетов + загрузчик с кэшем в IndexedDB.
 * Один файл для главной страницы и web worker'а.
 *
 * Модели — официальные пресеты ppu-paddle-ocr 6.7.0 (PP-OCRv5/v6, MIT),
 * хостинг: HuggingFace-зеркало ppu-paddle-ocr-models.
 */

/* ────────────────────────── типы ────────────────────────── */

export type ModelId = "ru" | "en" | "multi";

export type ModelFileKind = "detection" | "recognition" | "dictionary";

export interface ModelFileInfo {
  kind: ModelFileKind;
  url: string;
  /** примерный размер в байтах (точный приходит в Content-Length) */
  approxBytes: number;
}

export interface ModelDef {
  id: ModelId;
  /** короткая подпись для переключателя языков */
  short: string;
  /** человеческое описание пакета */
  hint: string;
  files: ModelFileInfo[];
}

/** Рамка обнаруженного текста в координатах исходного изображения */
export interface OcrBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Одна распознанная область */
export interface OcrItem {
  text: string;
  box: OcrBox;
  confidence: number;
}

/** Сообщения main → worker */
export type WorkerRequest =
  | {
      type: "init";
      id: number;
      modelId: ModelId;
      detection: ArrayBuffer;
      recognition: ArrayBuffer;
      dictionary: ArrayBuffer;
    }
  | { type: "recognize"; id: number; image: ArrayBuffer };

/** Сообщения worker → main */
export type WorkerResponse =
  | { type: "ready"; id: number; modelId: ModelId; backend: "webgpu" | "wasm"; elapsedMs: number }
  | {
      type: "result";
      id: number;
      text: string;
      confidence: number;
      lines: OcrItem[][];
      elapsedMs: number;
    }
  | { type: "error"; id: number; message: string };

/* ────────────────────────── каталог пакетов ────────────────────────── */

const HF_BASE = "https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main";
const MB = 1024 * 1024;

export const MODEL_CATALOG: Record<ModelId, ModelDef> = {
  ru: {
    id: "ru",
    short: "Русский",
    hint: "русский, украинский, белорусский и другие кириллические языки",
    files: [
      {
        kind: "detection",
        url: `${HF_BASE}/detection/PP-OCRv5_mobile_det_infer.onnx`,
        approxBytes: 4.5 * MB,
      },
      {
        kind: "recognition",
        url: `${HF_BASE}/recognition/multi/cyrillic/v5/cyrillic_PP-OCRv5_mobile_rec_infer.onnx`,
        approxBytes: 7.7 * MB,
      },
      {
        kind: "dictionary",
        url: `${HF_BASE}/recognition/multi/cyrillic/v5/ppocrv5_cyrillic_dict.txt`,
        approxBytes: 0.05 * MB,
      },
    ],
  },
  en: {
    id: "en",
    short: "English",
    hint: "английский и ещё 40+ языков на латинице",
    files: [
      {
        kind: "detection",
        url: `${HF_BASE}/detection/PP-OCRv5_mobile_det_infer.ort`,
        approxBytes: 4.7 * MB,
      },
      {
        kind: "recognition",
        url: `${HF_BASE}/recognition/multi/en/v5/en_PP-OCRv5_mobile_rec_infer.ort`,
        approxBytes: 7.6 * MB,
      },
      {
        kind: "dictionary",
        url: `${HF_BASE}/recognition/multi/en/v5/ppocrv5_en_dict.txt`,
        approxBytes: 0.01 * MB,
      },
    ],
  },
  multi: {
    id: "multi",
    short: "50+ языков",
    hint: "латиница, китайский, японский, корейский, арабский и другие",
    files: [
      {
        kind: "detection",
        url: `${HF_BASE}/detection/ort/PP-OCRv6_tiny_det.ort`,
        approxBytes: 1.8 * MB,
      },
      {
        kind: "recognition",
        url: `${HF_BASE}/recognition/ort/PP-OCRv6_tiny_rec.ort`,
        approxBytes: 4.3 * MB,
      },
      {
        kind: "dictionary",
        url: `${HF_BASE}/recognition/ppocrv6_tiny_dict.txt`,
        approxBytes: 0.04 * MB,
      },
    ],
  },
};

export const MODEL_ORDER: ModelId[] = ["ru", "en", "multi"];

/* ────────────────────────── кэш в IndexedDB ────────────────────────── */

const DB_NAME = "tuxocr-models";
const DB_VERSION = 1;
const STORE = "files";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB: ошибка открытия"));
  });
}

async function idbGet(key: string): Promise<ArrayBuffer | undefined> {
  const db = await openDb();
  try {
    return await new Promise<ArrayBuffer | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as ArrayBuffer | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbPut(key: string, value: ArrayBuffer): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function hasCachedModels(id: ModelId): Promise<boolean> {
  try {
    for (const f of MODEL_CATALOG[id].files) {
      if (!(await idbGet(f.url))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Статический экспорт (GitHub Pages): same-origin релея /api не существует. */
const STATIC_EXPORT = process.env.NEXT_PUBLIC_STATIC === "1";

/** Поточная загрузка файла с прогрессом; фолбэк на same-origin прокси. */
async function fetchWithProgress(
  url: string,
  onProgress: (received: number, total: number) => void,
): Promise<ArrayBuffer> {
  let resp: Response;
  try {
    resp = await fetch(url, { mode: "cors" });
  } catch {
    if (STATIC_EXPORT) {
      throw new Error(
        `Не удалось загрузить ${url.split("/").pop()}: прямой доступ заблокирован (сеть/CORS)`,
      );
    }
    // CORS/сеть — пробуем через наш релей
    resp = await fetch(`/api/model-proxy?url=${encodeURIComponent(url)}`);
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status} для ${url.split("/").pop()}`);

  const total = Number(resp.headers.get("content-length") ?? 0);
  if (!resp.body) {
    const buf = await resp.arrayBuffer();
    onProgress(buf.byteLength, buf.byteLength);
    return buf;
  }

  const reader = resp.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value as unknown as BlobPart);
      received += value.byteLength;
      onProgress(received, total);
    }
  }
  const blob = new Blob(chunks);
  return blob.arrayBuffer();
}

export interface LoadProgress {
  received: number;
  total: number;
  /** true — весь пакет уже был в кэше, загрузка из сети не потребовалась */
  cached: boolean;
}

export interface LoadedModel {
  detection: ArrayBuffer;
  recognition: ArrayBuffer;
  dictionary: ArrayBuffer;
}

/**
 * Гарантирует наличие всех файлов пакета; сводный прогресс по всем файлам.
 * Возвращает свежие копии буферов (безопасные для transfer в worker).
 */
export async function loadModelFiles(
  model: ModelDef,
  onProgress: (p: LoadProgress) => void,
): Promise<LoadedModel> {
  const byKind: Partial<Record<ModelFileKind, ArrayBuffer>> = {};
  const totalBytes = model.files.reduce((s, f) => s + f.approxBytes, 0);
  let received = 0;
  let allCached = true;

  const bump = (n: number) => {
    received += n;
    onProgress({ received, total: totalBytes, cached: false });
  };

  for (const file of model.files) {
    const cached = await idbGet(file.url).catch(() => undefined);
    if (cached) {
      byKind[file.kind] = cached;
      bump(cached.byteLength);
      continue;
    }
    allCached = false;
    const buf = await fetchWithProgress(file.url, bump);
    try {
      await idbPut(file.url, buf);
    } catch {
      /* нет места — работаем без кэша */
    }
    byKind[file.kind] = buf;
  }

  const detection = byKind.detection;
  const recognition = byKind.recognition;
  const dictionary = byKind.dictionary;
  if (!detection || !recognition || !dictionary) {
    throw new Error("Неполный набор файлов модели");
  }
  onProgress({ received, total: totalBytes, cached: allCached });
  return { detection, recognition, dictionary };
}

/** Читает свежую копию буфера из кэша (после скачивания), готовую к transfer. */
export async function freshBuffers(id: ModelId): Promise<LoadedModel> {
  const model = MODEL_CATALOG[id];
  const [detection, recognition, dictionary] = await Promise.all([
    idbGet(model.files[0].url),
    idbGet(model.files[1].url),
    idbGet(model.files[2].url),
  ]);
  if (!detection || !recognition || !dictionary) throw new Error("Кэш моделей пуст");
  return { detection, recognition, dictionary };
}
