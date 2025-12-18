#!/usr/bin/env bash
set -e
brew install ninja llvm@21
ln -s $(brew --prefix)/etc/clang ~/.config/clang
echo "LLVM_PATH=$(brew --prefix llvm@21)" >> $GITHUB_ENV
