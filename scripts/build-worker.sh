#!/usr/bin/env bash
# Пре-компиляция OCR web worker в public/ocr.worker.js.
#
# Turbopack (Next 16) не компилирует new Worker(new URL('./x.ts', import.meta.url)) —
# копирует исходник как статический ассет (vercel/next.js#59729). Поэтому воркер
# собирается отдельно в один ESM-файл и подключается как обычный ресурс из public/.
# Запускается автоматически через predev/prebuild-хуки.
set -e

ENTRY="src/lib/ocr.worker.ts"
OUT="public/ocr.worker.js"

command -v bun >/dev/null 2>&1 || { echo "scripts/build-worker.sh: требуется bun (https://bun.sh)"; exit 1; }

bun build "$ENTRY" \
  --outfile "$OUT" \
  --format esm \
  --target browser \
  --minify \
  --define 'process.env.NODE_ENV: "production"'

echo "worker собран: $OUT ($(du -h "$OUT" | cut -f1))"
