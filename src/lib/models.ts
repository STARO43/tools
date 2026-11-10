/**
 * Каталог моделей OCR (общий для главной страницы и web worker'а).
 * URL-пути в точности повторяют официальные пресеты ppu-paddle-ocr 6.7.0
 * (model-catalogue.js): V5_CYRILLIC_MOBILE_MODEL / V5_EN_MOBILE_MODEL / V6_TINY_MODEL.
 * Хостинг: HuggingFace-зеркало ppu-paddle-ocr-models (публичные веса, MIT).
 */

export type ModelId = "ru" | "en" | "multi";

export type ModelFileKind = "detection" | "recognition" | "dictionary";

export interface ModelFileInfo {
  kind: ModelFileKind;
  url: string;
  /** короткое имя файла для лога */
  label: string;
  /** примерный размер в байтах (для отображения; точный приходит в Content-Length) */
  approxBytes: number;
}

export interface ModelDef {
  id: ModelId;
  /** значение флага --model */
  flag: string;
  name: string;
  desc: string;
  langs: string;
  files: ModelFileInfo[];
}

const HF_BASE = "https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main";

const MB = 1024 * 1024;

export const MODEL_CATALOG: Record<ModelId, ModelDef> = {
  ru: {
    id: "ru",
    flag: "ru",
    name: "PP-OCRv5 mobile · кириллица",
    desc: "Специализированный словарь кириллицы — лучший выбор для русского языка",
    langs: "русский, украинский, белорусский, болгарский, сербский, казахский…",
    files: [
      {
        kind: "detection",
        url: `${HF_BASE}/detection/PP-OCRv5_mobile_det_infer.onnx`,
        label: "PP-OCRv5_mobile_det.onnx",
        approxBytes: 4.5 * MB,
      },
      {
        kind: "recognition",
        url: `${HF_BASE}/recognition/multi/cyrillic/v5/cyrillic_PP-OCRv5_mobile_rec_infer.onnx`,
        label: "cyrillic_PP-OCRv5_rec.onnx",
        approxBytes: 7.7 * MB,
      },
      {
        kind: "dictionary",
        url: `${HF_BASE}/recognition/multi/cyrillic/v5/ppocrv5_cyrillic_dict.txt`,
        label: "ppocrv5_cyrillic_dict.txt",
        approxBytes: 0.05 * MB,
      },
    ],
  },
  en: {
    id: "en",
    flag: "en",
    name: "PP-OCRv5 mobile · english",
    desc: "Английский и латиница; INT8-совместимый .ort-пакет",
    langs: "английский + 40+ латинских языков",
    files: [
      {
        kind: "detection",
        url: `${HF_BASE}/detection/PP-OCRv5_mobile_det_infer.ort`,
        label: "PP-OCRv5_mobile_det.ort",
        approxBytes: 4.7 * MB,
      },
      {
        kind: "recognition",
        url: `${HF_BASE}/recognition/multi/en/v5/en_PP-OCRv5_mobile_rec_infer.ort`,
        label: "en_PP-OCRv5_rec.ort",
        approxBytes: 7.6 * MB,
      },
      {
        kind: "dictionary",
        url: `${HF_BASE}/recognition/multi/en/v5/ppocrv5_en_dict.txt`,
        label: "ppocrv5_en_dict.txt",
        approxBytes: 0.01 * MB,
      },
    ],
  },
  multi: {
    id: "multi",
    flag: "multi",
    name: "PP-OCRv6 tiny · мульти",
    desc: "Самая лёгкая (~6 МБ): латиница, CJK, арабский, индийские письменности",
    langs: "50+ языков, но БЕЗ кириллицы (в словаре нет кириллических символов)",
    files: [
      {
        kind: "detection",
        url: `${HF_BASE}/detection/ort/PP-OCRv6_tiny_det.ort`,
        label: "PP-OCRv6_tiny_det.ort",
        approxBytes: 1.8 * MB,
      },
      {
        kind: "recognition",
        url: `${HF_BASE}/recognition/ort/PP-OCRv6_tiny_rec.ort`,
        label: "PP-OCRv6_tiny_rec.ort",
        approxBytes: 4.3 * MB,
      },
      {
        kind: "dictionary",
        url: `${HF_BASE}/recognition/ppocrv6_tiny_dict.txt`,
        label: "ppocrv6_tiny_dict.txt",
        approxBytes: 0.04 * MB,
      },
    ],
  },
};

export const MODEL_ORDER: ModelId[] = ["ru", "en", "multi"];

export function modelTotalBytes(id: ModelId): number {
  return MODEL_CATALOG[id].files.reduce((s, f) => s + f.approxBytes, 0);
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
