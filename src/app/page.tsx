"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MODEL_CATALOG,
  MODEL_ORDER,
  hasCachedModels,
  loadModelFiles,
  freshBuffers,
  type LoadProgress,
  type ModelId,
  type WorkerRequest,
  type WorkerResponse,
} from "@/lib/engine";
import { PdfReaderLegacyWeb } from "ppu-pdf/web";
import * as pdfjsLib from "pdfjs-dist";

/* ────────────────────────── утилиты ────────────────────────── */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} КБ`;
  return `${n} Б`;
}

function fmtSec(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace(".", ",")} с`;
}

/* счётчик в стиле metic: 000% */
function fmtPercent(p: number | null): string {
  return p === null ? "" : ` ${String(p).padStart(3, "0")}%`;
}

async function pdfToImageBuffers(buffer: ArrayBuffer): Promise<ArrayBuffer[]> {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
  const reader = new PdfReaderLegacyWeb();
  const pdf = await reader.open(buffer);
  const canvasMap = await reader.renderAll(pdf);
  const buffers: ArrayBuffer[] = [];
  for (const canvas of canvasMap.values()) {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))), "image/png");
    });
    buffers.push(await blob.arrayBuffer());
  }
  await reader.destroy(pdf);
  return buffers;
}

function qualityPill(confidence: number): { label: string; mid: boolean } {
  if (confidence >= 0.8) return { label: "Качество: отличное", mid: false };
  if (confidence >= 0.6) return { label: "Качество: хорошее", mid: false };
  return { label: "Есть пропуски — проверьте", mid: true };
}

interface LoadedImage {
  name: string;
  url: string;
  width: number;
  height: number;
  buffer: ArrayBuffer;
}

interface Result {
  confidence: number;
  elapsedMs: number;
  lang: ModelId;
}

type Phase = "empty" | "prep" | "ocr" | "done" | "error";

/* ────────────────────────── иконки ────────────────────────── */

/* Документ вместо «горки» — скруглённая рамка + строки */
const IconImage = () => (
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <defs>
    {/* Маска: облако минус полоса по линии (справа налево) */}
    <mask id="cloudCut">
      <rect width="24" height="24" fill="black" />
      {/* само облако — белым (видимо) */}
      <path fill="white" d="
        M5 20.5
        A5 5 0 0 1 5 10.5
        A5.5 5.5 0 0 1 16 7
        A4.5 4.5 0 0 1 21.5 15
        A4.5 4.5 0 0 1 19 20.5
        Z
      " />
      {/* дырка справа налево */}
      <line x1="23" y1="1" x2="1" y2="23"
        stroke="black" 
        style={{ strokeWidth: 4.5, strokeLinecap: "round" }} 
      />
    </mask>
  </defs>

  {/* Прозрачное облако с жирным чёрным контуром и вырезанной дыркой */}
  <g mask="url(#cloudCut)">
    <path fill="none"
      stroke="#000000"
      style={{ strokeWidth: 2.8, strokeLinejoin: "round" }}
      d="
      M5 20.5
      A5 5 0 0 1 5 10.5
      A5.5 5.5 0 0 1 16 7
      A4.5 4.5 0 0 1 21.5 15
      A4.5 4.5 0 0 1 19 20.5
      Z
    " />
  </g>

  {/* Тонкая красная линия поверх, справа налево */}
  <line x1="23" y1="1" x2="1" y2="23"
    stroke="#e02020" 
    style={{ strokeWidth: 1.6, strokeLinecap: "round" }} 
  />
</svg>
);

const IconCopy = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="9" width="11" height="12" rx="2.5" />
    <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
  </svg>
);

const IconCheck = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4.5 12.8 10 18 19.5 6.5" />
  </svg>
);

const IconDownload = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5" />
    <path d="M4 17.5v1A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-1" />
  </svg>
);

const IconLock = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </svg>
);

const IconScanner = () => (
  <svg
    width="100%"
    height="100%"
    viewBox="0 0 32 32"
    shapeRendering="crispEdges"
    style={{ display: "block", imageRendering: "pixelated" }}
    aria-hidden
  >
    <defs>
      <clipPath id="scanner-after-clip">
        <rect x="0" y="0" width="32" height="0">
          <animate
            attributeName="height"
            values="0;0;32;32"
            keyTimes="0;0.06;0.86;1"
            dur="4s"
            repeatCount="indefinite"
          />
        </rect>
      </clipPath>
    </defs>

    <g fill="#8a8f99">
      <rect x="0" y="3"  width="32" height="1.8" />
      <rect x="0" y="6.5"  width="26" height="1.8" />
      <rect x="0" y="10" width="32" height="1.8" />
      <rect x="0" y="13.5" width="20" height="1.8" />
      <rect x="0" y="17" width="32" height="1.8" />
      <rect x="0" y="20.5" width="24" height="1.8" />
      <rect x="0" y="24" width="32" height="1.8" />
      <rect x="0" y="27.5" width="18" height="1.8" />
    </g>

    <g fill="#121214" clipPath="url(#scanner-after-clip)">
      <rect x="0" y="3"  width="32" height="1.8" />
      <rect x="0" y="6.5"  width="26" height="1.8" />
      <rect x="0" y="10" width="32" height="1.8" />
      <rect x="0" y="13.5" width="20" height="1.8" />
      <rect x="0" y="17" width="32" height="1.8" />
      <rect x="0" y="20.5" width="24" height="1.8" />
      <rect x="0" y="24" width="32" height="1.8" />
      <rect x="0" y="27.5" width="18" height="1.8" />
    </g>

    <g>
      <animateTransform
        attributeName="transform"
        type="translate"
        values="0 0; 0 0; 0 32; 0 32"
        keyTimes="0;0.06;0.86;1"
        dur="4s"
        repeatCount="indefinite"
      />
<rect x="0" y="0" width="32" height="1.6" fill="#ff2b2b" opacity="0.35" />
<rect x="0" y="0" width="32" height="1" fill="#ff2b2b" />
    </g>
  </svg>
);

const FoldingCube = ({ size = 96 }: { size?: number }) => (
  <div className="cube" style={{ width: size, height: size }} aria-hidden>
    <i /><i /><i /><i />
  </div>
);

/* ────────────────────────── компонент ────────────────────────── */

export default function Page() {
  const [lang, setLang] = useState<ModelId>("ru");
  const [cached, setCached] = useState<ModelId[]>([]);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [phase, setPhase] = useState<Phase>("empty");
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [status, setStatus] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [busyFlash, setBusyFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPdfFile, setIsPdfFile] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const engineRef = useRef<{ modelId: ModelId } | null>(null);
  const reqId = useRef(0);
  const pendingRef = useRef<Map<number, (r: WorkerResponse) => void>>(new Map());
  const busyRef = useRef(false);
  const imageRef = useRef<LoadedImage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<{ file: File | Blob; name?: string } | null>(null);
  const handleFileRef = useRef<((f: File | Blob, n?: string) => Promise<void>) | null>(null);

  /* живая строка: время · день недели · дата */
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  /* проверка поддержки: onnxruntime-web требует WASM SIMD */
useEffect(() => {
  const simdOk =
    typeof WebAssembly === "object" &&
    WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
    );
  const workersOk = typeof Worker !== "undefined";
  const bitmapOk = typeof createImageBitmap === "function";
  if (!simdOk || !workersOk || !bitmapOk) setUnsupported(true);
}, []);

  const p2 = (n: number) => String(n).padStart(2, "0");
  const timeStr = now ? `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}` : "--:--:--";
  const dayStr = now ? now.toLocaleDateString("ru-RU", { weekday: "long" }) : "";
  const dateStr = now ? `${p2(now.getDate())}.${p2(now.getMonth() + 1)}.${now.getFullYear()}` : "";

  const getWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      const w = new Worker(`${BASE}/ocr.worker.js`, { type: "module" });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const resolver = pendingRef.current.get(e.data.id);
        pendingRef.current.delete(e.data.id);
        resolver?.(e.data);
      };
      workerRef.current = w;
    }
    return workerRef.current;
  }, []);

  const workerCall = useCallback(
    (msg: WorkerRequest, transfer: Transferable[]): Promise<WorkerResponse> =>
      new Promise((resolve) => {
        pendingRef.current.set(msg.id, resolve);
        getWorker().postMessage(msg, transfer);
      }),
    [getWorker],
  );

  const ensureEngine = useCallback(
    async (target: ModelId): Promise<boolean> => {
      setPhase("prep");
      setProgress(null);
      try {
        if (engineRef.current?.modelId !== target) {
          setStatus(
            (await hasCachedModels(target))
              ? "Настраиваю распознавание…"
              : `Загружаю языковой пакет «${MODEL_CATALOG[target].short}»…`,
          );
          const files = await loadModelFiles(MODEL_CATALOG[target], (p) => setProgress(p));

          setStatus("Запускаю движок…");
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
          if (resp.type !== "ready") throw new Error("Неожиданный ответ воркера");
          engineRef.current = { modelId: target };
          setCached((prev) => (prev.includes(target) ? prev : [...prev, target]));
        }
        return true;
      } catch (err) {
        setPhase("error");
        setResult(null);
        throw err instanceof Error ? err : new Error(String(err));
      } finally {
        setProgress(null);
      }
    },
    [workerCall],
  );

  const runOcr = useCallback(
    async (target: ModelId): Promise<string> => {
      const img = imageRef.current;
      if (!img || busyRef.current) return "";

      busyRef.current = true;
      setCopied(false);
      const started = performance.now();
      const tick = setInterval(() => setElapsed(performance.now() - started), 100);
      try {
        await ensureEngine(target);
        const imgNow = imageRef.current;
        if (imgNow !== img) return "";

        setPhase("ocr");
        setStatus("Сканирую…");
        const copy = imgNow.buffer.slice(0);
        const id = ++reqId.current;
        const resp = await workerCall({ type: "recognize", id, image: copy }, [copy]);
        if (imageRef.current !== imgNow) return "";

        if (resp.type === "error") throw new Error(resp.message);
        if (resp.type !== "result") throw new Error("Неожиданный ответ воркера");

        const elapsedMs = performance.now() - started;
        if (!resp.text.trim()) {
          setPhase("error");
          setResult(null);
          setStatus("");
          setError("На этой странице не нашлось текста.");
          return "";
        }

        setResult({ confidence: resp.confidence, elapsedMs, lang: target });
        setPhase("done");
        setStatus("");
        return resp.text;
      } catch (err) {
        if (imageRef.current !== img) return "";
        setPhase("error");
        setResult(null);
        setStatus("");
        setError(
          err instanceof Error
            ? `Не получилось: ${err.message}`
            : "Не получилось распознать текст.",
        );
        return "";
      } finally {
        clearInterval(tick);
        busyRef.current = false;
        const queued = pendingFileRef.current;
        pendingFileRef.current = null;
        if (queued) void handleFileRef.current?.(queued.file, queued.name);
      }
    },
    [ensureEngine, workerCall],
  );

  const handleFile = useCallback(
    async (file: File | Blob, name?: string) => {
      const fname = name ?? (file as File).name ?? "файл";
      const type = (file as File).type || "";
      const isPdf = type === "application/pdf" || /\.pdf$/i.test(fname);
      const isImage = type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|gif|avif)$/i.test(fname);

      if (!isPdf && !isImage) {
        setError("PDF, PNG, JPEG, WEBP или скриншот.");
        return;
      }

      setIsPdfFile(isPdf);

      if (file.size > 30 * 1024 * 1024) {
        setError(`Файл слишком большой (${fmtBytes(file.size)}). До 30 МБ, пожалуйста.`);
        return;
      }

      if (busyRef.current) {
        pendingFileRef.current = { file, name };
        setBusyFlash(true);
        window.setTimeout(() => setBusyFlash(false), 1600);
        return;
      }

      try {
        const buffer = await file.arrayBuffer();
        let imageBuffers: ArrayBuffer[];

        if (isPdf) {
          setPhase("prep");
          setStatus("Рендерю страницы PDF…");
          imageBuffers = await pdfToImageBuffers(buffer);
        } else {
          imageBuffers = [buffer];
        }

        let fullText = "";

        for (let i = 0; i < imageBuffers.length; i++) {
          const imgBuffer = imageBuffers[i];
          const bitmap = await createImageBitmap(new Blob([imgBuffer]));
          const url = URL.createObjectURL(new Blob([imgBuffer], { type: "image/png" }));

          if (imageRef.current) URL.revokeObjectURL(imageRef.current.url);

          const img: LoadedImage = {
            name: imageBuffers.length > 1 ? `${fname} — стр. ${i + 1}` : fname,
            url,
            width: bitmap.width,
            height: bitmap.height,
            buffer: imgBuffer,
          };
          bitmap.close?.();
          imageRef.current = img;
          setImage(img);
          setError(null);
          setPhase("empty");
          setText("");

          const pageText = await runOcr(lang);

          if (pageText) {
            if (fullText) fullText += "\n\n";
            fullText += pageText;
          }

          if (imageRef.current !== img) break;
        }

        if (imageRef.current && fullText) {
          setText(fullText);
          setPhase("done");
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? `Не удалось открыть файл: ${err.message}`
            : "Не удалось открыть файл. Попробуйте другой.",
        );
      }
    },
    [lang, runOcr],
  );

  handleFileRef.current = handleFile;

  const pickFile = useCallback(() => fileInputRef.current?.click(), []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) void handleFile(f);
      e.target.value = "";
    },
    [handleFile],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) {
            e.preventDefault();
            void handleFile(f, f.name || "снимок.png");
          }
          return;
        }
      }
    };
    const preventNav = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) void handleFile(f);
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragOver(false);
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [handleFile]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const present: ModelId[] = [];
      for (const id of MODEL_ORDER) {
        if (await hasCachedModels(id).catch(() => false)) present.push(id);
      }
      if (!cancelled) setCached(present);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const switchLang = useCallback(
    (id: ModelId) => {
      if (id === lang || busyRef.current) return;
      setLang(id);
      if (imageRef.current) {
        setResult(null);
        setText("");
        void runOcr(id);
      }
    },
    [lang, runOcr],
  );

  const copyResult = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  const downloadTxt = useCallback(() => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(image?.name ?? "текст").replace(/\.[^.]+$/, "")}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [text, image]);

  const busy = phase === "prep" || phase === "ocr";
  const percent = progress && progress.total > 0 ? Math.min(100, Math.floor((progress.received / progress.total) * 100)) : null;
  const pill = result ? qualityPill(result.confidence) : null;
  const showZone = !image || isPdfFile;
if (unsupported) {
  return (
    <div className="unsupported">
      <div className="unsupported__card">
        <div className="unsupported__logo">Сканериньо</div>
        <h1 className="unsupported__title">Устройство не подходит</h1>
        <p className="unsupported__text">
          Ваше устройство не поддерживает распознавание текста в браузере.
        </p>
        <p className="unsupported__text">Откройте сайт с планшета/ноута/компа</p>
      </div>
    </div>
  );
}
  
  return (
    <div className="page">
      {/* ─── шапка: время · день · дата, затем лого и языки ─── */}
      <header className="head">
        <div className="head__clock" suppressHydrationWarning>
          <span className="head__time">{timeStr}</span>
          {now && <span className="head__date">{dayStr} · {dateStr}</span>}
        </div>

        <div className="head__brand">
          <span className="head__mark">
            <IconScanner />
          </span>
          <span className="head__name">
            Сканер<em>иньо</em>
          </span>

          <nav className="langs" aria-label="Язык распознавания">
            {MODEL_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                className={`chip${lang === id ? " chip--on" : ""}`}
                onClick={() => switchLang(id)}
                title={MODEL_CATALOG[id].hint}
              >
                {MODEL_CATALOG[id].short}
                {cached.includes(id) && lang !== id && <span className="chip__dot" title="Уже загружен" />}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="main">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          onChange={onInputChange}
          hidden
          aria-hidden
          tabIndex={-1}
        />

        {showZone ? (
          <button
            type="button"
            className="zone"
            onClick={pickFile}
            aria-label="Выбрать файл"
          >
            <IconImage />
          </button>
        ) : (
          <button
            type="button"
            className="preview"
            onClick={pickFile}
            aria-label={`Загружено: ${image?.name}. Выбрать другой файл`}
          >
            <img src={image?.url} alt={`Загружено: ${image?.name}`} />
            <span className="preview__tool">
              <IconImage />
            </span>
            {busy && (
              <span className="preview__scrim">
                <FoldingCube size={72} />
                <span className="load__status" style={{ margin: 0 }}>
                  {status}
                  {phase === "ocr" && ` ${fmtSec(elapsed)}`}
                </span>
              </span>
            )}
          </button>
        )}

        {busy && showZone && (
          <div className="load">
            <FoldingCube size={96} />
            <p className="load__status">
              {status}
              {fmtPercent(percent)}
              {phase === "ocr" ? ` ${fmtSec(elapsed)}` : ""}
            </p>
            {percent !== null && (
              <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                <div className="progress__bar" style={{ width: `${percent}%` }} />
              </div>
            )}
            {percent !== null && (
              <p className="load__hint">
                {fmtBytes(progress?.received ?? 0)} из {fmtBytes(progress?.total ?? 0)} — тут первый раз — долго
              </p>
            )}
          </div>
        )}

        {busyFlash && (
          <p className="hint">
            Секунду — дораспознаю предыдущую картинку и возьмусь за эту.
          </p>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {result && (
          <section className="result">
            <div className="result__head">
              {pill && <span className={`pill${pill.mid ? " pill--mid" : ""}`}>{pill.label}</span>}
            </div>
            <textarea
              className="result__text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              aria-label="Распознанный текст"
            />
            <div className="actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={copyResult}
              >
                {copied ? <IconCheck /> : <IconCopy />}
                {copied ? "ЕСТЬ!" : "КОПИРОВАТЬ"}
              </button>
              <button type="button" className="btn btn--ghost" onClick={downloadTxt}>
                <IconDownload />
                СКАЧАТЬ
              </button>
            </div>
          </section>
        )}
      </main>

      {/* «Поймаю!» — на всё окно при перетаскивании */}
      {dragOver && (
        <div className="catch" aria-hidden>
          <span>Поймаю!</span>
        </div>
      )}

      <footer className="foot">
        <span className="foot__lock">
          <IconLock />
          Оптическое распознавание символов локально
        </span>
        <span>Завайбкодил @vnvax</span>
      </footer>
    </div>
  );
}
