#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks "$@"
  exit 0
fi

if command -v docker >/dev/null 2>&1; then
  if docker run --rm -v "$REPO_ROOT:/repo" -w /repo ghcr.io/gitleaks/gitleaks:latest "$@"; then
    exit 0
  fi

  cat >&2 <<'EOF'
Docker was found but could not run the gitleaks container.
Install gitleaks locally or fix Docker integration and retry.
EOF
  exit 1
fi

cat >&2 <<'EOF'
gitleaks is required to scan for secrets.
Install it from https://github.com/gitleaks/gitleaks#installing
or install Docker and retry.
EOF
exit 1
