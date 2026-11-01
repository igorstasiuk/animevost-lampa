#!/bin/sh
# Ищет в бандле Lampa и печатает контекст (фиксированная строка, не regexp).
# Использование: sh tools/lampa-grep.sh '<строка>' [строк_после=20]
# Имена в бандле часто с суффиксами ($5, $f): ищи по куску — 'function open$' или 'Controller.add('.
set -e
cd "$(dirname "$0")/.."
F=.cache/lampa/app.js
[ -f "$F" ] || sh tools/lampa-source.sh >/dev/null
N="${2:-20}"
grep -nF -- "$1" "$F" | head -8 | while IFS=: read -r line rest; do
  echo "=== строка $line ==="
  sed -n "${line},$((line + N))p" "$F" | cut -c1-140
done
