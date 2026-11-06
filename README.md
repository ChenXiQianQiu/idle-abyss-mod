# 深渊护肝台 · Idle Abyss Mod

《深渊放置姬 / Idle Abyss Princesses》的游戏内护肝面板 Mod，按 **F1** 打开 / 关闭，
所有改动即时写入存档。当前版本 **v1.7.0**，适配游戏 **3.0.3**。

v1.0.0 起改用游戏**自带的官方模组系统**（3.0.0 新增）：模组就是一个文件夹，放进
`%APPDATA%\IdleAbyssPrincesses\mods\` 就生效，**不再修改 `resources/app.asar`**，
也不需要 Python，游戏更新不会再把 Mod 冲掉。

> 仓库只包含 Mod 自己的源码与脚本，**不含任何游戏文件**。使用需要自备正版游戏。

## 安装

### 方式一：下载分享包（推荐）

到 [Releases](../../releases) 下载最新的 `IdleAbyssMod-v<版本>-share.zip`，解压到任意位置，
双击 `安装.bat` —— 它会把模组复制到 `%APPDATA%\IdleAbyssPrincesses\mods\`，
**第一次装模组、还没有 `mods` 文件夹的话它会自己新建一个**。
重启游戏，进角色界面后按 **F1**（或点顶栏的「护肝」按钮）。

> 附件名是英文的：GitHub 会把带中文的附件名丢掉，所以 Release 里叫
> `IdleAbyssMod-v<版本>-share.zip`，本地 `dist/` 里仍叫 `深渊护肝台-v<版本>-分享包.zip`，
> 两个是同一个包。

卸载双击 `卸载.bat`，或在游戏里「设置 → 模组」停用 / 删除。

### 方式二：从源码构建

```bash
python scripts/mod_build.py              # 只生成 build/mods/chenxi_abyss_debug/
python scripts/mod_build.py --install    # 生成并装到 %APPDATA%\IdleAbyssPrincesses\mods\
python scripts/mod_build.py --uninstall  # 从存档目录删掉
python scripts/mod_pack.py               # 打分享包到 dist/
```

## 功能

| 页签 | 内容 |
| --- | --- |
| 资源 | 金币 / 魂晶 / 余烬之魂 / 秘境钥匙 / 钥匙碎片 / 扭蛋券 / 强化祝福 / 王庭锭与碎片 / 最后的余烬 / 深渊结晶 / 蚀心·守心符·深渊之泪 / 宝石 |
| 装备 | 品质·上古·太古 / 物品等级 / 强化 / 基础数值 / 词缀（含「词缀全满」）/ 镶嵌 / 生成新装备（主线·王庭·奇物·神话）/ 神话仓库 / 深渊阶·腐化·绑定提示 / 灵器只读词条 / **深渊蚀刻**（蚀刻一次·回满次数·立即腐化·取消腐化·自选腐化词缀并显示效果·5 阶铭文自选·四个全局开关）/ **骊龙宝珠探骊**（必定成功·指定词条·已探骊可换词条·撤销探骊） |
| 进度 | 等级 / 巅峰 / 阶段 / 折磨档位 / 自由属性点 |
| 团本 | 单人必定掉落 / 无限掉落资格 / 女王稀世概率 / 本周资格面板 |
| 终焉 | 无限周奖励 / 终焉词条自选（升华与重选） |
| 营地 | 派遣立即完成 / 好感一键全满 |
| 秘境 | 100 层起必定神兽 / 150 层起必定真身 / 指定神兽 / 专属装备必出 / 专属称号必出 / 神话仓库件数 |
| 炼妖壶 | **仅 DLC《炼妖壶》**（没买看不到这一页），三个子页签。**资源**：魂玉 / 朱砂 / 孟婆汤（可改）/ 残页每种 +1 / 妖魄每种 +10。**妖灵**：逐只改种族、品质、资质三项、成长、灵技（普通/高级）、秘技（八族 922 条，带效果说明）、收藏；资质 / 成长一键拉满；灵技标出实际数值；自带灵力填目标值反算成长；壶里的和灵器上的器灵都能改。**秘技图鉴**：922 条秘技 + 33 条词缀的效果全列出来，可搜索；顶部选好目标后，点每条秘技右边的「＋」直接加进那只的秘技表（再点「已有」去掉）。另有一键「未收录必收」：百妖谱里还没有的种族击杀必定收进壶（神兽 / 王庭 / 终焉 / 誓约之主的「魂」也算）。只做游戏做不到的事，炼妖壶窗口里已有的操作（收妖过滤、批量超度与炼妖、教程、幽冥、灵器页）不重复 |

完整说明见 [`share/Mod修改内容说明.md`](share/Mod修改内容说明.md)。

## 目录结构

```
src/IdleAbyssMod/        Mod 源码（唯一手写的部分，直接就是模组文件夹的内容）
  version.txt            版本号（构建时写进 mod.json）
  mod.json               模组清单：id / api 3 / lateScripts 加载顺序
  scripts/               注入页面的脚本，加载顺序见 mod_build.py 的 MOD_JS
  styles/mod_panel.css   面板样式（构建时转成内联 <style>，见下）
  preview.png            创意工坊封面（1280×720，构建时复制到模组根目录）
scripts/
  asar_extract.py        解包 app.asar（纯 Python，只用于读游戏代码）
  mod_build.py           构建 / 安装 / 卸载
  mod_pack.py            打分享包（dist/深渊护肝台-v<版本>-分享包.zip）
docs/                    代码索引与模块说明
share/                   对外说明文档
```

## 实现方式

游戏是 **Electron** 应用（不是 Unity，BepInEx / Cpp2IL 都用不上），全部逻辑在
`resources/app.asar` 里的 `web/` 目录，就是普通网页 + 经典脚本。

3.0.0 起游戏自带模组加载器（`web/js/mods.js` + `electron/mods.js`，见游戏包内
`docs/MODDING.md`），所以本 Mod 走官方通道：

- `mod.json` 里 `"api": 3` + `lateScripts`，脚本在**游戏脚本全部加载完、读档之前**执行，
  这时能包装全局函数、能读游戏的所有表；
- 命名空间是 **`window.IAPM`**。不能再用 `window.IAP` —— 游戏自己在
  `web/js/mod_api.js:262` 有顶层 `const IAP`（官方模组接口），同名会被词法绑定盖住；
- 样式只有一份真身 `styles/mod_panel.css`，构建时转成 `scripts/mod_styles.js` 注入内联
  `<style>`：页面 CSP 的 `style-src` 不含 `iapmod:`，外链模组样式会被拦；
- 面板入口挂到官方接口上：`IAP.ui.addPanel`（设置 → 模组里一个按钮）+
  `IAP.ui.addTopButton`（顶栏「护肝」），F1 仍由面板自己接管。

脚本一律 IIFE，不声明新全局；改数值时全部夹在游戏自己的公式区间内
（`affRange()` / `raidRollAff()` / `rollItem` 的 `rnd(.85, 1.15)`），拦截行为则包装 `window`
上的同名全局函数，开关关闭时原样转发。

## 注意

- Steam 是**可选**的：游戏在没有 Steam 的环境下照常运行，只是没有成就、云同步与联机团本。
- 这是「护肝类」代码模组：只要有一条**规则点**偏离默认值，Steam 成就就会暂停
  （游戏自己的规则，见 `docs/MODDING.md` 14.3）。纯改数值 / 改装备不碰规则点。
- 联机（Steam 团本）时建议关掉相关开关，免得数据不同步。改存档前请自行备份
  `%APPDATA%/IdleAbyssPrincesses/`。
