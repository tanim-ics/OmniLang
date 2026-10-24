#!/usr/bin/env bash
# Double-click in Finder to launch OmniLang (asks Docker or Native).
cd "$(dirname "$0")" && exec ./start.sh "$@"
