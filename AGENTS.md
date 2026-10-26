## 基本规则

- 始终使用中文回答；新增注释、运行日志、配置描述、文档和提交说明默认使用中文。
- PowerShell 读取文件时必须显式使用 UTF-8 编码，例如 `Get-Content -Encoding utf8`，避免脚本末尾中文字符串被按本地编码解成乱码。
- 不直接修改游戏本体；`resources/app.asar` 只通过 `scripts/mod_build.py` 由 Mod 源码重建，解包结果（`.tools/asar_extracted/`）只作为阅读和定位注入点的参考。
- 新增或修改 Mod 代码统一放在 `src/`，辅助脚本放在 `scripts/`，说明文档放在仓库根目录或 `docs/`。
- `.tools/`、`build/`、游戏本体（exe / dll / pak / `resources/`）、构建产物、日志和缓存都不得提交，见 `.gitignore`。
- 每次修改后检查 `git status --short --ignored`，确认只跟踪本次相关代码、脚本和文档。
- 本作不是 Unity 游戏，Cpp2IL / dnSpy / BepInEx 都用不上；解包工具是仓库自带的 `scripts/asar_extract.py`（纯 Python，无外部依赖）。需要更完整的 asar 能力时可用 `@electron/asar`（已安装在 `~/.workbuddy-ai/binaries/node/workspace`）。

## 项目结构

```
Idle Abyss Princesses/
├─ AGENTS.md                 本文件
├─ src/IdleAbyssMod/         Mod 源码（唯一需要手写的部分）
│  ├─ version.txt            Mod 版本号
│  └─ web/
│     ├─ js/mod/             注入到 web/js/mod/ 的脚本，加载顺序见 mod_build.py
│     └─ css/                注入到 web/css/ 的样式
├─ scripts/
│  ├─ asar_extract.py        解包 app.asar（纯 Python）
│  └─ mod_build.py           构建 / 安装 / 还原
├─ docs/                     代码索引与模块说明
├─ share/                    对外说明（Mod修改内容说明.md）
├─ .tools/                   解包结果与开发期小工具（不入库）
└─ （游戏本体，Steam 管理，不入库）
```

## 本作技术栈与 Mod 机制

**这不是 Unity 游戏。** 它是 Electron 应用：

- `IdleAbyssPrincesses.exe` = Electron 运行时，全部游戏逻辑在 `resources/app.asar` 里；
- 主进程 `electron/main.js` 负责窗口、托盘、存档读写 IPC、Steam 联机；
- 渲染层 `web/` 就是普通网页，`index.html` 按顺序加载 `web/js/*.js`，**全部是经典脚本**
  （顶层 `const` / `function` 共享同一个全局词法作用域）；
- 出厂包 `config.js` 里 `DEV_BUILD = false`，官方的 `?debug` 作弊 API 在正式版不存在。

因此 Mod 的注入方式固定为：**解包 asar → 覆盖 Mod 文件 → 在 `index.html` 的 `</body>` 前挂上
Mod 脚本 → 重新打包**。Mod 脚本必须放在 `main.js` 之后加载（那时 `load()` 已跑完，`S` 可用）。

写 Mod 代码时的硬性约定：

- 每个文件都用 IIFE 包起来，只往 `window.IAP` 上挂东西，**不要**声明新的全局 `const`
  （会和游戏同名全局冲突，例如 `S`、`A`、`R`、`affRange`）。
- 访问游戏数据一律通过 `NS.G`（getter 活引用）和 `NS.fn`（函数包装），
  不要缓存 `S` / `A` 的对象引用——读档、换角色、重铸都会整体替换它们。
- 每次改动后走 `NS.apply(full)`：`refreshStats` → `markAll` → `save`。
- 面板挂在 `body` 上（不在 `#app` 里），所以不吃游戏的 `--z` 缩放，自己用 `transform: scale()` 控制。
- 面板打开时要拦截键盘事件，否则在输入框打数字会触发游戏热键（切页 / 暂停）。

## 构建与安装

```bash
python scripts/mod_build.py            # 只生成 build/app.asar
python scripts/mod_build.py --install  # 生成并安装（首次自动备份 app.asar.orig）
python scripts/mod_build.py --restore  # 还原原版
```

- 构建脚本会自检：重新读一遍产物、确认 `index.html` 里有注入块、确认每个 Mod 文件都在。
- 新增 Mod 脚本文件后，必须同步把路径加进 `mod_build.py` 的 `MOD_JS`（顺序即依赖顺序）。
- 安装完成后必须**同步复制到游戏目录并实际启动验证**（Steam 校验或游戏更新会覆盖 `app.asar`）。

## 调试与验证

- 游戏必须**通过 Steam 启动**（`steam://rungameid/5335850`）。直接运行 exe 时
  `steamworks.init()` 会失败并静默退出，日志里连「启动完成」都不会出现——这不是 Mod 的问题。
- 主进程日志：`%APPDATA%/IdleAbyssPrincesses/logs/main.log`。
  Mod 启动时会写一行 `[IAP] 深渊调试台 vX.Y.Z loaded`，是判断「Mod 有没有装进去」的第一手证据。
- 渲染层报错也会经 `reportErr` 落到同一份日志里。
- `.tools/` 下的开发期小工具（不入库）：
  - `shot.mjs`：用 CDP 驱动无头 Edge 执行表达式并截图（配合本地 http 服务测 `web/` 页面）；
  - `dev_reload.py`：构建 → 解包到 `.tools/test_extract` → 生成带测试角色的 `test.html`；
  - `screen.py` / `probe.py` / `click.py` / `type.py` / `key.py`：抓游戏窗口、统计面板专属颜色
    像素数（判断面板是否真的显示）、模拟点击与键盘输入。
- Electron 走 GPU 合成，**抓窗口 DC 会得到空图**，必须从屏幕 DC 抓（`screen.py` 已处理）。

## 数值「合理范围」的判定

改装备数值时必须夹在游戏自己的公式里，不要凭空填：

- 词缀：`affRange(k, ilvl, it)`（`items.js`）——含品质 ×1.1、上古 ×1.3、硬上限 `AFF[k].cap`；
- 王庭词缀：`raidRollAff`（`raid_items.js`）——×1.1，光辉再 ×1.35；
- 基础数值：`rollItem` 里 `rnd(.85, 1.15)` 那一层；
- 词缀条数：`[0, 2, 4, 4, 4][r] + (r>=3 && ilvl>=40 ? 1 : 0)`；
- 太古 = 词缀全部满值且必然上古，切换时要一起处理。

## 版本与提交

- 每个 Mod 内部的代码按模块拆分到多个 `.js` 文件（同一工程下的不同文件名），按等语义划分，禁止全部写在一个文件。
- 每个 `.js` 文件原则上控制在 500 行以内；特殊情况下最多不超过 1000 行，且需要在该文件头部写明拆分原因。
- 每个 Mod 维护自己的版本号，版本文件放在对应 Mod 工程目录内，例如 `src/<ModName>/version.txt`。
- 版本格式使用 `主版本.次版本.补丁版本`，每格最多到 9，补丁超过 9 进位到次版本，次版本超过 9 进位到主版本，例如 `0.1.8 -> 0.1.9 -> 0.2.0`、`0.9.9 -> 1.0.0`。
- 小修小改递增补丁版本；新增功能或兼容性变化递增次版本；大规模重构或存档/配置不兼容变化递增主版本。
- 每次修改运行时插件后，同步更新插件常量（`mod_util.js` 里的 `NS.version`）、版本文件和必要文档。
- 每次新增、修改或移除 Mod 功能时，必须同步手动维护 `share/Mod修改内容说明.md`：
  - 在“当前包含的 Mod”中更新完整功能说明。
  - 在“更新记录”中追加或补充当日日期条目，说明本次新增、调整、修复或移除的功能。
  - 该文件位于 `share/` 层级并加入 Git 跟踪，不由分享包脚本自动生成。
- 修改完成后提交 Git commit；提交信息使用中文，简短说明本次变化。
- Mod 编译完成后必须同步复制到游戏对应目录下（`--install` 已包含这一步）。

## 提交

- 每次修改完代码都进行一次提交，提交 commit 标题自定，内容需要包含详细的信息，至少包含：对应这次修改的用户提出的需求、支持进行这次提交的代码/数据证据位置（本作是 `web/js/*.js` 的函数名与行号，或 `resources/app.asar` 内的文件路径）、每个文件为什么要进行这样的修改；PowerShell 不支持 heredoc 语法，需要用文件形式提交创建 `.tmp_commit_msg.txt` 再提交。
- 修改游戏相关代码前，先看一遍 `docs/反编译代码索引文档.md`；读到新东西后及时更新它，每个模块的详细说明单独写入同级其他文档，并在索引里登记。
- 如果目前还没看过历史的提交内容，先阅读一遍提交标题以对项目有一个大体了解，按需了解提交正文内容。

## 存档与风险

- 存档目录：`%APPDATA%/IdleAbyssPrincesses/`（`save.json`、`save_2..10.json`、`account.json`、
  `prefs.json`、`backups/`）。**调试写存档功能前必须先备份这一份目录。**
- 魂晶与宝石是账号级数据（`account.json`），金币 / 余烬之魂 / 装备是角色级（`save_N.json`）。
- `S.rift.keys` 上限 50、背包上限 120、共用仓库每页 56、强化上限 15——超出会被读档逻辑夹住，
  所以 UI 里也要按这些上限拦。
