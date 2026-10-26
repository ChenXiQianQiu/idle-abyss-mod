# -*- coding: utf-8 -*-
"""把 src/IdleAbyssMod 注入游戏的 resources/app.asar。

这个游戏是 Electron 应用（没有 Unity / BepInEx），渲染层就是一个普通网页，
全部代码都在 resources/app.asar 里的 web/ 目录。所以 Mod 的做法是：
    解出 asar → 覆盖 Mod 文件 → 在 index.html 末尾挂上 Mod 脚本 → 重新打包

用法：
    python scripts/mod_build.py            # 只生成 build/app.asar
    python scripts/mod_build.py --install  # 生成并直接安装到游戏目录（自动备份）
    python scripts/mod_build.py --restore  # 用备份还原原始 app.asar
"""
import hashlib
import json
import os
import shutil
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASAR = os.path.join(ROOT, "resources", "app.asar")
ASAR_BAK = os.path.join(ROOT, "resources", "app.asar.orig")
MOD_SRC = os.path.join(ROOT, "src", "IdleAbyssMod", "web")
BUILD_DIR = os.path.join(ROOT, "build")
OUT = os.path.join(BUILD_DIR, "app.asar")

# 加载顺序即依赖顺序：工具层 → 各功能页 → 面板外壳 → 启动
MOD_JS = [
    "js/mod/mod_util.js",
    "js/mod/mod_resources.js",
    "js/mod/mod_equip.js",
    "js/mod/mod_progress.js",
    "js/mod/mod_panel.js",
    "js/mod/mod_boot.js",
]
MOD_CSS = ["css/mod_panel.css"]
BLOCK_BEGIN = "<!-- ===== IAP Mod begin ====="
BLOCK_END = "<!-- ===== IAP Mod end ===== -->"


def align4(n):
    return (n + 3) & ~3


def read_asar(path):
    with open(path, "rb") as f:
        raw = f.read()
    first, header_size = struct.unpack_from("<II", raw, 0)
    if first != 4:
        raise ValueError("不是有效的 asar 文件：首字段应为 4，实际 %r" % first)
    _, json_len = struct.unpack_from("<II", raw, 8)
    header = json.loads(raw[16:16 + json_len].decode("utf-8"))
    data_start = 8 + header_size
    return header, raw, data_start


def flatten(node, prefix=""):
    """按原顺序产出 (相对路径, info, 数据或 None)。unpacked 文件不读数据。"""
    out = []
    for name, info in (node.get("files") or {}).items():
        rel = (prefix + "/" + name) if prefix else name
        if "files" in info:
            out.extend(flatten(info, rel))
        else:
            out.append((rel, info, None))
    return out


def integrity_of(data):
    return {
        "algorithm": "SHA256",
        "hash": hashlib.sha256(data).hexdigest(),
        "blockSize": 4194304,
        "blocks": [hashlib.sha256(data).hexdigest()],
    }


def inject_html(html):
    # 幂等：先摘掉上一次注入的整段
    if BLOCK_BEGIN in html:
        i = html.index(BLOCK_BEGIN)
        j = html.find(BLOCK_END, i)
        if j >= 0:
            html = html[:i] + html[j + len(BLOCK_END):]
    lines = [BLOCK_BEGIN + " 深渊调试台（改动即时写档，F1 开关） -->"]
    lines += ['<link rel="stylesheet" href="%s">' % f for f in MOD_CSS]
    lines += ['<script src="%s"></script>' % f for f in MOD_JS]
    lines.append(BLOCK_END)
    block = "\n".join(lines)
    if "</body>" not in html:
        raise ValueError("index.html 里没有 </body>，无法注入")
    return html.replace("</body>", block + "\n</body>")


def build():
    header, raw, data_start = read_asar(ASAR)
    entries = flatten(header)
    files = {}          # 相对路径 -> {"info": dict, "data": bytes}
    order = []
    for rel, info, _ in entries:
        data = None
        if not info.get("unpacked"):
            off, size = int(info["offset"]), int(info["size"])
            data = raw[data_start + off: data_start + off + size]
        files[rel] = {"info": dict(info), "data": data}
        order.append(rel)

    # 1) 覆盖 / 新增 Mod 文件
    added = []
    for rel_mod in (MOD_JS + MOD_CSS):
        src = os.path.join(MOD_SRC, rel_mod.replace("/", os.sep))
        if not os.path.isfile(src):
            raise SystemExit("缺少 Mod 文件：%s" % src)
        with open(src, "rb") as f:
            data = f.read()
        key = "web/" + rel_mod
        if key not in files:
            added.append(key)
            order.append(key)
        files[key] = {"info": {}, "data": data}

    # 2) 注入 index.html
    key = "web/index.html"
    if key not in files or files[key]["data"] is None:
        raise SystemExit("asar 里找不到 web/index.html")
    html = files[key]["data"].decode("utf-8")
    new_html = inject_html(html).encode("utf-8")
    files[key]["data"] = new_html

    # 3) 重新分配 offset 并算 integrity（只重算内容变过的文件）
    blob = bytearray()
    for rel in order:
        item = files[rel]
        info = item["info"]
        if info.get("unpacked"):
            continue
        data = item["data"]
        info["offset"] = str(len(blob))
        info["size"] = len(data)
        info["integrity"] = integrity_of(data)
        blob.extend(data)

    # 4) 拼回目录树（保持原顺序 + 新增文件追加到末尾）
    tree = {}

    def node_for(path_parts):
        cur = tree
        for p in path_parts[:-1]:
            nxt = cur.get(p)
            if nxt is None:
                nxt = cur[p] = {"files": {}}
            cur = nxt["files"]
        return cur

    for rel in order:
        parts = rel.split("/")
        parent = node_for(parts)
        parent[parts[-1]] = files[rel]["info"]

    payload = json.dumps({"files": tree}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    json_len = len(payload)
    header_size = align4(8 + json_len)
    pad = header_size - 8 - json_len
    head = struct.pack("<IIII", 4, header_size, header_size - 4, json_len) + payload + b"\x00" * pad

    os.makedirs(BUILD_DIR, exist_ok=True)
    with open(OUT, "wb") as f:
        f.write(head)
        f.write(bytes(blob))

    # 5) 自检：重新读一遍，确认能解析、关键文件在、内容正确
    h2, raw2, ds2 = read_asar(OUT)
    check = {}
    for rel, info, _ in flatten(h2):
        if not info.get("unpacked"):
            off, size = int(info["offset"]), int(info["size"])
            check[rel] = raw2[ds2 + off: ds2 + off + size]
    assert BLOCK_BEGIN in check["web/index.html"].decode("utf-8"), "注入失败"
    for rel in MOD_JS + MOD_CSS:
        assert ("web/" + rel) in check, "缺少 " + rel
    assert len(check) == len([r for r in order if not files[r]["info"].get("unpacked")]), "文件数不一致"

    print("已生成 %s（%.1f MB，文件 %d 个，新增 %d 个）"
          % (OUT, os.path.getsize(OUT) / 1048576.0, len(check), len(added)))
    for a in added:
        print("  + " + a)
    return OUT


def install():
    build()
    if not os.path.exists(ASAR_BAK):
        shutil.copy2(ASAR, ASAR_BAK)
        print("已备份原始 app.asar → %s" % ASAR_BAK)
    else:
        print("备份已存在，保留不动：%s" % ASAR_BAK)
    shutil.copy2(OUT, ASAR)
    print("已安装到 %s" % ASAR)


def restore():
    if not os.path.exists(ASAR_BAK):
        raise SystemExit("没有找到备份 %s，无法还原" % ASAR_BAK)
    shutil.copy2(ASAR_BAK, ASAR)
    print("已还原原始 app.asar")


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    if arg == "--install":
        install()
    elif arg == "--restore":
        restore()
    else:
        build()
