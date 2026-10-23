#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Use the committed lockfiles; never run audit-fix or regenerate pins here.
for directory in . frontend artifacts/mockup-sandbox tools; do
  printf '\nInstalling Node dependencies: %s\n' "$directory"
  npm --prefix "$directory" ci --no-audit --no-fund
done

# Replit's pip wrapper enables the managed user package directory.
printf '\nInstalling Python requirements\n'
pip install --user --no-input --disable-pip-version-check -r requirements.txt
python -m pip check

printf '\nBuilding the application frontend\n'
npm --prefix frontend run build

printf '\nBuilding the component preview sandbox\n'
# Managed workflows inject these values at runtime; a one-off build does not.
PORT=23636 BASE_PATH=/__mockup/ npm --prefix artifacts/mockup-sandbox run build

# No database DDL, data resets, or publishing belong in this hook.
# The platform reconciles workflows after the script succeeds.
printf '\nPost-merge setup complete\n'
