'use strict';
/* ============================================================
   mod_pearl.js — 骊龙宝珠「探骊」控制（装备页里的区块，游戏 2.8.3）
   ------------------------------------------------------------
   游戏机制（myth.js:580 起）：骊龙宝珠是「改写」类神格，装上之后铁匠「附魔」
   页签会对每件装备多出一个「探骊」按钮 —— 每次花 MYTH_PEARL.gold（1e12，1 兆）
   金币，按 mythPearlRate() 的几率多出一条随机词条，每件最多一次（it.pearl = 1），
   失败只花金币。几率 = MYTH_PEARL.rate(.01) × 神契倍率 L.y_lilong（每级 ×1.1）。

   为什么放在装备页而不是单独一页：探骊和蚀刻一样是「针对某一件装备」的操作，
   放在编辑器里选中哪件就操作哪件，不用再抄一份装备列表做选择器。

   能力（开关关掉时原样转发给游戏的原函数）：
     · 探骊必定成功   调用期间临时把 MYTH_PEARL.rate 放大，使 p ≥ 1
     · 指定词条       成功之后把刚加的那一条换成自选的（走游戏的 rollAff）
     · 探骊一次       直接调游戏的 mythPearl，扣金币、写 it.pearl、打 log / banner

   可包装性：mythPearl 是顶层 function 声明 → 挂在 window 上，内部裸名调用，覆盖即生效。
   mythPearlRate / mythPearlFits 是 const 箭头函数，覆盖不了，只能调用；
   所以「必定成功」不去改那个函数，而是临时改它读的 MYTH_PEARL.rate。
   ============================================================ */
(function () {
  const NS = window.IAPM, G = NS.G;

  const PE = (NS.pearl = {
    ok: !!NS.prefs.myPearlOk,
    aff: typeof NS.prefs.myPearlAff === 'string' ? NS.prefs.myPearlAff : '',
    swap: '',        // 已探骊装备「换词条」下拉的选择（内存态，不持久化、不跨装备）
    swapFor: '',     // 上面那个选择属于哪件装备
    hooked: false,
  });
  const orig = {};

  const P = function () { return G.MYTH_PEARL || null; };
  const rate = function () { try { return typeof mythPearlRate === 'function' ? (Number(mythPearlRate()) || 0) : 0; } catch (e) { return 0; } };
  const fits = function (it) { try { return typeof mythPearlFits === 'function' && !!mythPearlFits(it); } catch (e) { return false; } };
  const gold = function () { const S = G.S; return S ? (Number(S.gold) || 0) : 0; };
  const statName = function (k) { try { return NS.fn.statName(k); } catch (e) { return k; } };
  /* 和游戏 mythPearl 里完全同一份池子：跳过已有词条、跳过 'ele'（元素由 elementAffixRoll 展开）。
     dropIdx：把这一条从「已有」里去掉，换词条时才能重新选到它自己。 */
  const poolOf = function (it, dropIdx) {
    try {
      const ex = (it.aff || []).filter(function (f, i) { return !f.raid && i !== dropIdx; })
        .map(function (f) { return f.k; });
      return affRollPool(it.t, ex, it.cls || (G.S && G.S.cls)).filter(function (k) { return k !== 'ele'; });
    } catch (e) { return []; }
  };
  /* 探骊加的那一条是哪条：王庭装备读档时 raidItemFix 会把 ◆ 固定词条全部删掉再追加到末尾
     （raid_items.js:418），所以「最后一条非 raid 词缀」就是探骊加的；
     主线装备没有 raid 词缀，最后一条就是它。 */
  function pearlIdx(it) {
    const aff = (it && it.aff) || [];
    for (let i = aff.length - 1; i >= 0; i--) if (aff[i] && !aff[i].raid) return i;
    return -1;
  }
  const pearlAff = function (it) { const i = pearlIdx(it); return i >= 0 ? it.aff[i] : null; };
  /* 骊龙宝珠有没有（账号唯一）。没拥有的话整块不显示，免得每件装备都挂一条无用的提示 */
  const owned = function () {
    try { const A = G.A; return !!(A && A.myth && A.myth.own && A.myth.own.lilong); } catch (e) { return false; }
  };

  function savePrefs() {
    NS.prefs.myPearlOk = PE.ok;
    NS.prefs.myPearlAff = PE.aff;
    NS.savePrefs();
  }
  const rerender = function () { if (NS.panel) NS.panel.refresh(); };
  const fmtv = function (n) { try { return NS.fn.fmt(n); } catch (e) { return String(n); } };
  const toast = function (m, bad) { NS.toast(m, bad); };
  /* 改完存档字段后的三件套（和游戏内部一致）：重算属性 → 存档 → 刷新界面 */
  function persist() {
    try { if (typeof refreshStats === 'function') refreshStats(); } catch (e) { }
    try { if (typeof save === 'function') save(); } catch (e) { }
    try { if (typeof markAll === 'function') markAll(); } catch (e) { }
  }

  /* ---------- 包装 mythPearl ---------- */
  function hook() {
    if (typeof mythPearl !== 'function' || orig.pearl) return;
    orig.pearl = mythPearl;
    window.mythPearl = function (it) {
      /* 两个都没开：原样转发，行为和没装 Mod 完全一致 */
      if (!PE.ok && !PE.aff) return orig.pearl.apply(this, arguments);
      const M = P(), p = rate();
      let savedRate = null;
      /* 必定成功：p = rate × 神契倍率。把 rate 临时放大到「p ≥ 2」，
         同步调用里没有别的地方读它，调用完 finally 还原。 */
      if (PE.ok && M && p > 0 && p < 1) {
        const y = p / M.rate;                       // 神契倍率（≥ 1）
        if (y > 0) { savedRate = M.rate; M.rate = 2 / y; }
      }
      let r;
      try { r = orig.pearl.apply(this, arguments); }
      finally { if (savedRate != null) M.rate = savedRate; }
      if (r !== 'ok' || !PE.aff) return r;
      swapAff(it);
      return r;
    };
    PE.hooked = true;
  }
  hook();
  if (!PE.hooked) setTimeout(hook, 1000);

  /* 把刚加进去的那一条换成自选的。原函数是 it.aff.push(f)，所以最后一条就是它。
     池子里没有这条（部位不支持 / 已经有同名）就保留游戏随机的结果。 */
  function swapAff(it) {
    if (!it || !Array.isArray(it.aff) || !it.aff.length) return false;
    const i = pearlIdx(it);
    if (i < 0) return false;
    if (poolOf(it, i).indexOf(PE.aff) < 0) return false;
    const f = it.aff[i];
    if (f && f.k === PE.aff) return true;
    try {
      it.aff[i] = rollAff(PE.aff, it, it.primal ? 1 : undefined);
    } catch (e) { return false; }
    try { if (typeof refreshStats === 'function') refreshStats(); } catch (e) { }
    /* 游戏原函数的 log 写的是随机到的那条，这里补一行说明实际换成了什么 */
    try { if (typeof log === 'function' && typeof affName === 'function') log('探骊：按调试台设置换成 ' + affName(PE.aff)); } catch (e) { }
    return true;
  }

  /* 已经探骊过的装备：把多出来的那一条换成指定的（不花金币，纯调试） */
  function swapPearl(it, key) {
    const i = pearlIdx(it);
    if (i < 0 || !key) return false;
    if (poolOf(it, i).indexOf(key) < 0) return false;
    if (it.aff[i].k === key) return false;
    try { it.aff[i] = rollAff(key, it, it.primal ? 1 : undefined); } catch (e) { return false; }
    persist();
    return true;
  }

  /* 撤销探骊：删掉多出来的那一条、清掉 it.pearl，之后可以重新探骊 */
  function undoPearl(it) {
    const i = pearlIdx(it);
    if (i < 0 || !it.pearl) return false;
    it.aff.splice(i, 1);
    delete it.pearl;
    persist();
    return true;
  }

  /* ---------- 操作 ---------- */
  function run(it) {
    if (!it) return null;
    if (!fits(it)) return null;
    const M = P();
    if (!M) return null;
    if (!rate()) return 'nomyth';
    if (gold() < M.gold) return 'nogold';
    if (typeof mythPearl !== 'function') return null;
    const r = mythPearl(it);
    try { if (typeof save === 'function') save(); } catch (e) { }
    return r;
  }

  /* ---------- 装备页里的区块 ---------- */
  /* curKey 有值 = 这件已经探骊过，走「换词条」的下拉：把当前那条也列进选项
     （否则它被「排除已有词条」挡掉了），选择只记在 PE.swap 里，不污染新探骊用的 PE.aff */
  function affSel(it, curKey) {
    const isSwap = curKey !== undefined;
    const idx = isSwap ? pearlIdx(it) : -1;
    const keys = poolOf(it, idx);
    const want = isSwap ? (PE.swap || curKey) : (PE.aff || '');
    const attr = isSwap ? 'affswap' : 'aff';
    const opts = ['<option value="">（游戏随机）</option>'].concat(keys.map(function (k) {
      return `<option value="${k}"${k === want ? ' selected' : ''}>${NS.esc(statName(k))}</option>`;
    })).join('');
    return `<select class="iap-in" data-pearl="${attr}" aria-label="探骊词条">${opts}</select>`;
  }

  PE.block = function (it) {
    if (!it || !P()) return '';
    const M = P(), p = rate(), has = !!it.pearl;
    /* 部位不支持、又没探骊过的，整块不显示 */
    if (!has && !fits(it)) return '';
    if (!has && !p && !owned()) return '';        // 没有骊龙宝珠，探骊根本不存在
    /* 已经探骊过的：也要能改。只显示「已多出一条」等于把操作全藏起来，
       玩家会以为这件装备坏了（v0.9.3 之前就是这样）。 */
    if (has) {
      /* 换到别的装备时把上一条选择清掉，免得沿用别的部位的词条键 */
      if (PE.swapFor !== it.id) { PE.swapFor = it.id; PE.swap = ''; }
      const cur = pearlAff(it), curName = cur ? statName(cur.k) : '';
      return `<div class="iap-sec"><div class="iap-sechd"><b>骊龙宝珠 · 探骊</b>
          <small>已多出一条：<b>${NS.esc(curName || '（找不到）')}</b> · 每件只能一次</small></div>
        <div class="iap-row"><div class="iap-lab"><b>换成</b><small>直接把探骊加的那一条换掉，不花金币</small></div>
          <div class="iap-cds">${affSel(it, cur ? cur.k : '')}
            <button class="iap-btn pri" data-pearl="swap"${cur ? '' : ' disabled'}>换掉</button></div></div>
        <div class="iap-affadd">
          <button class="iap-btn ghost" data-pearl="undo"${cur ? '' : ' disabled'}>撤销探骊（删掉这条，可以重新探骊）</button>
        </div>
        <div class="iap-hint">「换掉」只改这一条，数值按新的词条区间重掷（太古仍然满值）。
          多出来的那条也在上面的词缀列表里，可以照常改数值。</div>
      </div>`;
    }
    const pct = Math.round(p * 1000) / 10;
    const head = p ? '几率 <b>' + pct + '%</b> · 每次 <b>' + fmtv(M.gold) + '</b> 金币'
      : '需要装备骊龙宝珠（神格·探骊）';
    const noGold = gold() < M.gold;
    return `<div class="iap-sec"><div class="iap-sechd"><b>骊龙宝珠 · 探骊</b><small>${head}</small></div>
      <div class="iap-hint">神格【改写】探骊：花 ${fmtv(M.gold)} 金币掷一次，成功多一条随机词条（每件最多一次），
        失败只花金币、装备不会碎。${p ? '' : '<b class="bad">先把骊龙宝珠戴上</b>，不然几率为 0。'}</div>
      <div class="iap-affadd">
        <button class="iap-btn pri" data-pearl="run"${p && !noGold ? '' : ' disabled'}>探骊一次</button>
        ${noGold ? '<span class="iap-hint bad">金币不够 ' + fmtv(M.gold) + '</span>' : ''}
      </div>
      <div class="iap-row"><div class="iap-lab"><b>指定词条</b><small>留空 = 游戏随机；选了就一定是这一条（仍受部位池限制）</small></div>
        <div class="iap-cds">${affSel(it)}</div></div>
      <div class="iap-row"><div class="iap-lab"><b>探骊必定成功</b><small>只在点「探骊一次」的那一次生效，不改游戏的表</small></div>
        <button class="iap-chip${PE.ok ? ' on' : ''}" data-pearl="tog:ok">${PE.ok ? '已开启' : '已关闭'}</button></div>
      <div class="iap-hint">开关和指定词条记在 localStorage，换装备 / 重启游戏都保留。</div>
    </div>`;
  };

  PE.bind = function (root, getItem) {
    root.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-pearl]');
      if (!btn) return;
      const act = String(btn.dataset.pearl), it = getItem && getItem();
      if (act === 'tog:ok') {
        PE.ok = !PE.ok; savePrefs(); rerender();
        toast('探骊必定成功 ' + (PE.ok ? '已开启' : '已关闭'));
        return;
      }
      if (!it) return;
      /* 已经探骊过的：换词条 / 撤销 */
      if (act === 'swap') {
        const sel = root.querySelector('[data-pearl="affswap"]');
        const k = sel ? sel.value : '';
        if (!k) { toast('先选一条词缀', true); return; }
        if (swapPearl(it, k)) { rerender(); toast('探骊词条已换成 ' + statName(k)); }
        else toast('换不了：这件没有探骊词条，或这条不在该部位的池子里', true);
        return;
      }
      if (act === 'undo') {
        if (undoPearl(it)) { rerender(); toast('已撤销探骊，可以重新探骊'); }
        else toast('这件没有可撤销的探骊词条', true);
        return;
      }
      if (act !== 'run') return;
      if (it.pearl) { toast('这件已经探骊过了，用上面的「换掉」改词条', true); return; }
      const r = run(it);
      if (r === 'nomyth') { toast('先把骊龙宝珠戴上：没装备时几率为 0', true); return; }
      if (r === 'nogold') { toast('金币不够：要 ' + fmtv(P().gold), true); return; }
      if (!r) { toast('探骊失败：条件不满足', true); return; }
      rerender();
      if (r === 'ok') {
        const f = pearlAff(it);
        toast('探骊得珠：多出一条 ' + (f ? statName(f.k) : '词条'));
      } else toast('这次没有摸到（只花了金币）', true);
    });

    root.addEventListener('change', function (e) {
      const el = e.target;
      if (!el.dataset || !el.dataset.pearl) return;
      const act = String(el.dataset.pearl);
      if (act === 'affswap') { PE.swap = el.value || ''; return; }   // 只记在内存里，不跨装备
      if (act !== 'aff') return;
      PE.aff = el.value || '';
      savePrefs();
    });
  };
})();
