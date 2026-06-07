#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: not inside a git repository."
  exit 1
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" == "HEAD" ]]; then
  echo "Error: detached HEAD detected. Check out a branch before deploying."
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: you have uncommitted changes. Commit or stash before deploying."
  git status --short
  exit 1
fi

if ! git rev-parse --abbrev-ref --symbolic-full-name "@{u}" >/dev/null 2>&1; then
  echo "Error: branch '$current_branch' has no upstream remote."
  echo "Run: git push -u origin $current_branch"
  exit 1
fi

echo "Pushing '$current_branch' to GitHub..."
git push

echo "Building web app..."
npm run build

echo "Deploying Firebase Hosting..."
firebase deploy --only hosting

echo "Done: code pushed to GitHub and hosting deployed."
