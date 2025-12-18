#!/usr/bin/env bash
set -e
brew install ninja llvm@21
echo "LLVM_PATH=$(brew --prefix llvm@21)" >> $GITHUB_ENV
