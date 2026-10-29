'use strict';
/* ============================================================
   mod_ultra.js — 终焉页（超高难本《这就是最后了》）
   ------------------------------------------------------------
   两个开关，都只改游戏的判定，不重写它的逻辑：

   1) 无限周奖励（去掉「每周一次」）
      游戏：ultra.js:400 ultraWeeklyReward(idx)
        `const B = ULTRA_BOSSES[idx]; if (!B || A.ultra.got[B.id]) return null;`
      奖励 = 最后的余烬 +（最终战额外）队伍里还没拿过的某位女主角的心跳信物；
      已领记录写在账号档 A.ultra.got，换周时由 ultraWeekCheck 清空。
      开关打开后包装这个函数：调用前先删掉 A.ultra.got[B.id]，让原函数
      认为「本周还没领」，调用后再写回 true。于是每击败一次首领就发一次奖励，
      其余判定（最终战从本次队伍 4 人里随机挑一位没拿过的、全拿过就多给
      1 枚余烬）完全走游戏原版，不复制任何逻辑。

   2) 升华 / 重选词缀自选
      游戏：ultra.js ultraSmithAct('ultraup', it)
        扣 1 枚余烬 / 500 魂晶 / 金币，然后从 15 条终焉词条（ULTRA_AFFIX）
        里随机取 3 条写进 it.ultraPend，玩家再点其中一条（ultratake:j）。
      2.4.0 新增重选：ultraSmithAct('ultrareroll', it) 花同样代价，给 3 条新词条
        （不含当前那条）写进 it.ultraRe，点 ultrare:j 换上，或 ultrakeep 保留原样。
      开关打开后包装这个函数：原函数照常跑完（余额校验、扣费、存档都不动），
      再把 it.ultraPend / it.ultraRe 换成 ULTRA_AFFIX 的全部 15 条并重新存档。
      铁匠「升华」页签里就会把 15 条全列出来，自己挑一条。
      注意 ultraSmithFoot 是顶层 const 箭头函数，window 上覆盖不了，
      所以只能改它读的 ultraPend / ultraRe，不能直接换渲染函数。

   包装方式与 mod_raid.js 一致：游戏是经典脚本，顶层 function 声明挂在
   window 上、内部是裸名调用，覆盖 window 上的同名属性即可生效；
   开关关掉时原样转发，行为与未装 Mod 完全一致。
   ============================================================ */
(function () {
  const NS = window.IAP, G = NS.G, F = NS.fn;
  const U = (NS.ultra = {
    noWeekly: !!NS.prefs.ultraNoWeekly,
    pickAff: !!NS.prefs.ultraPickAff,
    hooked: { weekly: false, smith: false },
  });
  const rerender = function () { if (NS.panel) NS.panel.refresh(); };

  function savePrefs() {
    NS.prefs.ultraNoWeekly = U.noWeekly;
    NS.prefs.ultraPickAff = U.pickAff;
    NS.savePrefs();
  }

  /* ---------- 数据读取 ---------- */
  const acc = function () {
    const A = G.A;
    return A && A.ultra && typeof A.ultra === 'object' ? A.ultra : null;
  };
  const bosses = function () { return typeof ULTRA_BOSSES === 'object' ? ULTRA_BOSSES : []; };
  const affixes = function () { return typeof ULTRA_AFFIX === 'object' ? ULTRA_AFFIX : {}; };
  const signets = function () { return typeof ULTRA_SIGNET === 'object' ? ULTRA_SIGNET : {}; };

  /* ---------- 包装：ultraWeeklyReward ---------- */
  const orig = {};

  function hookWeekly() {
    if (U.hooked.weekly || typeof ultraWeeklyReward !== 'function') return;
    orig.weekly = ultraWeeklyReward;
    window.ultraWeeklyReward = function (idx) {
      if (!U.noWeekly) return orig.weekly.apply(this, arguments);
      const B = bosses()[idx], u = acc();
      /* 数据不全时直接不发（原函数读 u.got 会抛错，这里兜一层） */
      if (!B || !u || !u.got || typeof u.got !== 'object') return null;
      delete u.got[B.id];                                  // 假装本周还没领过
      let out;
      try { out = orig.weekly.apply(this, arguments); }
      finally { u.got[B.id] = true; }                      // 原函数自己会写 true，异常时也补上
      return out;
    };
    U.hooked.weekly = true;
  }

  /* ---------- 包装：ultraSmithAct ---------- */
  function hookSmith() {
    if (U.hooked.smith || typeof ultraSmithAct !== 'function') return;
    orig.smith = ultraSmithAct;
    window.ultraSmithAct = function (act, it) {
      const r = orig.smith.apply(this, arguments);
      /* 只接管「升华」和 2.4.0 新增的「重选」两步：原函数已经把费用扣掉、
         把 3 条写进 ultraPend / ultraRe 了，这里换成全部 15 条。 */
      if (!r || !U.pickAff || !it) return r;
      if (act !== 'ultraup' && act !== 'ultrareroll') return r;
      const all = Object.keys(affixes());
      if (!all.length) return r;
      if (act === 'ultraup') {
        if (!Array.isArray(it.ultraPend) || !it.ultraPend.length) return r;
        it.ultraPend = all;                                // 15 条全给，自己挑
      } else {
        if (!Array.isArray(it.ultraRe) || !it.ultraRe.length) return r;
        /* 原版 ultraRollAffixes(n, skip) 会跳过当前那条词条，这里同样排除，
           免得「重选」列表里出现已经戴着的那一条。 */
        const cur = it.ultraAff && it.ultraAff.k;
        it.ultraRe = all.filter(function (k) { return k !== cur; });
      }
      try { save(); } catch (e) { console.warn('[IAP] 保存升华待选失败', e); }
      return r;
    };
    U.hooked.smith = true;
  }

  hookWeekly(); hookSmith();
  /* 游戏脚本都在 Mod 之前，理论上已就绪；万一顺序变了，1 秒后补一次 */
  if (!U.hooked.weekly || !U.hooked.smith) {
    setTimeout(function () { hookWeekly(); hookSmith(); }, 1000);
  }

  /* ---------- 页面 ---------- */
  function toggleChip(key, on, name, note) {
    return `<div class="iap-row"><div class="iap-lab"><b>${name}</b><small>${note}</small></div>
      <button class="iap-chip${on ? ' on' : ''}" data-do="toggle:${key}">${on ? '已开启' : '已关闭'}</button></div>`;
  }

  /* 已领首领的名字（没领的用暗色标出来） */
  function gotLine(u) {
    const list = bosses();
    if (!list.length) return '<span class="dim">没有读到首领表。</span>';
    return list.map(function (b) {
      const on = !!(u.got && u.got[b.id]);
      return `<i class="iap-cd${on ? ' on' : ''}">${NS.esc(b.name)}</i>`;
    }).join('');
  }
  function signetLine(u) {
    const S = signets(), own = Object.keys(S).filter(function (k) { return u.sig && u.sig[k]; });
    if (!own.length) return '<span class="dim">还没有心跳信物：去超高难本击败最终首领。</span>';
    return own.map(function (k) { return `<i class="iap-cd on">${NS.esc(S[k].name)}</i>`; }).join('');
  }

  function render() {
    const S = G.S, A = G.A;
    if (!S || !S.cls) return `<div class="iap-empty">还没有进入角色，先选一个英雄再打开调试台。</div>`;
    if (!A) return `<div class="iap-empty">账号档还没就绪（读档中），稍等再试。</div>`;
    const u = acc();
    if (!u) return `<div class="iap-empty">账号档里还没有超高难本进度：先通关一次永夜王庭普通难度（当前角色 · 新规则）才会出现入口。</div>`;
    try { ultraWeekCheck(); } catch (e) { }               // 先处理跨周清进度

    const total = bosses().length || 5;
    const sigTotal = Object.keys(signets()).length || 8;
    const sigOwn = Object.keys(u.sig || {}).length;
    const gotN = bosses().filter(function (b) { return u.got && u.got[b.id]; }).length;
    const hookedTxt = (U.hooked.weekly && U.hooked.smith)
      ? ''
      : `<div class="iap-hint bad">挂钩没接上（${!U.hooked.weekly ? 'ultraWeeklyReward ' : ''}${!U.hooked.smith ? 'ultraSmithAct' : ''}找不到），开关不会生效。</div>`;
    const best = u.best > 0 ? `${Math.floor(u.best / 60)}:${String(Math.round(u.best % 60)).padStart(2, '0')}` : '—';

    return `<div class="iap-note">《这就是最后了》· 账号共用进度 · 第 <b data-u="week">${u.week || 0}</b> 周 · 首通 <b>${u.cleared ? '已通关' : '未通关'}</b></div>
      ${hookedTxt}
      <div class="iap-sec"><div class="iap-sechd"><b>每周奖励</b><small>最后的余烬 · 心跳信物</small></div>
        ${toggleChip('noWeekly', U.noWeekly, '无限周奖励（去掉每周一次）', '每击败一次首领都发奖励，不再受「本周已领」限制')}
        <div class="iap-row"><div class="iap-lab"><b>本周进度</b><small>已领 <span data-u="gotn">${gotN}</span>/${total}</small></div>
          <div class="iap-cur"><i data-u="prog">${u.prog || 0}/${total}</i></div></div>
        <div class="iap-row"><div class="iap-lab"><b>已领首领</b><small>绿色 = 本周已领过</small></div>
          <div class="iap-cds" data-u="got">${gotLine(u)}</div></div>
        <div class="iap-affadd"><button class="iap-btn" data-do="resetweek">重置本周奖励记录</button></div>
        <div class="iap-hint">原版每个首领每周只发一次奖励，最终战那一次还会从<b>本次队伍 4 人</b>里随机挑一位
          还没拿过心跳信物的女主角（全拿过就多给 1 枚余烬）。开启后可以反复打，一轮下来队伍里的
          4 个职业都能拿齐；想集满 8 个，换一组不同职业的队友再打一轮。<br>
          只影响超高难本，永夜王庭的每周掉落资格在「团本」页。</div>
      </div>
      <div class="iap-sec"><div class="iap-sechd"><b>升华</b><small>铁匠 → 升华页签</small></div>
        ${toggleChip('pickAff', U.pickAff, '终焉词条自选', '升华 / 重选时把 15 条终焉词条全列出来，自己挑一条')}
        <div class="iap-hint">原版是随机 3 选 1。开启后点「升华」或 2.4.0 新增的「重选词条」，扣费和「每件只能升华一次」的规则都不变，
          只是把待选列表换成全部 ${Object.keys(affixes()).length} 条（重选时排除当前已戴的那条）；已经处在「待选择」状态的装备不受影响。</div>
      </div>
      <div class="iap-sec"><div class="iap-sechd"><b>状态</b><small>账号共用</small></div>
        <div class="iap-row"><div class="iap-lab"><b>最后的余烬</b><small>终焉升华每次消耗 1 枚</small></div>
          <div class="iap-cur"><i data-u="embers">${F.fmt(u.embers || 0)}</i></div></div>
        <div class="iap-row"><div class="iap-lab"><b>心跳信物</b><small>账号唯一 · 拿到即解锁同名称号</small></div>
          <div class="iap-cur"><i data-u="sig">${sigOwn}/${sigTotal}</i></div></div>
        <div class="iap-row"><div class="iap-lab"><b>已解锁称号</b><small>角色页「称号」里佩戴</small></div>
          <div class="iap-cds" data-u="siglist">${signetLine(u)}</div></div>
        <div class="iap-row"><div class="iap-lab"><b>最快通关</b><small>墓墙记录 ${(u.wall || []).length} 条</small></div>
          <div class="iap-cur"><i>${best}</i></div></div>
      </div>`;
  }

  const TOGGLE_NAME = {
    noWeekly: '无限周奖励',
    pickAff: '终焉词条自选',
  };

  function bind(root) {
    root.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-do]');
      if (!btn) return;
      const act = btn.dataset.do;
      if (act.indexOf('toggle:') === 0) {
        const k = act.slice(7);
        if (!TOGGLE_NAME[k]) return;
        U[k] = !U[k];
        savePrefs();
        NS.toast(TOGGLE_NAME[k] + (U[k] ? ' 已开启' : ' 已关闭'));
        rerender();
        return;
      }
      if (act === 'resetweek') {
        const u = acc();
        if (!u) return;
        u.got = {};
        u.prog = 0;
        NS.apply(false);                                    // refreshStats → markAll → save（含账号档）
        NS.toast('已重置本周奖励记录，5 个首领都能重新领');
        rerender();
        return;
      }
    });
  }

  /* 每秒轻量同步：数字直接改文本；首领 / 信物列表变了才整页重绘。
     lastList 用 null 表示「还没记过」，第一次同步只记录不重绘。 */
  let lastList = null;
  const listSig = function (u) {
    return Object.keys(u.got || {}).sort().join(',') + '|' + Object.keys(u.sig || {}).sort().join(',');
  };
  function sync(root) {
    const u = acc();
    if (!u) return;
    const set = function (k, v) { const el = root.querySelector(`[data-u="${k}"]`); if (el) el.textContent = v; };
    const total = bosses().length || 5;
    set('week', String(u.week || 0));
    set('prog', `${u.prog || 0}/${total}`);
    set('gotn', String(bosses().filter(function (b) { return u.got && u.got[b.id]; }).length));
    set('embers', F.fmt(u.embers || 0));
    set('sig', `${Object.keys(u.sig || {}).length}/${Object.keys(signets()).length || 8}`);
    const s = listSig(u);
    if (lastList === null) lastList = s;
    else if (s !== lastList) { lastList = s; rerender(); }
  }

  NS.registerTab({ key: 'ultra', name: '终焉', render: render, bind: bind, sync: sync });
})();
