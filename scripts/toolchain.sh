#!/usr/bin/env sh

set -e

apk update
apk add git curl g++ bison make patch tar xz gawk

mkdir /toolchain

git clone https://github.com/richfelker/musl-cross-make.git

cd musl-cross-make

git checkout -f 227df8b99103f9c59f6570babf892978e293082f

echo "TARGET = $1" >> config.mak
echo "OUTPUT = /toolchain/" >> config.mak
echo "GCC_VER = 15.2.0" >> config.mak
echo "DL_CMD = curl --retry 20 --retry-max-time 120 -C - -L -o" >> config.mak
echo "COMMON_CONFIG += CFLAGS=\"-fdata-sections -ffunction-sections -O2 -g0\" CXXFLAGS=\"-fdata-sections -ffunction-sections -O2 -g0\"" >> config.mak
echo "BINUTILS_CONFIG = --enable-gprofng=no" >> config.mak
echo "GNU_SITE = https://mirrors.ocf.berkeley.edu/gnu" >> config.mak

make -j 8
make install

cd ..

tar czvf toolchain.tar.gz /toolchain
