#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Run this command inside the repository." >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

chmod +x .githooks/pre-commit scripts/run-gitleaks.sh scripts/install-git-hooks.sh
git config core.hooksPath .githooks

echo "Installed git hooks in $REPO_ROOT/.githooks"
echo "core.hooksPath=$(git config core.hooksPath)"
