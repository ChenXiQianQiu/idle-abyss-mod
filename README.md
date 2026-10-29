# 深渊调试台 · Idle Abyss Mod

《深渊放置姬 / Idle Abyss Princesses》的游戏内调试面板 Mod，按 **F1** 打开 / 关闭，
所有改动即时写入存档。当前版本 **v0.7.0**，适配游戏 2.4.1（传奇秘境 / 神话装备 / 神话仓库）。

> 仓库只包含 Mod 自己的源码与脚本，**不含任何游戏文件**。使用需要自备正版游戏。

## 安装

### 方式一：下载分享包（推荐）

到 [Releases](../../releases) 下载 `深渊调试台-v0.7.0-分享包.zip`，解压到**游戏根目录**
（能看到 `IdleAbyssPrincesses.exe` 和 `resources` 文件夹的那一层），双击 `安装.bat`。
需要本机有 Python 3。装完启动游戏即可（Steam 版从库里启动，其他版本直接运行 exe 也行）。

卸载双击 `还原.bat`，或在 Steam 里「验证文件完整性」。

### 方式二：从源码构建

```bash
python scripts/mod_build.py            # 只生成 build/app.asar
python scripts/mod_build.py --install  # 生成并安装（首次自动备份 resources/app.asar.orig）
python scripts/mod_build.py --restore  # 还原原版
```

## 功能

| 页签 | 内容 |
| --- | --- |
| 资源 | 金币 / 魂晶 / 余烬之魂 / 秘境钥匙 / 钥匙碎片 / 扭蛋券 / 强化祝福 / 王庭锭与碎片 / 最后的余烬 / 深渊结晶 / 宝石 |
| 装备 | 品质·上古·太古 / 物品等级 / 强化 / 基础数值 / 词缀（含「词缀全满」）/ 镶嵌 / 生成新装备（主线·王庭·奇物·神话）/ 神话仓库 |
| 进度 | 等级 / 巅峰 / 阶段 / 折磨档位 / 自由属性点 |
| 团本 | 单人必定掉落 / 无限掉落资格 / 女王稀世概率 / 本周资格面板 |
| 终焉 | 无限周奖励 / 终焉词条自选（升华与重选） |
| 营地 | 派遣立即完成 / 好感一键全满 |
| 秘境 | 100 层起必定神兽 / 150 层起必定真身 / 指定神兽 / 专属装备必出 / 专属称号必出 / 神话仓库件数 |

完整说明见 [`share/Mod修改内容说明.md`](share/Mod修改内容说明.md)。

## 目录结构

```
src/IdleAbyssMod/        Mod 源码（唯一手写的部分）
  version.txt            版本号
  web/js/mod/            注入到 web/js/mod/ 的脚本，加载顺序见 mod_build.py 的 MOD_JS
  web/css/               注入到 web/css/ 的样式
scripts/
  asar_extract.py        解包 app.asar（纯 Python）
  mod_build.py           构建 / 安装 / 还原
  mod_pack.py            打分享包（dist/深渊调试台-v<版本>-分享包.zip）
docs/                    代码索引与模块说明
share/                   对外说明文档
```

## 实现方式

游戏是 **Electron** 应用（不是 Unity，BepInEx / Cpp2IL 都用不上），全部逻辑在
`resources/app.asar` 里的 `web/` 目录，就是普通网页 + 经典脚本。所以 Mod 的做法是：

解包 asar → 覆盖 Mod 文件 → 在 `index.html` 的 `</body>` 前挂上 `<script>` → 重新打包。

脚本一律 IIFE + `window.IAP`，不声明新全局；改数值时全部夹在游戏自己的公式区间内
（`affRange()` / `raidRollAff()` / `rollItem` 的 `rnd(.85, 1.15)`），拦截行为则包装 `window`
上的同名全局函数，开关关闭时原样转发。

## 注意

- Steam 是**可选**的：游戏在没有 Steam 的环境下照常运行，只是没有成就、云同步与联机团本。
- Steam 校验或游戏更新会覆盖 `app.asar`，Mod 消失，重新跑一次安装即可。
- 联机（Steam 团本）时建议关掉相关开关，免得数据不同步。改存档前请自行备份
  `%APPDATA%/IdleAbyssPrincesses/`。
