#!/usr/bin/env bash
# Пост-обработка после `next build`.
#  - standalone (по умолчанию): собираем самодостаточную папку .next/standalone
#    со статикой и public — запускается `bun run start`.
#  - export (NEXT_OUTPUT=export): next сам пишет статический сайт в out/
#    (для GitHub Pages), делать ничего не нужно.
set -e

if [ "${NEXT_OUTPUT}" = "export" ]; then
  echo "static export: артефакты лежат в out/"
  exit 0
fi

cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/
