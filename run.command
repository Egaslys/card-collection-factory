#!/bin/sh
# card-collection-factory: launcher for macOS (double-click in Finder).
# Runs run.sh and keeps the window open, so the result can be read.
"$(cd "$(dirname "$0")" && pwd)/run.sh" "$@"
code=$?
echo
printf "Нажмите Enter, чтобы закрыть окно. "
read -r _
exit $code
