'use strict';
/* ============================================================
   mod_boot.js — 启动
   ------------------------------------------------------------
   最后一个加载的 Mod 脚本：确认命名空间就绪、往游戏日志里留一行、
   并给玩家一个「按 F1」的提示。任何异常都只打日志，绝不打断游戏。
   ============================================================ */
(function () {
  const NS = window.IAP;
  if (!NS || !NS.panel) { console.warn('[IAP] 面板模块未加载，Mod 已跳过'); return; }

  function boot() {
    try { NS.fn.log(`<b>${NS.name}</b> v${NS.version} 已加载 · 按 <b>F1</b> 打开`); } catch (e) { }
    console.log(`[IAP] ${NS.name} v${NS.version} ready`);
    /* 往主进程日志留一行加载标记：出厂版没有 DevTools，玩家报「面板打不开」时
       先看 main.log 有没有这一行，就能分清是 Mod 没装进去还是按键没生效。 */
    try { reportErr(`[IAP] ${NS.name} v${NS.version} loaded, panel=${!!NS.panel}`); } catch (e) { }
    /* 只有在已经进入角色时才提示，标题页不打扰 */
    setTimeout(function () {
      try { if (NS.G.S && NS.G.S.cls) NS.toast('按 F1 打开深渊调试台'); } catch (e) { }
    }, 3000);
  }

  try { boot(); } catch (e) { console.warn('[IAP] boot 失败', e); }
})();
