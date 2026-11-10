/**
 * Загрузка моделей с прогрессом + постоянный кэш в IndexedDB.
 *
 * Модельные файлы — публичные веса (MIT), отдаются HuggingFace-CDN с CORS.
 * Прямой fetch с поточным чтением даёт реальный прогресс; при сбое сети/CORS
 * используется same-origin релей /api/model-proxy.
 */

import { MODEL_CATALOG, type ModelDef, type ModelFileInfo, type ModelId } from "./models";

const DB_NAME = "tuxocr-models";
const DB_VERSION = 1;
const STORE = "files";

export interface FileProgress {
  kind: string;
  label: string;
  received: number;
  total: number; // 0 = неизвестен
  cached: boolean;
  done: boolean;
}

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

/** Загрузка одного файла модели с кэшированием. */
async function loadFile(
  file: ModelFileInfo,
  onProgress: (p: FileProgress) => void,
): Promise<ArrayBuffer> {
  const base = (p: Partial<FileProgress>): FileProgress => ({
    kind: file.kind,
    label: file.label,
    received: 0,
    total: file.approxBytes,
    cached: false,
    done: false,
    ...p,
  });

  const cached = await idbGet(file.url).catch(() => undefined);
  if (cached) {
    onProgress(base({ received: cached.byteLength, total: cached.byteLength, cached: true, done: true }));
    return cached;
  }

  const buf = await fetchWithProgress(file.url, (received, total) =>
    onProgress(base({ received, total: total || file.approxBytes })),
  );
  try {
    await idbPut(file.url, buf);
  } catch {
    /* нет места — работаем без кэша */
  }
  onProgress(base({ received: buf.byteLength, total: buf.byteLength, done: true }));
  return buf;
}

export interface LoadedModel {
  detection: ArrayBuffer;
  recognition: ArrayBuffer;
  dictionary: ArrayBuffer;
}

/**
 * Гарантирует наличие всех файлов модели; возвращает свежие копии буферов
 * (безопасные для transfer в worker).
 */
export async function loadModelFiles(
  model: ModelDef,
  onFileProgress: (p: FileProgress) => void,
): Promise<LoadedModel> {
  const byKind: Partial<Record<ModelFileInfo["kind"], ArrayBuffer>> = {};
  for (const file of model.files) {
    byKind[file.kind] = await loadFile(file, onFileProgress);
  }
  const detection = byKind.detection;
  const recognition = byKind.recognition;
  const dictionary = byKind.dictionary;
  if (!detection || !recognition || !dictionary) {
    throw new Error("Неполный набор файлов модели");
  }
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

export async function clearModelCache(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
