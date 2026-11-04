# -*- coding: utf-8 -*-
"""打分享包：把构建好的官方模组文件夹 + 一键安装批处理压成 zip。

游戏 3.0.0 起有官方模组系统，模组就是一个文件夹，放进
    %APPDATA%\\IdleAbyssPrincesses\\mods\\<模组 id>\\
就生效 —— 不用改 app.asar，不用 Python，也不再挑游戏版本。

所以分享包的结构是：
    chenxi_abyss_debug/        模组本体（mod.json + scripts/）
    安装.bat                   复制到 %APPDATA% 的 mods 目录
    卸载.bat                   从 mods 目录删掉
    安装说明.txt               纯文本说明

用法：
    python scripts/mod_pack.py     # 生成 dist/深渊调试台-v<版本>-分享包.zip
"""
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import mod_build  # noqa: E402  复用构建脚本，保证包里的内容和 build/ 一致

MOD_DIR = os.path.join(ROOT, "src", "IdleAbyssMod")
VER_FILE = os.path.join(MOD_DIR, "version.txt")
DIST = os.path.join(ROOT, "dist")

INSTALL_BAT = r"""@echo off
chcp 936 >nul
setlocal
title 深渊调试台 安装
cd /d "%~dp0"

echo ============================================
echo   深渊调试台（深渊放置姬 官方模组包）
echo ============================================
echo.

set "DEST=%APPDATA%\IdleAbyssPrincesses\mods\{id}"

if not exist "%APPDATA%\IdleAbyssPrincesses" (
  echo [错误] 找不到 %APPDATA%\IdleAbyssPrincesses
  echo.
  echo 请先启动一次游戏（进到标题页就行），让它建好存档目录，再回来双击本文件。
  echo.
  pause
  exit /b 1
)

tasklist /fi "imagename eq IdleAbyssPrincesses.exe" 2>nul | find /i "IdleAbyssPrincesses.exe" >nul
if not errorlevel 1 (
  echo [提示] 游戏正在运行。装完请重启游戏，模组才会加载。
  echo.
)

if exist "%DEST%" (
  echo 发现旧版本，正在替换...
  rmdir /s /q "%DEST%"
)

xcopy /e /i /y "{id}" "%DEST%" >nul
if errorlevel 1 (
  echo [失败] 复制失败。请确认游戏已完全退出（托盘图标也要退出）后重试。
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   安装完成
echo   重启游戏后按 F1（或点顶栏「调试」）打开面板
echo ============================================
echo.
pause
"""

UNINSTALL_BAT = r"""@echo off
chcp 936 >nul
title 深渊调试台 卸载
set "DEST=%APPDATA%\IdleAbyssPrincesses\mods\{id}"

if not exist "%DEST%" (
  echo 没有安装：%DEST%
  echo.
  pause
  exit /b 0
)

rmdir /s /q "%DEST%"
echo 已卸载。重启游戏后调试台就没了（存档里的角色数据不受影响）。
echo.
pause
"""

INSTALL_TXT = """深渊调试台 v{ver}
《深渊放置姬 / Idle Abyss Princesses》游戏内调试面板

按 F1 打开 / 关闭，也可以点顶栏的「调试」按钮，或从
设置 → 模组 → 深渊调试台 里打开。所有改动立刻写进存档。


一、安装（约 10 秒，不需要 Python）
------------------------------------------------------------
1. 先启动一次游戏（进到标题页就行），让它建好存档目录，然后完全退出
2. 双击 安装.bat
   它会把这个文件夹复制到
     %APPDATA%\\IdleAbyssPrincesses\\mods\\{id}\\
3. 重新启动游戏，进到角色界面后按 F1

也可以手动装：把 {id} 整个文件夹复制到上面那个 mods 目录里，效果一样。


二、卸载
------------------------------------------------------------
双击 卸载.bat，或者在游戏里「设置 → 模组」把这个模组停用 / 删除。
删掉模组不会影响存档；存档里模组留下的数据会原样保留，重装还能接着用。


三、注意
------------------------------------------------------------
· 模组在游戏开机时加载，装完 / 改完都要重启游戏才生效。
· 这是「护肝类」代码模组：它直接读写你的本机存档，装之前建议备份
  %APPDATA%\\IdleAbyssPrincesses\\（save.json、account.json 都在里面）。
  游戏自己也会在首次加载新模组前自动备份一份到 backups\\mods\\。
· 联机（Steam 团本 / 最后的最后）时建议先关掉相关开关，免得数据不同步。
· 游戏大版本更新后，个别页签可能读不到新字段（面板会显示「渲染失败」），
  去 GitHub 看有没有新版本。


四、面板页签
------------------------------------------------------------
资源  金币 / 魂晶 / 余烬之魂 / 秘境钥匙 / 钥匙碎片 / 扭蛋券 / 强化祝福 /
      王庭锭与碎片 / 最后的余烬 / 深渊结晶 / 宝石
装备  品质·上古·太古 / 物品等级 / 强化 / 基础数值 / 词缀（含「词缀全满」）/
      镶嵌 / 生成新装备（主线·王庭·奇物·神话）/ 神话仓库
进度  等级 / 巅峰 / 阶段 / 折磨档位 / 自由属性点
团本  单人必定掉落 / 无限掉落资格 / 本周资格面板
终焉  超高难本周奖励 / 终焉词条自选（升华与重选）
营地  派遣立即完成 / 好感一键全满
秘境  100 层起必定神兽 / 150 层起必定真身 / 指定神兽 /
      专属装备必出 / 专属称号必出 / 神话仓库件数
深渊  誓约深度 / 蚀刻（必定成功、自选铭文、立即腐化）/ 灵器 / 探骊


五、按 F1 没反应？
------------------------------------------------------------
1. 确认按的是 F1（部分笔记本要按 Fn + F1），或者点顶栏「调试」按钮
2. 打开日志 %APPDATA%\\IdleAbyssPrincesses\\logs\\main.log，搜 IAPM
   有「[IAPM] 深渊调试台 v{ver} loaded」说明模组已加载；
   没有就是没装上，或者被安全模式跳过了
3. 游戏崩过一次之后会自动进安全模式（不加载模组）：
   正常退出再启动一次就好，也可以在 Steam 启动选项里去掉 --no-mods
4. 还是不行：设置 → 模组 里看这个模组有没有报错
"""


def read_version():
    with open(VER_FILE, "r", encoding="utf-8") as f:
        return f.read().strip()


def pack():
    ver = read_version()
    out_dir, man = mod_build.build()          # 先构建，保证包里是最新代码
    mod_id = man["id"]
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, "深渊调试台-v%s-分享包.zip" % ver)
    if os.path.exists(out):
        os.remove(out)

    files = []
    for base, _, names in os.walk(out_dir):
        for n in names:
            p = os.path.join(base, n)
            files.append((os.path.join(mod_id, os.path.relpath(p, out_dir)).replace(os.sep, "/"), p))

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr("安装.bat", INSTALL_BAT.format(id=mod_id).replace("\n", "\r\n").encode("gbk"))
        z.writestr("卸载.bat", UNINSTALL_BAT.format(id=mod_id).replace("\n", "\r\n").encode("gbk"))
        # 说明用 UTF-8 BOM + CRLF：老版本记事本也能正常显示中文
        z.writestr("安装说明.txt",
                   b"\xef\xbb\xbf" + INSTALL_TXT.format(ver=ver, id=mod_id).replace("\n", "\r\n").encode("utf-8"))
        for arc, path in files:
            z.write(path, arc)

    # 自检：包内必须有 mod.json，且 lateScripts 里列到的脚本都在
    with zipfile.ZipFile(out) as z:
        names = set(z.namelist())
        need = {"安装.bat", "卸载.bat", "安装说明.txt", "%s/mod.json" % mod_id}
        for rel in man.get("lateScripts") or []:
            need.add("%s/%s" % (mod_id, rel))
        lack = sorted(need - names)
        assert not lack, "分享包缺文件：%s" % lack
        assert z.testzip() is None, "压缩包校验失败"

    size = os.path.getsize(out)
    print("已生成 %s（%.1f KB，%d 个文件）" % (out, size / 1024.0, len(names)))
    return out


if __name__ == "__main__":
    pack()
