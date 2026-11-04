# -*- coding: utf-8 -*-
"""构建 / 安装「深渊护肝台」—— 官方模组包（游戏 3.0.0 起的模组系统）。

3.0.0 起游戏自带模组加载器，不再需要改 `resources/app.asar`：
一个模组就是一个文件夹（mod.json + 脚本 + 样式），放进

    %APPDATA%\\IdleAbyssPrincesses\\mods\\<模组 id>\\

游戏开机时自己扫描加载（docs/MODDING.md「一、安装与加载」）。

用法：
    python scripts/mod_build.py              # 只生成 build/mods/<id>/
    python scripts/mod_build.py --install    # 生成并安装到存档目录的 mods/
    python scripts/mod_build.py --uninstall  # 从存档目录删掉已安装的模组

约定：
    · 源码在 src/IdleAbyssMod/：mod.json（模板）、scripts/、styles/、version.txt；
    · 样式只有一份真身 styles/mod_panel.css，构建时转成 scripts/mod_styles.js
      —— 页面的 CSP 是 `style-src 'self' file: 'unsafe-inline'`，不含 iapmod:，
        所以 <link href="iapmod://..."> 会被拦，只能注入内联 <style>；
    · 版本号以 version.txt 为准，构建时写进 mod.json。
"""
import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOD_SRC = os.path.join(ROOT, "src", "IdleAbyssMod")
VER_FILE = os.path.join(MOD_SRC, "version.txt")
BUILD_DIR = os.path.join(ROOT, "build", "mods")

STYLE_SRC = os.path.join(MOD_SRC, "styles", "mod_panel.css")
STYLE_JS = "mod_styles.js"

# 加载顺序即依赖顺序：工具层 → 各功能页 → 面板外壳 → 启动（样式最先）
MOD_JS = [
    "mod_util.js",
    "mod_resources.js",
    "mod_equip.js",
    "mod_etch.js",
    "mod_pearl.js",
    "mod_progress.js",
    "mod_raid.js",
    "mod_ultra.js",
    "mod_camp.js",
    "mod_myth.js",
    "mod_yao.js",
    "mod_panel.js",
    "mod_boot.js",
]


def read_version():
    with open(VER_FILE, "r", encoding="utf-8") as f:
        return f.read().strip()


def mods_dir():
    """游戏的本地模组目录：%APPDATA%\\IdleAbyssPrincesses\\mods。"""
    base = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Roaming")
    return os.path.join(base, "IdleAbyssPrincesses", "mods")


def style_js(css):
    """把 CSS 包成一个注入 <style> 的脚本（内联样式不受 CSP 的 style-src 限制）。"""
    body = json.dumps(css, ensure_ascii=False)
    return (
        "'use strict';\n"
        "/* 自动生成，不要手改：源文件是 src/IdleAbyssMod/styles/mod_panel.css，\n"
        "   由 scripts/mod_build.py 转成内联 <style>（页面的 style-src 不含 iapmod:）。*/\n"
        "(function () {\n"
        "  if (document.getElementById('iap-styles')) return;\n"
        "  const st = document.createElement('style');\n"
        "  st.id = 'iap-styles';\n"
        "  st.textContent = %s;\n"
        "  document.head.appendChild(st);\n"
        "})();\n" % body
    )


def build():
    with open(os.path.join(MOD_SRC, "mod.json"), "r", encoding="utf-8") as f:
        man = json.load(f)
    ver = read_version()
    man["version"] = ver
    mod_id = man["id"]
    out = os.path.join(BUILD_DIR, mod_id)

    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(os.path.join(out, "scripts"))

    # 1) 脚本
    for name in MOD_JS:
        src = os.path.join(MOD_SRC, "scripts", name)
        if not os.path.isfile(src):
            raise SystemExit("缺少脚本：%s" % src)
        shutil.copy2(src, os.path.join(out, "scripts", name))

    # 2) 样式 → 内联脚本
    with open(STYLE_SRC, "r", encoding="utf-8") as f:
        css = f.read()
    with open(os.path.join(out, "scripts", STYLE_JS), "w", encoding="utf-8") as f:
        f.write(style_js(css))

    # 3) mod.json（版本号以 version.txt 为准）
    with open(os.path.join(out, "mod.json"), "w", encoding="utf-8") as f:
        json.dump(man, f, ensure_ascii=False, indent=2)
        f.write("\n")

    check(out, man)
    print("已生成：%s（v%s，%d 个脚本 + 1 个样式）" % (out, ver, len(MOD_JS)))
    return out, man


def check(out, man):
    """构建自检：脚本齐全、mod.json 合法、没有残留的旧命名空间。"""
    for rel in man.get("lateScripts") or []:
        p = os.path.join(out, rel)
        if not os.path.isfile(p):
            raise SystemExit("自检失败：lateScripts 里的 %s 不存在" % rel)
    with open(os.path.join(out, "mod.json"), "r", encoding="utf-8") as f:
        again = json.load(f)
    if again.get("version") != man.get("version"):
        raise SystemExit("自检失败：mod.json 版本没写进去")
    for name in MOD_JS:
        with open(os.path.join(out, "scripts", name), "r", encoding="utf-8") as f:
            text = f.read()
        if "window.IAP =" in text or "window.IAP=" in text:
            raise SystemExit("自检失败：%s 还在占用 window.IAP（3.0.0 起那是官方接口，必须用 IAPM）" % name)
        if "window.IAPM" not in text:
            raise SystemExit("自检失败：%s 没找到 window.IAPM 命名空间" % name)
    if len(again["lateScripts"]) != len(MOD_JS) + 1:
        raise SystemExit("自检失败：lateScripts 数量对不上（应为脚本数 + 样式）")


def install(out, man):
    dest = os.path.join(mods_dir(), man["id"])
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copytree(out, dest)
    print("已安装：%s" % dest)
    print("提示：模组在游戏开机时加载，装完要重启游戏才生效。")
    return dest


def uninstall(mod_id):
    dest = os.path.join(mods_dir(), mod_id)
    if not os.path.isdir(dest):
        print("没有安装：%s" % dest)
        return False
    shutil.rmtree(dest)
    print("已卸载：%s" % dest)
    return True


def main():
    args = sys.argv[1:]
    out, man = build()
    if "--install" in args:
        install(out, man)
    elif "--uninstall" in args:
        uninstall(man["id"])
    else:
        print("只构建，没安装。加 --install 装到存档目录的 mods/ 里。")


if __name__ == "__main__":
    main()
