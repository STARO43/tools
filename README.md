# TuxOCR 🐧

Бесплатное распознавание текста (OCR) в браузере — в стиле Linux-терминала.
Вся обработка происходит **локально на вашей машине**: изображения никуда не отправляются.

## Возможности

- **Движок**: [ppu-paddle-ocr](https://www.npmjs.com/package/ppu-paddle-ocr) — модели PP-OCRv5/v6 (~6 МБ на язык), ONNX Runtime Web
- **Ускорение**: WebGPU с автоматическим фолбэком на WASM
- **Языки**: русский + 40+ языков (кириллический пресет из коробки)
- **Инференс в Web Worker** — интерфейс не подвисает во время распознавания
- **Кэш моделей в IndexedDB** — модель скачивается один раз, дальше запускается мгновенно
- Ввод файла: кнопка, drag & drop, вставка из буфера (Ctrl+V), демо-картинка
- Экспорт результата: копирование и скачивание `.txt`

## Запуск

```bash
bun install   # или npm install / pnpm install
bun run dev   # http://localhost:3000
```

Продакшен-сборка (output: standalone):

```bash
bun run build
bun run start
```

## Структура

```
src/
├── app/
│   ├── page.tsx              # UI терминала (клиентский компонент)
│   ├── ocr.worker.ts         # Web Worker: загрузка ONNX + инференс
│   └── api/model-proxy/      # same-origin релей для скачивания моделей (белый список URL)
├── lib/
│   ├── models.ts             # каталог моделей (языки, размеры, URL весов)
│   └── model-cache.ts        # загрузка с прогрессом + кэш IndexedDB
└── components/ui/            # shadcn/ui
```

## Модели

Публичные веса (MIT): [snowfluke/ppu-paddle-ocr-models](https://huggingface.co/snowfluke/ppu-paddle-ocr-models) на HuggingFace.
Модель детекции + распознавания + словарь скачиваются напрямую из CDN; при проблемах с CORS — через релей `/api/model-proxy`.
