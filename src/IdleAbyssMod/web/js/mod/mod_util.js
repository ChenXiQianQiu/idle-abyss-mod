'use strict';
/* ============================================================
   mod_util.js — 深渊调试台 Mod · 公共层
   ------------------------------------------------------------
   职责：持有游戏全局的「活引用」、数值解析、装备数值合法区间计算、
   统一的应用 / 存档入口。所有功能页都只通过本文件访问游戏数据，
   这样游戏内部字段改名时只需要改这一处。

   注意：游戏的脚本都是经典脚本（classic script），顶层的 const/function
   共享同一个全局词法作用域，因此这里能直接按名字读到 S / A / AFF 等。
   但 Mod 自己的代码全部包在 IIFE 里，避免往全局塞变量。
   ============================================================ */
(function () {
  const NS = (window.IAP = window.IAP || {});
  NS.name = '深渊调试台';
  NS.version = '0.1.0';
  NS.tabs = [];                       // 各功能页注册进来：{ key, name, render }
  NS.registerTab = function (tab) { NS.tabs.push(tab); };

  /* ---------- 游戏全局的活引用 ----------
     用 getter 而不是快照：读档、换角色、重铸都会把 S / A 整个换掉，
     快照会指向已经废弃的旧对象。 */
  const G = (NS.G = {
    get S() { return S; },
    get A() { return A; },
    get R() { return R; },
    get slot() { return SLOT; },
    get settings() { return SETTINGS; },
    get AFF() { return AFF; },
    get GEMS() { return GEMS; },
    get GEM_KEYS() { return GEM_KEYS; },
    get GEM_GRADE() { return GEM_GRADE; },
    get RAR() { return RAR; },
    get SLOTS() { return SLOTS; },
    get SLOT_TYPE() { return SLOT_TYPE; },
    get TYPE_NAME() { return TYPE_NAME; },
    get SOCKET_MAX() { return SOCKET_MAX; },
    get ARMOR_W() { return ARMOR_W; },
    get MAX_PLUS() { return MAX_PLUS; },
    get KEY_CAP() { return KEY_CAP; },
    get LEVEL_CAP() { return LEVEL_CAP; },
    get SHARED_TABS() { return SHARED_TABS; },
    get RULES2() { return RULES2; },
    get LANGS() { return typeof LANGS === 'object' ? LANGS : { zh: '简体中文' }; },
  });

  /* ---------- 游戏函数的安全包装 ---------- */
  const F = (NS.fn = {
    save: function () { return save(); },
    refresh: function (full) { return refreshStats(full); },
    markAll: function () { return markAll(); },
    log: function (html) { try { log(html); } catch (e) { } },
    setStage: function (n) { return setStage(n); },
    paraSync: function () { if (typeof paraSync === 'function') paraSync(); },
    paraClamp: function () { if (typeof paraClampLevel === 'function') paraClampLevel(); },
    uid: function () { return uid(); },
    plusM: function (it) { return plusM(it); },
    affRange: function (k, ilvl, it) { return affRange(k, ilvl, it); },
    affPool: function (t, ex, cls) { return affPool(t, ex, cls); },
    ruleIlvl: function (l) { return ruleIlvl(l); },
    statName: function (k) { return statName(k); },
    statIsPct: function (k) { return statIsPct(k); },
    pv: function (v) { return pv(v); },
    fmt: function (n) { return fmt(n); },
    toast: function (msg) { try { NS.toast(msg); } catch (e) { } },
  });

  /* 应用改动：重算属性 → 标脏界面 → 立刻存档。
     存档是异步安全的（主进程同步写），失败时游戏自己会弹提示，这里不重复。 */
  NS.apply = function (full) {
    try { F.refresh(!!full); } catch (e) { console.warn('[IAP] refreshStats 失败', e); }
    try { F.markAll(); } catch (e) { }
    try { F.save(); } catch (e) { console.warn('[IAP] save 失败', e); }
  };

  /* ---------- 数值解析 ----------
     支持 1.5万 / 2亿 / 3k 这类简写，方便手输大数。 */
  const MUL = { '': 1, '万': 1e4, w: 1e4, W: 1e4, '亿': 1e8, '兆': 1e12, k: 1e3, K: 1e3, m: 1e6, M: 1e6, b: 1e9, B: 1e9, t: 1e12, T: 1e12 };
  NS.parseNum = function (raw, fallback) {
    if (raw == null) return fallback;
    const s = String(raw).trim().replace(/[,，\s_]/g, '');
    if (!s) return fallback;
    const m = s.match(/^(-?\d+(?:\.\d+)?)(万|亿|兆|[wWkKmMbBtT])?$/);
    if (!m) return fallback;
    const v = Number(m[1]) * (MUL[m[2] || ''] || 1);
    return Number.isFinite(v) ? v : fallback;
  };
  NS.clampNum = function (v, lo, hi) {
    if (!Number.isFinite(v)) return lo;
    return Math.max(lo, Math.min(hi, v));
  };
  /* 词缀 / 基础数值的显示精度：百分比保留 1 位小数，其余取整 */
  NS.roundStat = function (v, isPct) { return isPct ? Math.round(v * 10) / 10 : Math.max(1, Math.round(v)); };

  /* ---------- 装备数值的合法区间 ----------
     完全照抄游戏生成逻辑：
       · 主线词缀 → items.js 的 affRange()（含传奇 / 套装 ×1.1、上古 ×1.3、硬上限 cap）
       · 王庭词缀 → raid_items.js 的 raidRollAff()（×1.1，光辉 radiant 再乘 radiantMul）
     返回值 [下限, 上限]，上限即「这件装备在当前等级与品质下能掷出的最高值」。 */
  NS.affRangeOf = function (k, it) {
    const A = G.AFF[k];
    if (!A || !it) return null;
    if (it.raid) {
      const bal = typeof RAID_ITEM_BAL === 'object' && RAID_ITEM_BAL ? RAID_ITEM_BAL : { radiantMul: 1.35 };
      const top = A.f(it.ilvl) * 1.1 * (it.radiant ? bal.radiantMul : 1);
      const cap = A.cap ? A.cap * (it.radiant ? 1.25 : 1) : Infinity;
      return [Math.min(top * .6, cap), Math.min(top, cap)];
    }
    return F.affRange(k, it.ilvl, it);
  };
  NS.rarMul = function (it) {
    const base = [1, 1.1, 1.2, 1.35, 1.35][it.r] || 1;
    return base * (it.anc ? 1.3 : 1) * (it.primal ? 1.1 : 1);
  };
  /* 基础数值（武器伤害 / 护甲 / 副手加成 / 格挡）的合法区间，
     对应 items.js rollItem 里 rnd(.85, 1.15) 那一层的上下界。 */
  NS.baseRange = function (it, field) {
    if (!it || it.raid) return null;                       // 王庭基础值由品阶倍率决定，不开放手改
    const ilvl = Number(it.ilvl) || 1, rm = NS.rarMul(it), Pv = Math.pow(1.11, ilvl);
    if (field === 'min' || field === 'max') {
      const f = field === 'min' ? .75 : 1.25, a = 4 * Pv * rm * f;
      return [a * .85, a * 1.15];
    }
    if (field === 'armor') {
      const w = it.t === 'offhand' ? 1.2 : (G.ARMOR_W[it.t] || 0);
      if (!w) return null;
      return [w * 3 * Pv * .85 * rm, w * 3 * Pv * 1.15 * rm];
    }
    if (field === 'imp') {
      const ancMul = it.anc ? 1.2 : 1;
      if (it.imp && it.imp.k === 'ias') return [6 * ancMul, 10 * ancMul];
      return [(4 + ilvl * .25) * .8 * rm, (4 + ilvl * .25) * 1.1 * rm];
    }
    if (field === 'block') { const a = it.anc ? 1.2 : 1; return [8 * a, 14 * a]; }
    return null;
  };
  /* 一件装备最多能有几条随机词缀（items.js rollItem 的 n 公式，取上界）。
     王庭装备按 raid_items.js 的 RAID_ITEM_BAL.affixes 走。 */
  NS.affCap = function (it) {
    if (!it) return 0;
    if (it.raid) {
      const bal = typeof RAID_ITEM_BAL === 'object' && RAID_ITEM_BAL ? RAID_ITEM_BAL : { affixes: 4 };
      return Math.max((it.aff || []).filter(f => !f.raid && !f.fixed).length, bal.affixes);
    }
    const n = [0, 2, 4, 4, 4][it.r] || 4;
    return n + (it.r >= 3 && it.ilvl >= 40 ? 1 : 0);
  };

  /* ---------- 装备集合（列表用） ---------- */
  NS.collectItems = function () {
    const S = G.S, A = G.A, out = [];
    if (!S || !S.cls) return out;
    for (const sl of G.SLOTS) {
      const it = S.equip && S.equip[sl];
      if (it) out.push({ it: it, src: 'eq', slot: sl, tag: '已装备' });
    }
    (S.inv || []).forEach(function (it) { if (it) out.push({ it: it, src: 'inv', tag: '背包' }); });
    (S.stash || []).forEach(function (it) { if (it) out.push({ it: it, src: 'stash', tag: '仓库' }); });
    if (A && A.shared && Array.isArray(A.shared.tabs)) {
      A.shared.tabs.forEach(function (tab, i) {
        if (i >= A.shared.open) return;
        (tab || []).forEach(function (it) { if (it) out.push({ it: it, src: 'shared', tab: i, tag: '共用' + (i + 1) }); });
      });
    }
    return out;
  };
  NS.findItem = function (sel) {
    if (!sel) return null;
    const S = G.S, A = G.A;
    if (!S || !S.cls) return null;
    if (sel.src === 'eq') return (S.equip || {})[sel.slot] || null;
    if (sel.src === 'inv') return (S.inv || []).find(function (x) { return x && x.id === sel.id; }) || null;
    if (sel.src === 'stash') return (S.stash || []).find(function (x) { return x && x.id === sel.id; }) || null;
    if (sel.src === 'shared' && A && A.shared && A.shared.tabs[sel.tab])
      return A.shared.tabs[sel.tab].find(function (x) { return x && x.id === sel.id; }) || null;
    return null;
  };
  NS.itemName = function (it) {
    if (!it) return '';
    let n = it.name || it.bname || '?';
    if (it.plus) n += ' +' + it.plus;
    return n;
  };
  NS.rarColor = function (it) {
    const R = G.RAR[it.r] || G.RAR[0];
    return R ? R.c : '#d8d4cc';
  };

  /* ---------- 小工具 ---------- */
  NS.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  NS.el = function (tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  /* 面板右下角的轻提示（不打断操作，2 秒淡出） */
  let toastEl = null, toastT = 0;
  NS.toast = function (msg, bad) {
    if (!toastEl) {
      toastEl = NS.el('div', 'iap-toast');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = String(msg);
    toastEl.classList.toggle('bad', !!bad);
    toastEl.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('on'); }, 1800);
  };
  /* 读取 / 写入 Mod 自己的偏好（缩放、位置），与游戏设置分开存 */
  const PREF_KEY = 'iap-mod-prefs-v1';
  NS.prefs = (function () {
    try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch (e) { return {}; }
  })();
  NS.savePrefs = function () {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(NS.prefs)); } catch (e) { }
  };
})();
