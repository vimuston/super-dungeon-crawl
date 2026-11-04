"""Stand-in for the `crypt` module that Python 3.13 removed from the stdlib.

webtiles' userdb.py does `import crypt` / `crypt.crypt(word, salt)`. This file
is copied next to server.py by apply.sh, so it is found before the stdlib and
provides the one function webtiles needs through the system libcrypt (the same
C function the old stdlib module wrapped), on any Python version.
"""
import ctypes
import ctypes.util

_lib = None
for _name in (ctypes.util.find_library("crypt"), "libcrypt.so.1",
              "libcrypt.so.2", "libcrypt.so"):
    if not _name:
        continue
    try:
        _lib = ctypes.CDLL(_name)
        break
    except OSError:
        continue

if _lib is None:
    raise ImportError("crypt shim: libcrypt not found (install libcrypt1)")

_lib.crypt.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
_lib.crypt.restype = ctypes.c_char_p


def crypt(word, salt):
    """Like the old crypt.crypt(): returns the hash string, or None on error."""
    if isinstance(word, str):
        word = word.encode("utf-8")
    if isinstance(salt, str):
        salt = salt.encode("utf-8")
    res = _lib.crypt(word, salt)
    return res.decode("ascii") if res else None
