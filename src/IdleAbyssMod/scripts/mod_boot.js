'use strict';
/* ============================================================
   mod_boot.js — 启动（官方模组版）
   ------------------------------------------------------------
   最后一个执行的脚本。职责：
     1. 确认命名空间就绪、往游戏日志里留一行加载标记；
     2. 把调试台挂到官方接口上：设置 → 模组 里的入口、顶栏按钮；
     3. 给玩家一个轻提示。
   任何一步失败都只打日志，绝不打断游戏。

   与旧版（改 app.asar 注入）的区别：
     · 不再往 index.html 里塞 <script>，由游戏的模组加载器按 mod.json 的
       lateScripts 执行本目录下的脚本；
     · 命名空间是 window.IAPM，不再占用 window.IAP —— 3.0.0 起游戏自己
       在 web/js/mod_api.js:262 有顶层 `const IAP`（官方模组接口），
       同名会在标识符解析时被词法绑定盖住，必须避开。
   ============================================================ */
(function () {
  const NS = window.IAPM;
  if (!NS || !NS.panel) { console.warn('[IAPM] 面板模块未加载，Mod 已跳过'); return; }

  /* 官方的模组接口：顶层 `const IAP`。用 typeof 判，旧版本游戏里不存在时也不会抛。 */
  const API = (function () { try { return typeof IAP === 'object' && IAP ? IAP : null; } catch (e) { return null; } })();

  /* 把面板挂到「设置 → 模组」里：render(容器) 只放一个入口按钮，
     真正的界面还是我们自己的浮动窗口（缩放、拖动、七个页签都在那边）。 */
  function registerPanel() {
    if (!API || !API.ui || typeof API.ui.addPanel !== 'function') return false;
    API.ui.addPanel({
      id: 'console',
      title: { zh: NS.name, en: 'Abyss Debug Console' },
      render: function (el) {
        const tip = document.createElement('div');
        tip.className = 'iap-entry-tip';
        tip.append('改装备、改资源、开团本 / 终焉 / 秘境开关。改动即时写入存档，动之前建议先备份。');
        const btn = document.createElement('button');
        btn.className = 'iap-btn iap-entry-open';
        btn.append('打开调试台');
        btn.addEventListener('click', function () { NS.panel.show(); });
        el.append(tip, btn);
      },
    });
    return true;
  }

  /* 顶栏按钮：设置按钮左边一个「调试」。和 F1 等价。 */
  function registerTopButton() {
    if (!API || !API.ui || typeof API.ui.addTopButton !== 'function') return false;
    API.ui.addTopButton({
      id: 'console',
      text: { zh: '调试', en: 'DBG' },
      title: { zh: '深渊调试台（F1）', en: 'Abyss Debug Console (F1)' },
      onClick: function () { NS.panel.toggle(); },
    });
    return true;
  }

  function boot() {
    let hooked = false;
    try { hooked = !!(registerPanel() | registerTopButton()); } catch (e) { console.warn('[IAPM] 挂官方入口失败', e); }

    try { NS.fn.log(`<b>${NS.name}</b> v${NS.version} 已加载 · 按 <b>F1</b> 打开`); } catch (e) { }
    console.log(`[IAPM] ${NS.name} v${NS.version} ready, official-ui=${hooked}`);
    /* 往主进程日志留一行加载标记：玩家报「面板打不开」时先看 main.log 有没有这一行，
       就能分清是 Mod 没被加载，还是热键 / 渲染出了问题。 */
    try { reportErr(`[IAPM] ${NS.name} v${NS.version} loaded, panel=${!!NS.panel}, official=${hooked}`); } catch (e) { }
    /* 只有在已经进入角色时才提示，标题页不打扰 */
    setTimeout(function () {
      try { if (NS.G.S && NS.G.S.cls) NS.toast('按 F1 打开深渊调试台'); } catch (e) { }
    }, 3000);
  }

  try { boot(); } catch (e) { console.warn('[IAPM] boot 失败', e); }
})();
