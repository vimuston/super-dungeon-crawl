#!/usr/bin/env python3
"""Fail unless every ELF file given has 16 KB aligned LOAD segments.

Google Play requires 16 KB page support for native code in apps targeting
Android 15+; crawl and crawlhost ship as lib*.so executables, so they count.
NDK r28+ links 16 KB aligned by default; this catches a toolchain that doesn't.

    check_page_align.py FILE...
"""
import struct
import sys

PAGE = 16384


def load_aligns(path):
    with open(path, 'rb') as f:
        data = f.read()
    if data[:4] != b'\x7fELF' or data[4] != 2:
        raise ValueError('not a 64-bit ELF file')
    end = '<' if data[5] == 1 else '>'
    phoff, = struct.unpack_from(end + 'Q', data, 0x20)
    phentsize, phnum = struct.unpack_from(end + 'HH', data, 0x36)
    for i in range(phnum):
        off = phoff + i * phentsize
        p_type, = struct.unpack_from(end + 'I', data, off)
        if p_type == 1:  # PT_LOAD
            p_align, = struct.unpack_from(end + 'Q', data, off + 0x30)
            yield p_align


def main(paths):
    bad = 0
    for path in paths:
        aligns = list(load_aligns(path))
        low = [a for a in aligns if a < PAGE]
        print(f"{path}: LOAD align {sorted(set(aligns))}"
              + (' NOT 16 KB aligned' if low or not aligns else ''))
        bad += bool(low or not aligns)
    return 1 if bad else 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1:]))
