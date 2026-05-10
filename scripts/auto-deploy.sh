#!/usr/bin/env bash
set -euo pipefail

# Change to the project root (where this script is located)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Make sure we have the latest code
git fetch origin main

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
    echo "[$(date -Iseconds)] Already up to date. Nothing to do."
    exit 0
fi

echo "[$(date -Iseconds)] New commits detected. Pulling and rebuilding..."

git pull origin main

# Rebuild and restart containers
docker compose up --build -d

echo "[$(date -Iseconds)] Deploy finished."
