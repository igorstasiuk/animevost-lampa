#!/bin/sh
# Скачивает актуальный бандл Lampa в .cache/lampa/app.js — эталон для проверки сигнатур API.
# Использование: sh tools/lampa-source.sh [url]
set -e
cd "$(dirname "$0")/.."
URL="${1:-https://yumata.github.io/lampa/app.min.js}"
mkdir -p .cache/lampa
curl -fsSL -m 120 "$URL" -o .cache/lampa/app.js
echo "Lampa: $(wc -c < .cache/lampa/app.js) байт, $(wc -l < .cache/lampa/app.js) строк -> .cache/lampa/app.js"
echo "Пример: sh tools/lampa-grep.sh 'function collectionFocus' 25"
