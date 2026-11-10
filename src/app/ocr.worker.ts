/// <reference lib="webworker" />
/**
 * OCR web worker: держит PaddleOcrService (ppu-paddle-ocr/web) вне главного
 * потока, чтобы UI не блокировался во время инференса ONNX.
 *
 * Бэкенд выбирается автоматически: WebGPU → фолбэк WASM
 * (через session.onSessionFallback фиксируем деградацию).
 */

import { PaddleOcrService, isWebGpuAvailable } from "ppu-paddle-ocr/web";
import type { ModelId, WorkerRequest, WorkerResponse } from "@/lib/models";

let service: PaddleOcrService | null = null;
let activeModelId: ModelId | null = null;

function post(msg: WorkerResponse, transfer?: Transferable[]) {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
}

async function destroyCurrent(): Promise<void> {
  if (!service) return;
  const s = service;
  service = null;
  try {
    await s.destroy();
  } catch {
    /* игнорируем — пересоздаём всё равно */
  }
}

async function handleInit(msg: Extract<WorkerRequest, { type: "init" }>) {
  await destroyCurrent();

  let degraded = false;
  const next = new PaddleOcrService({
    model: {
      detection: msg.detection,
      recognition: msg.recognition,
      charactersDictionary: msg.dictionary,
    },
    session: {
      onSessionFallback: () => {
        degraded = true;
      },
    },
    // в воркере нет UI — паузы перед инференсом не нужны;
    // словарь библиотека сама подставляет в initialize() из model.charactersDictionary
    recognition: { mainThreadYieldMs: 0, charactersDictionary: [] },
  });

  const t0 = performance.now();
  await next.initialize();
  service = next;
  activeModelId = msg.modelId;

  const gpu = await isWebGpuAvailable();
  const backend: "webgpu" | "wasm" = !degraded && gpu ? "webgpu" : "wasm";

  post({ type: "ready", id: msg.id, modelId: activeModelId, backend, elapsedMs: performance.now() - t0 });
}

async function handleRecognize(msg: Extract<WorkerRequest, { type: "recognize" }>) {
  if (!service) throw new Error("движок не инициализирован");
  const t0 = performance.now();
  const result = await service.recognize(msg.image);
  post({
    type: "result",
    id: msg.id,
    text: result.text,
    confidence: result.confidence,
    lines: result.lines.map((group) =>
      group.map((r) => ({ text: r.text, box: r.box, confidence: r.confidence })),
    ),
    elapsedMs: performance.now() - t0,
  });
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === "init") {
      await handleInit(msg);
    } else if (msg.type === "recognize") {
      await handleRecognize(msg);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: "error", id: msg.id, message });
  }
};
