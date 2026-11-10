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

## Публикация на GitHub Pages

Сайт полностью статический — серверный код не нужен. Workflow
`.github/workflows/deploy.yml` собирает экспорт и деплоит автоматически:

1. В настройках репозитория: **Settings → Pages → Build and deployment → Source: GitHub Actions**
2. Сделайте `git push` в `main` (или запустите workflow вручную: **Actions → Deploy to GitHub Pages → Run workflow**)
3. Сайт появится по адресу `https://<user>.github.io/<репозиторий>/`

В режиме Pages модели скачиваются напрямую с HuggingFace (серверный релей
`/api/model-proxy` остаётся только для self-hosting).

## Структура

```
src/
├── app/
│   ├── page.tsx              # UI терминала (клиентский компонент)
│   └── api/model-proxy/      # same-origin релей для скачивания моделей (белый список URL)
├── lib/
│   ├── models.ts             # каталог моделей (языки, размеры, URL весов)
│   ├── model-cache.ts        # загрузка с прогрессом + кэш IndexedDB
│   └── ocr.worker.ts         # Web Worker: загрузка ONNX + инференс
└── components/ui/            # shadcn/ui
```

## Модели

Публичные веса (MIT): [snowfluke/ppu-paddle-ocr-models](https://huggingface.co/snowfluke/ppu-paddle-ocr-models) на HuggingFace.
Модель детекции + распознавания + словарь скачиваются напрямую из CDN; при проблемах с CORS — через релей `/api/model-proxy`.
