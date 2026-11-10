# Распознаваньо 💧

Распознавание текста на фото и скриншотах — целиком в браузере.
Ничего никуда не отправляется: картинка обрабатывается прямо на устройстве.

## Возможности

- **Движок**: [ppu-paddle-ocr](https://www.npmjs.com/package/ppu-paddle-ocr) — модели PP-OCRv5/v6 (~6–12 МБ на язык), ONNX Runtime Web
- **Ускорение**: WebGPU с автоматическим фолбэком на WASM
- **Языки**: русский и кириллица · английский и 40+ латинских · 50+ языков (CJK, арабский…)
- **Инференс в Web Worker** — интерфейс не подвисает во время распознавания
- **Кэш языковых пакетов в IndexedDB** — скачивается один раз, дальше мгновенно
- Ввод: кнопка, drag & drop, вставка из буфера (Ctrl+V), демо-пример
- Результат: редактируемый текст, копирование в один клик, скачивание `.txt`
- Дизайн: светлые тона, плавающие градиентные пятна, стеклянные панели, плавные «жидкие» анимации

## Запуск

```bash
bun install
bun run dev   # http://localhost:3000
```

Продакшен-сборка (output: standalone):

```bash
bun run build
bun run start
```

> Воркер (`public/ocr.worker.js`) собирается автоматически из `src/lib/ocr.worker.ts`
> скриптом `scripts/build-worker.sh` (хуки predev/prebuild). Turbopack не компилирует
> `new Worker(new URL(...))` — поэтому воркер собирается отдельно (vercel/next.js#59729).
> WASM-движок ONNX Runtime подтягивается с jsdelivr (версия синхронизирована с package.json).

## Файлы

```
src/
├── app/
│   ├── page.tsx          # вся логика и вёрстка — один файл
│   ├── globals.css       # вся дизайн-система — один файл
│   ├── layout.tsx        # шрифт Manrope (кириллица), метаданные
│   └── api/model-proxy/  # same-origin релей для моделей (нужен только на своем хостинге)
└── lib/
    ├── engine.ts         # каталог языковых пакетов + загрузка + кэш IndexedDB
    └── ocr.worker.ts     # Web Worker: ONNX-сессии + инференс
```


## Модели

Публичные веса (MIT): [snowfluke/ppu-paddle-ocr-models](https://huggingface.co/snowfluke/ppu-paddle-ocr-models).
