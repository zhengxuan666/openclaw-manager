#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
YEL='\033[1;33m'
GRN='\033[0;32m'
NC='\033[0m'

# Scan staged files only
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR || true)
if [[ -z "${STAGED_FILES}" ]]; then
  exit 0
fi

# Heuristic secret patterns (intentionally conservative)
PATTERN="(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|([Aa][Pp][Ii][_ -]?[Kk][Ee][Yy]|[Tt][Oo][Kk][Ee][Nn]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd])[[:space:]]*[:=][[:space:]]*[A-Za-z0-9_\-\/=+]{12,})"

HIT=0
while IFS= read -r f; do
  [[ -f "$f" ]] || continue
  if git show ":$f" | grep -I -nE "$PATTERN" >/tmp/.git-secrets-hit.$$ 2>/dev/null; then
    echo -e "${RED}[secrets-scan] Potential secret in staged file: $f${NC}"
    cat /tmp/.git-secrets-hit.$$
    HIT=1
  fi
done <<< "$STAGED_FILES"
rm -f /tmp/.git-secrets-hit.$$ || true

# Block known sensitive paths from being committed
BLOCK_PATH_REGEX='(^|/)(\.snow/|backups?/|.*\.bak(\.|$)|openclaw\.json\.bak|clawdbot\.json\.bak)'
if echo "$STAGED_FILES" | grep -E "$BLOCK_PATH_REGEX" >/tmp/.git-secrets-path-hit.$$ 2>/dev/null; then
  echo -e "${YEL}[secrets-scan] Blocked sensitive paths detected in staged changes:${NC}"
  cat /tmp/.git-secrets-path-hit.$$
  HIT=1
fi
rm -f /tmp/.git-secrets-path-hit.$$ || true

if [[ $HIT -ne 0 ]]; then
  echo -e "${RED}Commit blocked: remove/redact sensitive data, then retry.${NC}"
  exit 1
fi

echo -e "${GRN}[secrets-scan] Passed.${NC}"
