# -*- coding: utf-8 -*-
"""打分享包：把 Mod 源码 + 构建脚本 + 一键安装批处理压成 zip。

分享包**不含游戏本体文件**（不打包 app.asar），对方解压到自己游戏根目录后运行
`安装.bat`，脚本会在对方机器上用他自己的 `resources/app.asar` 现场注入，
因此不受游戏版本差异影响，也不会把游戏资源二次分发出去。

用法：
    python scripts/mod_pack.py            # 生成 dist/深渊调试台-v<版本>-分享包.zip
    python scripts/mod_pack.py --asar     # 额外把 build/app.asar 也塞进包里（约 100MB，不推荐）
"""
import os
import shutil
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import mod_build  # noqa: E402  复用 MOD_JS / MOD_CSS / 版本文件路径，避免两份清单

MOD_DIR = os.path.join(ROOT, "src", "IdleAbyssMod")
VER_FILE = os.path.join(MOD_DIR, "version.txt")
DIST = os.path.join(ROOT, "dist")
SHARE_DOC = os.path.join(ROOT, "share", "Mod修改内容说明.md")

INSTALL_BAT = r"""@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
title 深渊调试台 安装
cd /d "%~dp0"

echo ============================================
echo   深渊调试台（Idle Abyss Princesses Mod）
echo ============================================
echo.

if not exist "resources\app.asar" (
  echo [错误] 当前目录找不到 resources\app.asar
  echo.
  echo 请把压缩包里的文件解压到游戏根目录，也就是能看到
  echo   IdleAbyssPrincesses.exe
  echo 的那个文件夹，然后再双击本文件。
  echo.
  pause
  exit /b 1
)
if not exist "IdleAbyssPrincesses.exe" (
  echo [提示] 这个目录里没有 IdleAbyssPrincesses.exe，请确认解压位置是否正确。
  echo.
  pause
)

tasklist /fi "imagename eq IdleAbyssPrincesses.exe" 2>nul | find /i "IdleAbyssPrincesses.exe" >nul
if not errorlevel 1 (
  echo [错误] 游戏正在运行，请先完全退出游戏（托盘图标也要退出）再安装。
  echo.
  pause
  exit /b 1
)

set "PY="
python -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY=python"
if not defined PY (
  py -3 -c "import sys" >nul 2>&1
  if not errorlevel 1 set "PY=py -3"
)
if not defined PY (
  echo [错误] 没有找到 Python。
  echo.
  echo 本安装器需要 Python 3（一次性装好即可）：
  echo   1. 打开 https://www.python.org/downloads/
  echo   2. 下载 Windows 版并安装，安装第一步务必勾选 "Add python.exe to PATH"
  echo   3. 装完关掉这个窗口，重新双击 安装.bat
  echo.
  pause
  exit /b 1
)

echo 正在注入 Mod（首次会自动备份原始 app.asar 为 app.asar.orig）...
echo.
%PY% scripts\mod_build.py --install
if errorlevel 1 (
  echo.
  echo [失败] 注入没有完成，请把上面的报错发给我。
  pause
  exit /b 1
)

echo.
echo ============================================
echo   安装完成
echo   进入游戏后按 F1 打开 / 关闭调试面板
echo   记得通过 Steam 启动游戏
echo ============================================
echo.
pause
"""

RESTORE_BAT = r"""@echo off
chcp 936 >nul
title 深渊调试台 还原
cd /d "%~dp0"

if not exist "resources\app.asar.orig" (
  echo [错误] 没有找到备份 resources\app.asar.orig，无法自动还原。
  echo 可以在 Steam 里对游戏「验证文件完整性」恢复原版。
  echo.
  pause
  exit /b 1
)

tasklist /fi "imagename eq IdleAbyssPrincesses.exe" 2>nul | find /i "IdleAbyssPrincesses.exe" >nul
if not errorlevel 1 (
  echo [错误] 游戏正在运行，请先完全退出游戏再还原。
  echo.
  pause
  exit /b 1
)

echo 正在还原原始 app.asar ...
python scripts\mod_build.py --restore 2>nul
if errorlevel 1 py -3 scripts\mod_build.py --restore
echo.
echo 已还原，游戏回到未装 Mod 的状态。
echo.
pause
"""

README = """# 深渊调试台 v{ver} · 安装说明

《深渊放置姬 / Idle Abyss Princesses》的游戏内调试面板，按 **F1** 开关。
所有改动**即时写入存档**，改完直接玩就行，不需要重启游戏。

## 一、安装（约 1 分钟）

1. **先完全退出游戏**（包括右下角托盘里的图标）。
2. 把压缩包里的所有文件解压到**游戏根目录** —— 就是能看到
   `IdleAbyssPrincesses.exe` 和 `resources` 文件夹的那个目录。
   - Steam 库 → 右键游戏 → 管理 → 浏览本地文件，可以直接打开这个目录。
3. 双击 **`安装.bat`**，等它跑完看到「安装完成」。
4. **通过 Steam 启动游戏**（直接双击 exe 会因为 Steam 初始化失败而闪退，这不是 Mod 的问题）。
5. 进入游戏后按 **F1** 打开面板。

> 安装器需要 **Python 3**（一次性装好即可）。没装的话 `安装.bat` 会提示下载地址，
> 安装时记得勾选 `Add python.exe to PATH`。

## 二、卸载 / 还原

- 双击 **`还原.bat`**，会用安装时自动备份的 `resources/app.asar.orig` 还原原版；
- 或者在 Steam 里对游戏「验证文件完整性」，效果一样（会顺便覆盖掉 Mod）。

## 三、注意

- **Steam 校验或游戏更新会覆盖 `app.asar`**，Mod 会消失，重新跑一次 `安装.bat` 即可。
- 这个包**不包含任何游戏文件**，注入时用的是你自己机器上的 `resources/app.asar`，
  所以不绑定具体游戏版本；但游戏大版本更新后 Mod 可能失效，等新版本再装即可。
- 分享包只动了 `resources/app.asar` 里的 `web/` 部分（新增 Mod 脚本 + 在 `index.html`
  末尾挂一行 `<script>`），不碰存档格式。装之前建议顺手备份一下
  `%APPDATA%/IdleAbyssPrincesses/`（`save.json`、`account.json` 都在里面）。
- 单人可用；联机（Steam 联机团本）时建议关掉相关开关，免得数据不同步。

## 四、功能一览

完整功能说明见包内 `Mod修改内容说明.md`，这里只列面板页签：

| 页签 | 干什么 |
| --- | --- |
| 资源 | 金币 / 魂晶 / 余烬之魂 / 秘境钥匙 / 扭蛋券 / 强化祝福 / 王庭锭与碎片 / 最后的余烬 / 宝石 |
| 装备 | 改品质·上古·太古、物品等级、强化、基础数值、词缀（含「词缀全满」）、镶嵌、生成新装备（主线 / 王庭 / 奇物 / 神话） |
| 进度 | 等级 / 巅峰 / 阶段 / 折磨档位 / 自由属性点 |
| 团本 | 单人必定掉落、无限掉落资格、本周资格面板 |
| 终焉 | 超高难本周奖励、终焉词条自选 |
| 营地 | 派遣立即完成、好感一键全满 |
| 秘境 | 必定神兽 / 必定真身、指定神兽、掉落保底 |

## 五、装完没反应？

1. 确认是按 `F1`（部分笔记本要按 `Fn + F1`）。
2. 看日志 `%APPDATA%/IdleAbyssPrincesses/logs/main.log`，搜 `[IAP]`：
   有 `[IAP] 深渊调试台 v{ver} loaded` 说明 Mod 已加载；没有就是没注入成功，重跑 `安装.bat`。
3. 确认游戏是**从 Steam 启动**的。
"""


def read_version():
    with open(VER_FILE, "r", encoding="utf-8") as f:
        return f.read().strip()


def collect():
    """返回 [(包内路径, 本地绝对路径)]，顺序即写入顺序。"""
    items = []
    items.append(("安装.bat", None))
    items.append(("还原.bat", None))
    items.append(("安装说明.md", None))
    items.append(("Mod修改内容说明.md", SHARE_DOC))
    for rel in ("scripts/mod_build.py", "scripts/asar_extract.py"):
        items.append((rel, os.path.join(ROOT, rel.replace("/", os.sep))))
    items.append(("src/IdleAbyssMod/version.txt", VER_FILE))
    for rel in mod_build.MOD_JS + mod_build.MOD_CSS:
        items.append(("src/IdleAbyssMod/web/" + rel,
                      os.path.join(MOD_DIR, "web", rel.replace("/", os.sep))))
    return items


def pack(with_asar=False):
    ver = read_version()
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, "深渊调试台-v%s-分享包.zip" % ver)
    if os.path.exists(out):
        os.remove(out)

    items = collect()
    missing = [p for _, p in items if p and not os.path.isfile(p)]
    if missing:
        raise SystemExit("缺少文件：\n  " + "\n  ".join(missing))

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr("安装.bat", INSTALL_BAT.replace("\n", "\r\n").encode("gbk"))
        z.writestr("还原.bat", RESTORE_BAT.replace("\n", "\r\n").encode("gbk"))
        z.writestr("安装说明.md", README.format(ver=ver).replace("\n", "\r\n").encode("utf-8"))
        for arc, path in items:
            if path is None:
                continue
            z.write(path, arc)
        if with_asar:
            asar = os.path.join(ROOT, "build", "app.asar")
            if not os.path.isfile(asar):
                raise SystemExit("没有 build/app.asar，先跑一次 python scripts/mod_build.py")
            z.write(asar, "app.asar")

    # 自检：解压目录里必须能找到安装器依赖的东西
    with zipfile.ZipFile(out) as z:
        names = set(z.namelist())
        need = {"安装.bat", "还原.bat", "安装说明.md", "scripts/mod_build.py",
                "src/IdleAbyssMod/version.txt"}
        need |= {"src/IdleAbyssMod/web/" + r for r in mod_build.MOD_JS + mod_build.MOD_CSS}
        lack = sorted(need - names)
        assert not lack, "分享包缺文件：%s" % lack
        assert z.testzip() is None, "压缩包校验失败"

    size = os.path.getsize(out)
    print("已生成 %s（%.1f KB，%d 个文件）" % (out, size / 1024.0, len(names)))
    if with_asar:
        print("  ！包含完整 app.asar，体积约 100MB，且会随游戏版本失效")
    return out


if __name__ == "__main__":
    pack(with_asar="--asar" in sys.argv[1:])
