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
}

type Phase = "empty" | "prep" | "ocr" | "done" | "error";

/* ────────────────────────── иконки (инлайн, без библиотек) ────────────────────────── */

const IconDocument = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M14 3H7a2.5 2.5 0 0 0-2.5 2.5v13A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5V8.5z" />
    <path d="M14 3v5.5h5.5" />
    <path d="M8.5 12.5h7" />
    <path d="M8.5 15.5h7" />
    <path d="M8.5 18h4.5" />
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
      <rect x="0" y="3" width="32" height="1.8" />
      <rect x="0" y="6.5" width="26" height="1.8" />
      <rect x="0" y="10" width="32" height="1.8" />
      <rect x="0" y="13.5" width="20" height="1.8" />
      <rect x="0" y="17" width="32" height="1.8" />
      <rect x="0" y="20.5" width="24" height="1.8" />
      <rect x="0" y="24" width="32" height="1.8" />
      <rect x="0" y="27.5" width="18" height="1.8" />
    </g>

    <g fill="#1a1d24" clipPath="url(#scanner-after-clip)">
      <rect x="0" y="3" width="32" height="1.8" />
      <rect x="0" y="6.5" width="26" height="1.8" />
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
      <rect x="0" y="0" width="32" height="1.6" fill="#ff3636" opacity="0.4" />
      <rect x="0" y="0" width="32" height="1" fill="#ff3636" />
    </g>
  </svg>
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

  const workerRef = useRef<Worker | null>(null);
  const engineRef = useRef<{ modelId: ModelId } | null>(null);
  const reqId = useRef(0);
  const pendingRef = useRef<Map<number, (r: WorkerResponse) => void>>(new Map());
  const busyRef = useRef(false);
  const imageRef = useRef<LoadedImage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<{ file: File | Blob; name?: string } | null>(null);
  const handleFileRef = useRef<((f: File | Blob, n?: string) => Promise<void>) | null>(null);

  /* ── worker ── */
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

  /* ── подготовка движка ── */
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
          await loadModelFiles(MODEL_CATALOG[target], (p) => setProgress(p));

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

  /* ── распознавание ── */
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

        if (!resp.text.trim()) {
          setPhase("error");
          setResult(null);
          setStatus("");
          setError("На этой странице не нашлось текста.");
          return "";
        }

        setResult({ confidence: resp.confidence });
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

  /* ── загрузка файла ── */
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

      setIsPdfFile(isPdf);

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

  /* ── события: выбор файла, вставка, перетаскивание ── */
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

  /* отметки о закэшированных пакетах при старте */
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

  /* очистка blob-url при размонтировании */
  useEffect(() => {
    return () => {
      if (imageRef.current) URL.revokeObjectURL(imageRef.current.url);
    };
  }, []);

  /* смена языка */
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

  /* ── копирование и скачивание ── */
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

  /* ── вычисляемое ── */
  const busy = phase === "prep" || phase === "ocr";
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.floor((progress.received / progress.total) * 100))
      : null;
  const pill = result ? qualityPill(result.confidence) : null;

  return (
    <>
      <div className="blobs" aria-hidden>
        <div className="blob blob--lavender" />
        <div className="blob blob--aqua" />
        <div className="blob blob--peach" />
        <div className="blob blob--sky" />
      </div>

      <main className="shell">
        <header className="brand">
          <div className="brand__mark">
            <IconScanner />
          </div>
          <div className="brand__name">
            Сканер<em>иньо</em>
          </div>
        </header>

        {/* ── шаг 1: картинка ── */}
        <section className="glass">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf"
            onChange={onInputChange}
            hidden
            aria-hidden
            tabIndex={-1}
          />
          <button
            type="button"
            className={`dz dz--float${dragOver ? " is-over" : ""}`}
            onClick={pickFile}
            aria-label="Выбрать файл"
          >
            <span className="dz__icon">
              <IconDocument />
            </span>
          </button>

          {image && !isPdfFile && (
            <figure className="preview" style={{ margin: "18px 0 0" }}>
              <img src={image.url} alt={`Загружено: ${image.name}`} />
              {busy && (
                <div className="preview__scrim">
                  <span className="status" style={{ margin: 0 }}>
                    <span className="status__dots">
                      <i></i>
                      <i></i>
                      <i></i>
                    </span>
                    {status}
                    {phase === "ocr" && ` ${fmtSec(elapsed)}`}
                  </span>
                </div>
              )}
            </figure>
          )}

          {busy && (!image || isPdfFile) && (
            <div className="status">
              <span className="status__dots">
                <i></i>
                <i></i>
                <i></i>
              </span>
              <span>
                {status}
                {percent !== null ? ` ${percent}%` : ""}
                {phase === "ocr" ? ` ${fmtSec(elapsed)}` : ""}
              </span>
            </div>
          )}

          {busy && percent !== null && (!image || isPdfFile) && (
            <div
              className="progress"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="progress__bar" style={{ width: `${percent}%` }} />
            </div>
          )}

          {busy && !image && percent !== null && (
            <p className="zone__hint" style={{ marginTop: 8 }}>
              {fmtBytes(progress?.received ?? 0)} из {fmtBytes(progress?.total ?? 0)} — тут первый
              раз — долго
            </p>
          )}

          {busyFlash && (
            <p className="zone__hint" style={{ marginTop: 10 }}>
              Секунду — дораспознаю предыдущую картинку и возьмусь за эту.
            </p>
          )}

          <div className="langs">
            {MODEL_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                className={`chip${lang === id ? " chip--on" : ""}`}
                onClick={() => switchLang(id)}
                title={MODEL_CATALOG[id].hint}
              >
                {MODEL_CATALOG[id].short}
                {cached.includes(id) && lang !== id && (
                  <span className="chip__dot" title="Уже загружен" />
                )}
              </button>
            ))}
          </div>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>

        {/* ── шаг 2: результат ── */}
        {result && (
          <section className="glass result">
            <div className="result__head">
              {pill && (
                <span className={`pill${pill.mid ? " pill--mid" : ""}`}>{pill.label}</span>
              )}
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
                className={`btn btn--primary${copied ? " btn--done" : ""}`}
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

        <footer className="footer">
          <span className="footer__lock">
            <IconLock />
            Локально на вашем устройстве
          </span>
          <span>Навайбкодил @vnvax</span>
        </footer>
      </main>
    </>
  );
}
