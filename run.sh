#!/bin/sh
# card-collection-factory: launcher for Linux (and macOS from a terminal).
# Checks Node.js, installs what is missing (tools/setup.mjs), then starts the product.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Не найден Node.js. Скачайте и установите его (версия LTS): https://nodejs.org"
  echo "  Потом запустите этот файл снова."
  echo
  exit 1
fi

node tools/setup.mjs "$@"
# When the editor exists, its start goes here, after a successful setup.
