"use client";

/**
 * TuxOCR — бесплатный OCR в стиле Linux-терминала.
 * Движок: ppu-paddle-ocr (PP-OCRv5/v6) через ONNX Runtime (WebGPU → WASM),
 * инференс в Web Worker, модели кэшируются в IndexedDB.
 * Вся обработка — локально в браузере.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MODEL_CATALOG,
  MODEL_ORDER,
  modelTotalBytes,
  type ModelId,
  type OcrBox,
  type WorkerRequest,
  type WorkerResponse,
} from "@/lib/models";
import { clearModelCache, hasCachedModels, loadModelFiles, freshBuffers, type FileProgress } from "@/lib/model-cache";

/* ────────────────────────── утилиты ────────────────────────── */

const SPIN_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} КБ`;
  return `${n} Б`;
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} с` : `${Math.round(ms)} мс`;
}

function progressBar(received: number, total: number, width = 20): string {
  if (total > 0) {
    const filled = Math.min(width, Math.max(0, Math.round((received / total) * width)));
    return "█".repeat(filled) + "░".repeat(width - filled);
  }
  return "░".repeat(width);
}

function browserName(ua: string): string {
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Chrome\//.test(ua)) return "Chromium/Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "неизвестный браузер";
}

const PCT = (v: number) => `${(v * 100).toFixed(1)}%`;

/* ────────────────────────── типы состояния ────────────────────────── */

type LineKind = "ok" | "info" | "warn" | "fail" | "cmd" | "muted";

interface TermLine {
  id: number;
  kind: LineKind;
  text: string;
  progress?: FileProgress;
}

interface LoadedImage {
  name: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
  buffer: ArrayBuffer;
}

interface OcrResultState {
  text: string;
  confidence: number;
  boxCount: number;
  elapsedMs: number;
  backend: string;
  modelId: ModelId;
}

type Phase = "idle" | "running" | "done" | "error";

const KIND_LABEL: Record<LineKind, string> = {
  ok: "[  OK  ]",
  info: "[ ИНФО ]",
  warn: "[ ВНИМ ]",
  fail: "[ СБОЙ ]",
  cmd: "[ CMD  ]",
  muted: "        ",
};

const KIND_CLASS: Record<LineKind, string> = {
  ok: "text-term-green phos",
  info: "text-term-dim",
  warn: "text-term-amber phos-amber",
  fail: "text-term-red",
  cmd: "text-term-dim",
  muted: "text-term-dim/70",
};

/* ────────────────────────── компонент ────────────────────────── */

export default function Page() {
  /* консоль */
  const [lines, setLines] = useState<TermLine[]>([]);
  const lineId = useRef(0);
  const consoleRef = useRef<HTMLDivElement>(null);

  /* среда */
  const [gpu, setGpu] = useState<{ available: boolean; label: string } | null>(null);

  /* модель / движок */
  const [modelId, setModelId] = useState<ModelId>("ru");
  const [cachedIds, setCachedIds] = useState<ModelId[]>([]);
  const engineRef = useRef<{ modelId: ModelId; backend: string } | null>(null);
  const [engineReady, setEngineReady] = useState<string | null>(null); // "ru:webgpu"
  const [initBusy, setInitBusy] = useState(false);

  /* изображение и распознавание */
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [runStart, setRunStart] = useState(0);
  const [nowTick, setNowTick] = useState(0);
  const [result, setResult] = useState<OcrResultState | null>(null);
  const [boxes, setBoxes] = useState<OcrBox[]>([]);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const pendingRef = useRef<Map<number, (r: WorkerResponse) => void>>(new Map());
  const imageRef = useRef<LoadedImage | null>(null);
  const modelIdRef = useRef<ModelId>("ru");
  const busyRef = useRef(false);

  imageRef.current = image;
  modelIdRef.current = modelId;

  /* ── консоль: добавление строк ── */
  const pushLine = useCallback((kind: LineKind, text: string, progress?: FileProgress): number => {
    const id = ++lineId.current;
    setLines((prev) => [...prev.slice(-240), { id, kind, text, progress }]);
    return id;
  }, []);

  const patchLine = useCallback((id: number, patch: Partial<TermLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  const setLineProgress = useCallback(
    (id: number, progress: FileProgress) => {
      const done = progress.done;
      let txt: string;
      if (done && progress.cached) txt = `${progress.label} — из кэша IndexedDB`;
      else if (done) txt = `${progress.label} — ${fmtBytes(progress.received)} скачано`;
      else if (progress.total > 0)
        txt = `${progress.label}  ${progressBar(progress.received, progress.total)} ${Math.floor(
          (progress.received / progress.total) * 100,
        )}%  ${fmtBytes(progress.received)} / ${fmtBytes(progress.total)}`;
      else txt = `${progress.label}  ${fmtBytes(progress.received)}…`;

      patchLine(id, { text: txt, progress, kind: done ? (progress.cached ? "muted" : "ok") : "info" });
    },
    [patchLine],
  );

  /* автоскролл консоли */
  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  /* ── worker ── */
  const getWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      // воркер пре-компилируется scripts/build-worker.sh в public/ocr.worker.js
      // (Turbopack не умеет собирать new Worker(new URL(...), import.meta.url))
      const w = new Worker(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/ocr.worker.js`, {
        type: "module",
      });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const resolver = pendingRef.current.get(e.data.id);
        pendingRef.current.delete(e.data.id);
        resolver?.(e.data);
      };
      w.onerror = (e) => {
        pushLine("fail", `worker: ${e.message || "критическая ошибка"}`);
        busyRef.current = false;
        setInitBusy(false);
      };
      workerRef.current = w;
    }
    return workerRef.current;
  }, [pushLine]);

  const workerCall = useCallback(
    (msg: WorkerRequest, transfer: Transferable[]): Promise<WorkerResponse> =>
      new Promise((resolve) => {
        const w = getWorker();
        pendingRef.current.set(msg.id, resolve);
        w.postMessage(msg, transfer);
      }),
    [getWorker],
  );

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  /* ── инициализация движка (модели + ONNX-сессии) ── */
  const ensureEngine = useCallback(
    async (target: ModelId): Promise<boolean> => {
      const ready = engineRef.current;
      if (ready && ready.modelId === target) return true;
      if (busyRef.current) return false;
      busyRef.current = true;
      setInitBusy(true);

      try {
        const def = MODEL_CATALOG[target];
        pushLine("cmd", `ocr --init --model ${def.flag}`);
        pushLine("info", `модель: ${def.name}`);

        /* 1. файлы модели: кэш или потоковое скачивание */
        const cached = await hasCachedModels(target).catch(() => false);
        const fileLineIds = def.files.map((f) => pushLine("info", `${f.label} — проверка…`));
        if (!cached) {
          pushLine("info", `загрузка весов (~${(modelTotalBytes(target) / (1024 * 1024)).toFixed(1)} МБ), единожды…`);
        }

        await loadModelFiles(def, (p: FileProgress) => {
          const idx = def.files.findIndex((f) => f.label === p.label);
          if (idx >= 0) setLineProgress(fileLineIds[idx], p);
        });

        setCachedIds((prev) => (prev.includes(target) ? prev : [...prev, target]));

        /* 2. создание ONNX-сессий в воркере */
        const buffers = await freshBuffers(target);
        const id = ++reqId.current;
        const resp = await workerCall(
          {
            type: "init",
            id,
            modelId: target,
            detection: buffers.detection,
            recognition: buffers.recognition,
            dictionary: buffers.dictionary,
          },
          [buffers.detection, buffers.recognition, buffers.dictionary],
        );
        if (resp.type === "error") throw new Error(resp.message);
        if (resp.type !== "ready") throw new Error("неожиданный ответ воркера");

        engineRef.current = { modelId: target, backend: resp.backend };
        setEngineReady(`${target}:${resp.backend}`);
        pushLine(
          "ok",
          `ONNX-сессии созданы за ${fmtMs(resp.elapsedMs)} · backend: ${resp.backend.toUpperCase()}` +
            (resp.backend === "wasm" ? " (WebGPU недоступен)" : ""),
        );
        return true;
      } catch (err) {
        pushLine("fail", `инициализация не удалась: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      } finally {
        busyRef.current = false;
        setInitBusy(false);
      }
    },
    [pushLine, setLineProgress, workerCall],
  );

  /* ── распознавание ── */
  const runOcr = useCallback(
    async (target: ModelId) => {
      const img = imageRef.current;
      if (!img || busyRef.current) return;

      setPhase("running");
      setResult(null);
      setBoxes([]);
      const started = performance.now();
      setRunStart(started);
      pushLine("cmd", `./ocr recognize "${img.name}" --model ${MODEL_CATALOG[target].flag}`);
      pushLine("info", `${img.width}×${img.height} px · ${fmtBytes(img.bytes)} · поиск областей текста…`);

      const okEngine = await ensureEngine(target);
      if (!okEngine) {
        setPhase("error");
        return;
      }
      if (imageRef.current !== img) return; // пользователь уже выбрал другое

      const backend = engineRef.current?.backend ?? "wasm";
      const copy = img.buffer.slice(0);
      const id = ++reqId.current;
      const resp = await workerCall({ type: "recognize", id, image: copy }, [copy]);

      if (imageRef.current !== img) return;
      if (resp.type === "error") {
        pushLine("fail", `распознавание не удалось: ${resp.message}`);
        setPhase("error");
        return;
      }
      if (resp.type !== "result") return; // непредвиденный ответ воркера

      const flat = resp.lines.flat();
      setBoxes(flat.map((r) => r.box));
      setResult({
        text: resp.text,
        confidence: resp.confidence,
        boxCount: flat.length,
        elapsedMs: resp.elapsedMs,
        backend,
        modelId: target,
      });
      setPhase("done");
      pushLine(
        "ok",
        `готово за ${fmtMs(resp.elapsedMs)} · областей: ${flat.length} · средняя точность: ${PCT(resp.confidence)}`,
      );
      if (!resp.text.trim()) pushLine("warn", "текст не обнаружен — попробуйте изображение получше");
    },
    [ensureEngine, pushLine, workerCall],
  );

  /* ── загрузка изображения ── */
  const handleFile = useCallback(
    async (file: File | Blob, name?: string) => {
      if (busyRef.current) {
        pushLine("warn", "дождитесь завершения текущей операции");
        return;
      }
      const type = (file as File).type || "";
      const fname = name ?? (file as File).name ?? "clipboard.png";
      if (!type.startsWith("image/") && !/\.(png|jpe?g|webp|bmp|gif|avif)$/i.test(fname)) {
        pushLine("fail", `«${fname}» — не изображение (нужны PNG/JPEG/WEBP/BMP/GIF)`);
        return;
      }
      if (file.size > 30 * 1024 * 1024) {
        pushLine("fail", `файл ${fmtBytes(file.size)} — слишком велик (лимит 30 МБ)`);
        return;
      }

      try {
        const buffer = await file.arrayBuffer();
        const bitmap = await createImageBitmap(new Blob([buffer]));
        const url = URL.createObjectURL(new Blob([buffer], { type: type || "image/png" }));

        if (imageRef.current) URL.revokeObjectURL(imageRef.current.url);
        const img: LoadedImage = {
          name: fname,
          url,
          width: bitmap.width,
          height: bitmap.height,
          bytes: file.size,
          buffer,
        };
        bitmap.close?.();
        setImage(img);
        imageRef.current = img;
        setResult(null);
        setBoxes([]);
        setPhase("idle");
        pushLine("ok", `изображение «${fname}» загружено (${img.width}×${img.height}, ${fmtBytes(file.size)})`);
        void runOcr(modelIdRef.current);
      } catch (err) {
        pushLine("fail", `не удалось декодировать: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [pushLine, runOcr],
  );

  /* ── тестовый образ ── */
  const loadSample = useCallback(async () => {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    pushLine("cmd", "wget /sample/report-ru.png -O - | ./ocr -");
    try {
      const resp = await fetch(`${base}/sample/report-ru.png`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      await handleFile(blob, "report-ru.png");
    } catch (err) {
      pushLine("fail", `тестовый образ недоступен: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [handleFile, pushLine]);

  /* ── буфер обмена ── */
  const pasteFromClipboard = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = item.types.find((t) => t.startsWith("image/"));
        if (imgType) {
          const blob = await item.getType(imgType);
          await handleFile(blob, "clipboard.png");
          return;
        }
      }
      pushLine("warn", "в буфере нет изображения — сделайте скриншот и повторите (или нажмите Ctrl+V)");
    } catch {
      pushLine("warn", "доступ к буферу запрещён — нажмите Ctrl+V прямо на странице");
    }
  }, [handleFile, pushLine]);

  /* ── события окна: вставка / drag&drop ── */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) {
            e.preventDefault();
            void handleFile(f, f.name || "clipboard.png");
          }
          return;
        }
      }
    };
    const preventNav = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("dragover", preventNav);
    window.addEventListener("drop", preventNav);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragover", preventNav);
      window.removeEventListener("drop", preventNav);
    };
  }, [handleFile]);

  /* тикер для спиннера/таймера */
  useEffect(() => {
    if (phase !== "running" && !initBusy) return;
    const t = setInterval(() => setNowTick((v) => v + 1), 100);
    return () => clearInterval(t);
  }, [phase, initBusy]);

  /* ── boot-последовательность ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seq: [LineKind, string][] = [];
      pushLine("muted", "TuxOCR 1.0.0 — browser-native OCR · tty1");
      seq.push(["ok", `init: среда выполнения — ${browserName(navigator.userAgent)}`]);

      /* WebGPU (без типов GPUAdapter — зависят от версии TS lib.dom) */
      let gpuState: { available: boolean; label: string } = { available: false, label: "" };
      try {
        const nav = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } };
        if (nav.gpu) {
          const adapter = (await nav.gpu.requestAdapter()) as
            | { info?: { vendor?: string; architecture?: string; description?: string } }
            | null;
          if (adapter) {
            const info = adapter.info;
            const label = info?.description || [info?.vendor, info?.architecture].filter(Boolean).join(" ") || "GPU";
            gpuState = { available: true, label };
          }
        }
      } catch {
        /* без WebGPU */
      }
      setGpu(gpuState);
      seq.push([
        "ok",
        gpuState.available
          ? `init: WebGPU — активен (${gpuState.label})`
          : "init: WebGPU — недоступен, будет использован WASM-фолбэк",
      ]);
      if (!gpuState.available) seq.push(["warn", "для WebGPU рекомендую Chrome/Edge 113+ на десктопе"]);

      /* IndexedDB */
      let idbOk = false;
      try {
        const probe = indexedDB.open("tuxocr-probe");
        idbOk = probe !== null;
        probe.onupgradeneeded = null;
      } catch {
        idbOk = false;
      }
      seq.push([
        idbOk ? "ok" : "warn",
        idbOk ? "init: хранилище моделей (IndexedDB) — подключено" : "init: IndexedDB недоступна — кэш моделей отключён",
      ]);

      seq.push(["muted", "движок: ppu-paddle-ocr 6.7.0 · PP-OCRv5/v6 · ONNX Runtime Web · 100% локально"]);
      seq.push(["ok", "цель достигнута: expect image..."]);

      for (const [kind, text] of seq) {
        if (cancelled) return;
        await sleep(220);
        pushLine(kind, text);
      }

      /* отметки о уже закэшированных моделях */
      const present: ModelId[] = [];
      for (const id of MODEL_ORDER) {
        if (await hasCachedModels(id).catch(() => false)) present.push(id);
      }
      setCachedIds(present);
      if (present.length && !cancelled) {
        pushLine("muted", `кэш весов: ${present.map((p) => MODEL_CATALOG[p].flag).join(", ")} — повторная загрузка не нужна`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ── смена модели ── */
  const onModelChange = useCallback(
    (id: ModelId) => {
      if (id === modelId || busyRef.current) return;
      setModelId(id);
      modelIdRef.current = id;
      const def = MODEL_CATALOG[id];
      pushLine("cmd", `export OCR_MODEL=${def.flag}`);
      pushLine("info", `${def.name} — ${def.desc} (~${(modelTotalBytes(id) / (1024 * 1024)).toFixed(1)} МБ)`);
      if (engineRef.current && engineRef.current.modelId !== id) {
        pushLine("muted", "предыдущая сессия будет пересоздана при следующем запуске");
      }
    },
    [modelId, pushLine],
  );

  /* ── действия с результатом ── */
  const copyResult = useCallback(async () => {
    if (!result?.text) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      pushLine("ok", "текст скопирован в буфер обмена");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = result.text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        pushLine("ok", "текст скопирован (fallback)");
      } catch {
        pushLine("fail", "копирование не удалось — выделите текст вручную");
      }
      ta.remove();
    }
  }, [result, pushLine]);

  const downloadTxt = useCallback(() => {
    if (!result?.text) return;
    const base = (image?.name ?? "output").replace(/\.[^.]+$/, "");
    const blob = new Blob([result.text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    pushLine("ok", `сохранено: ${base}.txt`);
  }, [result, image, pushLine]);

  const clearAll = useCallback(() => {
    if (imageRef.current) URL.revokeObjectURL(imageRef.current.url);
    setImage(null);
    imageRef.current = null;
    setResult(null);
    setBoxes([]);
    setPhase("idle");
    pushLine("cmd", "clear");
  }, [pushLine]);

  /* ── производные значения ── */
  const def = MODEL_CATALOG[modelId];
  const running = phase === "running" || initBusy;
  const spinner = SPIN_FRAMES[nowTick % SPIN_FRAMES.length];
  const runElapsed = running && runStart ? ((performance.now() - runStart) / 1000).toFixed(1) : "0.0";
  const backendBadge = gpu
    ? gpu.available
      ? "WEBGPU ✓"
      : "WASM"
    : "…";
  const flatLines = result ? result.boxCount : 0;

  /* ────────────────────────── разметка ────────────────────────── */
  return (
    <div className="min-h-screen flex flex-col text-[13px] sm:text-sm">
      <div className="crt-fx" aria-hidden />

      <main className="flex-1 w-full max-w-6xl mx-auto px-3 sm:px-5 py-5 sm:py-8">

        {/* заголовок */}
        <header className="mb-4 sm:mb-6">
          <pre
            aria-hidden
            className="hidden sm:block text-term-green/90 phos text-[10px] leading-[1.15] select-none"
          >
{`████████╗██╗   ██╗██╗  ██╗ ██████╗ ██████╗
╚══██╔══╝╚██╗ ██╔╝██║ ██╔╝██╔═══██╗██╔══██╗
   ██║    ╚████╔╝ █████╔╝ ██║   ██║██████╔╝
   ██║     ╚██╔╝  ██╔═██╗ ██║   ██║██╔═══╝
   ██║      ██║   ██║  ██╗╚██████╔╝██║
   ╚═╝      ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═╝`}
          </pre>
          <h1 className="sm:hidden text-2xl font-bold text-term-green phos-strong">TuxOCR_</h1>
          <p className="mt-2 text-term-dim">
            <span className="text-term-green phos">бесплатный OCR в браузере</span> · PP-OCRv5/v6 ·
            WebGPU → WASM · без загрузки на сервер
          </p>
        </header>

        {/* окно терминала: титул + консоль */}
        <section className="term-panel rounded-sm overflow-hidden" aria-label="Терминал">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-term-edge bg-[#0a1a10]">
            <span className="w-3 h-3 rounded-full bg-[#2f7a45]" />
            <span className="w-3 h-3 rounded-full bg-[#ffb454]/80" />
            <span className="w-3 h-3 rounded-full bg-[#ff6b6b]/80" />
            <span className="ml-2 text-term-dim text-xs truncate">tux@ocr: ~/ocr — bash — 92×32</span>
            <span
              className={`ml-auto text-[11px] px-2 py-0.5 border ${
                gpu?.available
                  ? "border-term-edge text-term-green phos"
                  : gpu === null
                    ? "border-term-edge text-term-dim"
                    : "border-term-amber/40 text-term-amber"
              }`}
              title={
                gpu?.available
                  ? `WebGPU: ${gpu.label}`
                  : "WebGPU не найден — инференс пойдёт на WebAssembly (медленнее)"
              }
            >
              {backendBadge}
            </span>
          </div>

          <div
            ref={consoleRef}
            className="term-scroll h-48 sm:h-56 overflow-y-auto px-3 py-2 leading-relaxed bg-[#050b07]"
            role="log"
            aria-live="polite"
          >
            {lines.map((l) => (
              <div key={l.id} className="whitespace-pre-wrap break-all">
                <span className={`${KIND_CLASS[l.kind]} select-none`}>{KIND_LABEL[l.kind]} </span>
                <span className={l.kind === "ok" ? "text-term-green/90" : l.kind === "fail" ? "text-term-red" : l.kind === "warn" ? "text-term-amber/90" : "text-term-dim"}>
                  {l.text}
                </span>
              </div>
            ))}
            <div className="whitespace-pre-wrap">
              <span className="text-term-green phos select-none">tux@ocr:~$</span>
              {running ? (
                <span className="ml-2 text-term-bright phos">
                  {spinner} {initBusy ? "инициализация движка" : "распознавание"}… {runElapsed}s
                </span>
              ) : (
                <span className="cursor-block" aria-hidden />
              )}
            </div>
          </div>
        </section>

        {/* сетка: вход / выход */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 mt-4 sm:mt-5">

          {/* ─── ВХОД ─── */}
          <section className="term-panel rounded-sm p-3 sm:p-4" aria-label="Входное изображение">
            <h2 className="text-term-dim text-xs tracking-widest mb-3 select-none">
              ── [ ВХОД ] /dev/stdin ──────────
            </h2>

            {/* зона загрузки / превью */}
            <div
              className="dropzone relative rounded-sm min-h-[210px] flex items-center justify-center p-3"
              data-drag={dragOver}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void handleFile(f);
              }}
              role="region"
              aria-label="Зона перетаскивания изображения"
            >
              {image ? (
                <div className="relative w-full">
                  <img
                    src={image.url}
                    alt={`Загружено: ${image.name}`}
                    className="max-h-[300px] w-auto mx-auto block"
                  />
                  {boxes.length > 0 && (
                    <svg
                      className="absolute inset-0 w-full h-full pointer-events-none"
                      viewBox={`0 0 ${image.width} ${image.height}`}
                      preserveAspectRatio="xMidYMid meet"
                      aria-hidden
                    >
                      {boxes.map((b, i) => (
                        <rect
                          key={i}
                          x={b.x}
                          y={b.y}
                          width={b.width}
                          height={b.height}
                          fill="rgba(63,217,124,0.10)"
                          stroke="#3fd97c"
                          strokeWidth={Math.max(1.5, image.width / 500)}
                        />
                      ))}
                    </svg>
                  )}
                  <p className="mt-2 text-center text-term-dim text-xs truncate">
                    {image.name} · {image.width}×{image.height} · {fmtBytes(image.bytes)}
                    {boxes.length > 0 && <span className="text-term-green"> · областей: {boxes.length}</span>}
                  </p>
                </div>
              ) : (
                <div className="text-center select-none">
                  <p className="text-term-green/70 text-4xl mb-3" aria-hidden>
                    ▣
                  </p>
                  <p className="text-term-bright/90 phos">перетащите изображение сюда</p>
                  <p className="text-term-dim mt-1 text-xs">PNG · JPEG · WEBP · BMP · GIF — обработка локально</p>
                </div>
              )}
            </div>

            {/* кнопки */}
            <div className="flex flex-wrap gap-2 mt-3">
              <label className="term-btn inline-flex items-center cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                    e.currentTarget.value = "";
                  }}
                />
                [ ВЫБРАТЬ ФАЙЛ ]
              </label>
              <button type="button" className="term-btn" onClick={() => void pasteFromClipboard()}>
                [ ИЗ БУФЕРА ]
              </button>
              <button type="button" className="term-btn" onClick={() => void loadSample()}>
                [ ТЕСТ. ОБРАЗ ]
              </button>
              <span className="term-btn border-dashed text-term-dim hidden sm:inline-flex" aria-hidden>
                Ctrl+V ✓
              </span>
            </div>

            {/* выбор модели */}
            <h3 className="text-term-dim text-xs tracking-widest mt-5 mb-2 select-none">
              ── [ МОДЕЛЬ ] /usr/share/ocr-models ──
            </h3>
            <div className="space-y-1" role="radiogroup" aria-label="Выбор модели OCR">
              {MODEL_ORDER.map((id) => {
                const m = MODEL_CATALOG[id];
                const active = modelId === id;
                const isCached = cachedIds.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    data-active={active}
                    disabled={running}
                    onClick={() => onModelChange(id)}
                    className="model-row w-full text-left px-3 py-2 disabled:opacity-50"
                  >
                    <span className="text-term-green phos mr-2">{active ? "(●)" : "( )"}</span>
                    <span className={active ? "text-term-bright phos" : "text-term-dim"}>
                      {m.flag.padEnd(6, "\u00A0")}
                      <span className="text-term-green/80">{m.name}</span>
                      <span className="text-term-dim">
                        {"  "}≈{(modelTotalBytes(id) / (1024 * 1024)).toFixed(1)} МБ
                        {isCached && <span className="text-term-green/70"> · [кэш ✓]</span>}
                      </span>
                      <span className="block pl-7 text-[11px] text-term-dim/80">{m.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {engineReady && (
              <p className="mt-2 text-[11px] text-term-dim">
                активная сессия: {engineReady.replace(":", " → ")} · пересоздание при смене модели
              </p>
            )}
          </section>

          {/* ─── ВЫХОД ─── */}
          <section className="term-panel rounded-sm p-3 sm:p-4 flex flex-col" aria-label="Результат распознавания">
            <h2 className="text-term-dim text-xs tracking-widest mb-3 select-none">
              ── [ ВЫХОД ] /dev/stdout ─────────
            </h2>

            {phase === "idle" && !image && (
              <div className="flex-1 flex items-center justify-center min-h-[220px] text-center select-none">
                <div>
                  <p className="text-term-dim">stdout: (пусто)</p>
                  <p className="text-term-dim/70 text-xs mt-1">
                    добавьте изображение — текст появится здесь
                  </p>
                </div>
              </div>
            )}

            {running && (
              <div className="flex-1 flex items-center justify-center min-h-[220px] select-none">
                <p className="text-term-bright phos">
                  {spinner} обработка изображения… {runElapsed}s
                </p>
              </div>
            )}

            {phase === "error" && (
              <div className="flex-1 flex items-center justify-center min-h-[220px] text-center select-none">
                <p className="text-term-red">ошибка — подробности в консоли выше</p>
              </div>
            )}

            {phase === "done" && result && (
              <>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-term-dim border border-term-edge/60 bg-[#0a1a10]/60 px-2.5 py-1.5">
                  <span>
                    строк: <b className="text-term-green">{flatLines}</b>
                  </span>
                  <span>
                    символов: <b className="text-term-green">{result.text.length}</b>
                  </span>
                  <span>
                    точность: <b className="text-term-green">{PCT(result.confidence)}</b>
                  </span>
                  <span>
                    время: <b className="text-term-green">{fmtMs(result.elapsedMs)}</b>
                  </span>
                  <span className="uppercase">
                    {result.backend} · {result.modelId}
                  </span>
                </div>

                <div
                  className="term-scroll flex-1 min-h-[180px] max-h-[420px] overflow-y-auto whitespace-pre-wrap break-words border border-term-edge/60 mt-2 p-2.5 text-term-bright/95 leading-relaxed"
                  tabIndex={0}
                  aria-label="Распознанный текст"
                >
                  {result.text || "— текст не найден —"}
                </div>

                <div className="flex flex-wrap gap-2 mt-3">
                  <button type="button" className="term-btn" onClick={() => void copyResult()}>
                    {copied ? "[ ✓ СКОПИРОВАНО ]" : "[ КОПИРОВАТЬ ]"}
                  </button>
                  <button type="button" className="term-btn" onClick={downloadTxt}>
                    [ СКАЧАТЬ .TXT ]
                  </button>
                  <button type="button" className="term-btn" onClick={() => void runOcr(modelId)} disabled={running}>
                    [ ПОВТОРИТЬ ]
                  </button>
                  <button type="button" className="term-btn" onClick={clearAll}>
                    [ ОЧИСТИТЬ ]
                  </button>
                </div>
              </>
            )}
          </section>
        </div>

        {/* служебная строка */}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-4 text-[11px] text-term-dim/80 select-none">
          <p>
            tux@ocr:~$ uptime — {phase === "done" ? "ocr done" : running ? "ocr busy" : "idle"} · приватность:
            изображения не покидают браузер
          </p>
          <button
            type="button"
            className="term-btn !min-h-[32px] !py-1 !px-2 text-[11px]"
            onClick={() => {
              void clearModelCache().then(() => {
                setCachedIds([]);
                engineRef.current = null;
                setEngineReady(null);
                pushLine("ok", "кэш моделей очищен (IndexedDB)");
              });
            }}
          >
            [ ОЧИСТИТЬ КЭШ МОДЕЛЕЙ ]
          </button>
        </div>
      </main>

      <footer className="mt-auto border-t border-term-edge/70 bg-[#050b07]">
        <div className="max-w-6xl mx-auto px-3 sm:px-5 py-3 text-[11px] text-term-dim flex flex-wrap gap-x-4 gap-y-1">
          <span className="text-term-green/80">TuxOCR 1.0</span>
          <span>движок: ppu-paddle-ocr 6.7.0 (PP-OCRv5 mobile / PP-OCRv6 tiny · MIT)</span>
          <span>инференс: onnxruntime-web, WebGPU → WASM</span>
          <span>веса: ppu-paddle-ocr-models (HuggingFace)</span>
        </div>
      </footer>
    </div>
  );
}
