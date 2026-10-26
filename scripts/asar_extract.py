# -*- coding: utf-8 -*-
"""asar 解包脚本（纯 Python 实现，避免额外依赖）。
用法: python scripts/asar_extract.py <app.asar> <输出目录>
"""
import json
import os
import struct
import sys


def read_asar(path):
    with open(path, "rb") as f:
        raw = f.read()
    # 头部结构: [uint32=4][uint32=headerSize][uint32=headerSize-4][uint32=jsonLen][json]
    a, header_size = struct.unpack_from("<II", raw, 0)
    c, json_len = struct.unpack_from("<II", raw, 8)
    header = json.loads(raw[16:16 + json_len].decode("utf-8"))
    data_start = 8 + header_size
    return header, raw, data_start


def walk(node, prefix, raw, data_start, out_dir):
    files = node.get("files") or {}
    for name, info in files.items():
        rel = os.path.join(prefix, name) if prefix else name
        if "files" in info:
            walk(info, rel, raw, data_start, out_dir)
            continue
        if info.get("unpacked"):
            continue
        size = int(info.get("size", 0))
        offset = int(info.get("offset", 0))
        target = os.path.join(out_dir, rel)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as f:
            f.write(raw[data_start + offset: data_start + offset + size])


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    asar_path, out_dir = sys.argv[1], sys.argv[2]
    header, raw, data_start = read_asar(asar_path)
    os.makedirs(out_dir, exist_ok=True)
    walk(header, "", raw, data_start, out_dir)
    print("已解包到:", out_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
