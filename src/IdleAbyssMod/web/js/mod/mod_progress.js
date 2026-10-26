'use strict';
/* ============================================================
   mod_progress.js — 进度页
   ------------------------------------------------------------
   可改：等级 / 经验、巅峰等级 / 巅峰经验、最高阶段、当前阶段、
        折磨档位与解锁档位、未分配属性点。
   上限全部取自游戏自己的规则函数（rules.js）：新规则阶段封顶 101、
   物品等级封顶 100、巅峰封顶 3000；旧规则存档没有阶段上限。
   ============================================================ */
(function () {
  const NS = window.IAP, G = NS.G, F = NS.fn;

  const ROWS = [
    {
      key: 'level', name: '等级', sub: () => `1 ~ ${G.LEVEL_CAP}`,
      get: () => G.S.level, set: v => { G.S.level = v; G.S.xp = 0; }, full: true,
    },
    {
      key: 'para', name: '巅峰等级', sub: () => paraCapTxt() + '（满级后才累积）',
      get: () => G.S.para || 0, set: v => { G.S.para = v; G.S.paraXp = 0; try { F.paraClamp(); } catch (e) { } }, full: true,
    },
    {
      key: 'maxStage', name: '最高阶段', sub: () => '1 ~ ' + stageCapTxt(),
      get: () => G.S.maxStage, set: v => { G.S.maxStage = v; if (G.S.stage > v) G.S.stage = v; }, full: true,
    },
    {
      key: 'stage', name: '当前阶段', sub: () => `1 ~ 最高阶段`,
      get: () => G.S.stage, set: v => { try { F.setStage(v); } catch (e) { G.S.stage = v; } }, full: true,
    },
    {
      key: 'tormentMax', name: '已解锁折磨', sub: () => `0 ~ ${G.RULES2.torment.max}（打完终章后才有）`,
      get: () => G.S.tormentMax || 0, set: v => { G.S.tormentMax = v; if ((G.S.torment || 0) > v) G.S.torment = v; }, full: true,
    },
    {
      key: 'torment', name: '当前折磨档位', sub: () => `0 ~ 已解锁档位`,
      get: () => G.S.torment || 0,
      set: v => { if (typeof setTorment === 'function' && !setTorment(v)) G.S.torment = v; }, full: true,
    },
    {
      key: 'free', name: '未分配属性点', sub: () => '角色面板里的自由点数',
      get: () => G.S.free || 0, set: v => { G.S.free = v; }, full: true,
    },
  ];

  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }
  const newRules = function (s) {
    const st = s || G.S;
    try { return typeof isNewRules === 'function' ? isNewRules(st) : st && st.rules === 2; } catch (e) { return !!(st && st.rules === 2); }
  };
  function stageCapTxt() {
    const c = safe(() => ruleStageCap());
    if (c === Infinity || c == null) return newRules() ? String(G.RULES2.stageCap) : '无上限（旧规则）';
    return String(c);
  }
  function paraCapTxt() {
    const c = safe(() => paraLevelCap());
    if (c === Infinity || c == null) return newRules() ? '0 ~ ' + G.RULES2.para.cap : '无上限（旧规则）';
    return '0 ~ ' + c;
  }

  function rowHTML(r) {
    const cur = Number(r.get()) || 0;
    const sub = typeof r.sub === 'function' ? r.sub() : r.sub;
    return `<div class="iap-row" data-prog="${r.key}">
      <div class="iap-lab"><b>${r.name}</b><small>${sub}</small></div>
      <div class="iap-cur"><i data-cur>${F.fmt(cur)}</i></div>
      <input class="iap-in" type="text" inputmode="numeric" spellcheck="false" data-in value="${Math.floor(cur)}">
      <button class="iap-btn" data-do="set">设为</button>
      <button class="iap-btn" data-do="add">＋</button>
      <button class="iap-btn ghost" data-do="min">最低</button>
    </div>`;
  }

  function render() {
    const S = G.S;
    if (!S || !S.cls) return `<div class="iap-empty">还没有进入角色，先选一个英雄再打开调试台。</div>`;
    const rules = newRules(S) ? '新规则' : '旧规则';
    const cls = (typeof CLASSES === 'object' && CLASSES[S.cls] ? CLASSES[S.cls].n : S.cls);
    return `<div class="iap-note">当前角色：<b>${NS.esc(cls)}</b> · ${rules} · 存档位 ${G.slot} · 等级上限 ${G.LEVEL_CAP}</div>`
      + ROWS.map(rowHTML).join('')
      + `<div class="iap-hint">改「最高阶段」会把「当前阶段」压到它以下；改阶段会让游戏重建关卡与怪物。
        折磨档位只在打完终章（新规则第 101 阶段）后才生效。</div>`;
  }

  function sync(root, key) {
    const r = ROWS.find(x => x.key === key);
    const row = root.querySelector(`[data-prog="${key}"]`);
    if (!r || !row) return;
    const cur = Number(r.get()) || 0;
    row.querySelector('[data-cur]').textContent = F.fmt(cur);
    const inp = row.querySelector('[data-in]');
    if (document.activeElement !== inp) inp.value = Math.floor(cur);
  }

  function limits(key) {
    const S = G.S;
    switch (key) {
      case 'level': return [1, G.LEVEL_CAP];
      case 'para': { const c = safe(() => paraLevelCap()); return [0, c === Infinity || c == null ? 1e6 : c]; }
      case 'maxStage': { const c = safe(() => ruleStageCap()); return [1, c === Infinity || c == null ? 1e6 : c]; }
      case 'stage': return [1, Math.max(1, S.maxStage || 1)];
      case 'tormentMax': return [0, G.RULES2.torment.max];
      case 'torment': return [0, Math.max(0, S.tormentMax || 0)];
      default: return [0, 1e9];
    }
  }

  function bind(root) {
    root.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-do]');
      if (!btn) return;
      const row = btn.closest('[data-prog]');
      if (!row) return;
      const r = ROWS.find(x => x.key === row.dataset.prog);
      if (!r) return;
      const [lo, hi] = limits(r.key);
      const cur = Number(r.get()) || 0;
      const typed = NS.parseNum(row.querySelector('[data-in]').value, cur);
      let next = cur;
      if (btn.dataset.do === 'set') next = typed;
      else if (btn.dataset.do === 'add') next = cur + typed;
      else if (btn.dataset.do === 'min') next = lo;
      next = Math.floor(NS.clampNum(next, lo, hi));
      r.set(next);
      NS.apply(true);
      ROWS.forEach(x => sync(root, x.key));
      if (next === hi && hi < 1e9) NS.toast(r.name + ' 已到上限 ' + hi);
    });
  }

  NS.registerTab({
    key: 'prog', name: '进度', render: render, bind: bind,
    sync: function (root) { ROWS.forEach(r => sync(root, r.key)); },
  });
})();
