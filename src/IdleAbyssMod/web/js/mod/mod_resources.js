'use strict';
/* ============================================================
   mod_resources.js — 资源页
   ------------------------------------------------------------
   可改：金币 / 魂晶 / 余烬之魂 / 秘境钥匙 / 钥匙碎片 / 扭蛋券 / 强化祝福 /
        王庭锭 / 王庭碎片（三档难度）/ 最后的余烬 / 宝石（6 种 × 5 品级）。
   字段出处（存档结构）：state.js 的 newState()（gold / souls / rift.keys / rift.frag /
   gacha.tickets / gacha.bless）与 newAccount()（shards / gems / raid.ingots / raid.frag）；
   最后的余烬在账号档的 A.ultra.embers（ultra.js:29 ultraNormAccount 里规范化）。
   魂晶与宝石是账号级数据，S.shards / S.gems 是 state.js bindAccount() 挂上去的
   存取器，写 S.shards 等价于写 A.shards，所以这里统一走 S，让游戏自己处理落盘。
   ============================================================ */
(function () {
  const NS = window.IAP, G = NS.G, F = NS.fn;

  /* 单值资源行。get / set 都写成函数，避免读档换角色后指向旧对象。 */
  const ROWS = [
    {
      key: 'gold', name: '金币', sub: '强化 / 附魔 / 扭蛋 · 角色存档',
      get: () => (G.S || {}).gold, set: v => { G.S.gold = v; }, max: 1e15,
    },
    {
      key: 'shards', name: '魂晶', sub: '强化 / 附魔 / 魔盒 · 账号共用',
      get: () => (G.S || {}).shards, set: v => { G.S.shards = v; }, max: 1e15,
    },
    {
      key: 'souls', name: '余烬之魂', sub: '分解传奇 / 魔盒 / 重铸 · 角色存档',
      get: () => (G.S || {}).souls, set: v => { G.S.souls = v; }, max: 1e15,
    },
    {
      key: 'keys', name: '秘境钥匙', sub: '上限 50（读档时会被夹住）',
      get: () => ((G.S || {}).rift || {}).keys, set: v => { G.S.rift.keys = v; }, max: G.KEY_CAP,
    },
    {
      /* combat.js:323 keyShard()：满 KEY_SHARDS(10) 个就自动换成 1 把钥匙，
         所以正常状态下碎片最多 9 个；这里按 9 封顶，避免出现「10/10 却不换」的怪状态。 */
      key: 'keyFrag', name: '钥匙碎片', sub: '精英掉落 · 满 10 个自动换 1 把钥匙',
      get: () => ((G.S || {}).rift || {}).frag, set: v => { G.S.rift.frag = v; }, max: 9,
    },
    {
      key: 'tickets', name: '扭蛋券', sub: '扭蛋机抽奖用',
      get: () => ((G.S || {}).gacha || {}).tickets, set: v => { G.S.gacha.tickets = v; }, max: 1e9,
    },
    {
      /* gacha.js:16 的 gachaNorm 只要求 >=0 的整数，没有硬上限；
         gachaBlessOn() = S.gacha.blessOn && S.gacha.bless>0，所以只要数量 >0 就会生效。 */
      key: 'bless', name: '强化祝福', sub: '下次强化必定成功 · 扭蛋 / 熔炉获得',
      get: () => ((G.S || {}).gacha || {}).bless, set: v => { G.S.gacha.bless = v; }, max: 1e9,
    },
    {
      key: 'ingots', name: '王庭锭', sub: '团本兑换 · 账号共用',
      get: () => ((G.A || {}).raid || {}).ingots, set: v => { G.A.raid.ingots = v; }, max: 1e9,
    },
    {
      key: 'fragN', name: '王庭碎片 · 普通', sub: '团本碎片 · 账号共用',
      get: () => (((G.A || {}).raid || {}).frag || {}).n, set: v => { G.A.raid.frag.n = v; }, max: 1e9,
    },
    {
      key: 'fragH', name: '王庭碎片 · 英雄', sub: '团本碎片 · 账号共用',
      get: () => (((G.A || {}).raid || {}).frag || {}).h, set: v => { G.A.raid.frag.h = v; }, max: 1e9,
    },
    {
      key: 'fragM', name: '王庭碎片 · 神话', sub: '团本碎片 · 账号共用',
      get: () => (((G.A || {}).raid || {}).frag || {}).m, set: v => { G.A.raid.frag.m = v; }, max: 1e9,
    },
    {
      /* 最后的余烬 = A.ultra.embers（ultra.js:157），超高难本每个首领每周首杀给，
         用于铁匠的「终焉升华」（ultraAscCost 每次 1 个，ULTRA_ASC.embers）。
         ultraNormAccount（ultra.js:29）只认「> 0 的整数」，写浮点会在读档时被清零，
         所以这里 Math.floor；A.ultra 不存在时按 ultraNewAcc() 的结构补一个完整的，
         否则 ultra.js 里 Object.keys(A.ultra.sig) 这类代码会炸。 */
      key: 'embers', name: '最后的余烬', sub: '超高难本 · 终焉升华 · 账号共用',
      get: () => (((G.A || {}).ultra || {}).embers),
      set: v => {
        const A = G.A;
        if (!A) return;
        if (!A.ultra || typeof A.ultra !== 'object') {
          A.ultra = (typeof ultraNewAcc === 'function' ? ultraNewAcc() : null)
            || { intro: false, week: 0, prog: 0, best: 0, name: '', cleared: false, embers: 0, got: {}, wall: [], sig: {} };
        }
        A.ultra.embers = Math.max(0, Math.floor(v));
      },
      max: 1e6,
    },
  ];

  function rowHTML(r) {
    const cur = Number(r.get()) || 0;
    return `<div class="iap-row" data-res="${r.key}">
      <div class="iap-lab"><b>${r.name}</b><small>${r.sub}</small></div>
      <div class="iap-cur"><i data-cur>${F.fmt(cur)}</i></div>
      <input class="iap-in" type="text" inputmode="decimal" spellcheck="false" data-in value="${Math.floor(cur)}" aria-label="${r.name}">
      <button class="iap-btn" data-do="set" title="设为输入框里的数值">设为</button>
      <button class="iap-btn" data-do="add" title="在当前值上加上输入框里的数值">＋</button>
      <button class="iap-btn ghost" data-do="zero" title="清零">清零</button>
    </div>`;
  }

  function gemHTML() {
    const keys = G.GEM_KEYS, grade = G.GEM_GRADE;
    const head = grade.map(g => `<i>${g || '普通'}</i>`).join('');
    const rows = keys.map(function (k) {
      const gem = G.GEMS[k];
      const cells = [0, 1, 2, 3, 4].map(function (q) {
        const n = ((G.A || {}).gems || {})[k] ? G.A.gems[k][q] : 0;
        return `<input class="iap-in sm" type="text" inputmode="numeric" spellcheck="false" data-gem="${k}" data-q="${q}" value="${Math.floor(n)}" aria-label="${gem.n}${grade[q] || ''}">`;
      }).join('');
      return `<div class="iap-gemrow"><span class="iap-gemname" style="color:${gem.c[0]}">${gem.n}</span>${cells}</div>`;
    }).join('');
    return `<div class="iap-sec"><div class="iap-sechd"><b>宝石库存</b><small>账号共用 · 0 级 = 碎裂的，4 级 = 皇家</small></div>
      <div class="iap-gemhead"><span></span>${head}</div>${rows}</div>`;
  }

  function render() {
    const S = G.S, A = G.A;
    if (!S || !S.cls) return `<div class="iap-empty">还没有进入角色，先选一个英雄再打开调试台。</div>`;
    if (!A) return `<div class="iap-empty">账号档还没就绪（读档中），稍等再试。</div>`;
    return `<div class="iap-note">改完立刻写入存档。数值可以填 <b>1.5万</b> / <b>2亿</b> / <b>3k</b> 这种简写。</div>`
      + ROWS.map(rowHTML).join('')
      + gemHTML();
  }

  function syncRow(root, key) {
    const r = ROWS.find(x => x.key === key);
    const row = root.querySelector(`[data-res="${key}"]`);
    if (!r || !row) return;
    const cur = Number(r.get()) || 0;
    row.querySelector('[data-cur]').textContent = F.fmt(cur);
    const inp = row.querySelector('[data-in]');
    if (document.activeElement !== inp) inp.value = Math.floor(cur);
  }

  function syncGems(root) {
    root.querySelectorAll('[data-gem]').forEach(function (inp) {
      const arr = ((G.A || {}).gems || {})[inp.dataset.gem];
      const v = arr ? arr[Number(inp.dataset.q)] : 0;
      if (document.activeElement !== inp) inp.value = Math.floor(v || 0);
    });
  }

  function bind(root) {
    root.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-do]');
      if (!btn) return;
      const row = btn.closest('[data-res]');
      if (!row) return;
      const r = ROWS.find(x => x.key === row.dataset.res);
      if (!r) return;
      const inp = row.querySelector('[data-in]');
      const cur = Number(r.get()) || 0;
      const typed = NS.parseNum(inp.value, cur);
      let next = cur;
      if (btn.dataset.do === 'set') next = typed;
      else if (btn.dataset.do === 'add') next = cur + typed;
      else if (btn.dataset.do === 'zero') next = 0;
      next = Math.max(0, Math.min(r.max, Math.floor(next)));
      r.set(next);
      NS.apply(false);
      syncRow(root, r.key);
      if (r.max !== 1e15 && next >= r.max) NS.toast(r.name + ' 已达上限 ' + r.max);
    });

    root.addEventListener('change', function (e) {
      const inp = e.target.closest('[data-gem]');
      if (!inp) return;
      const k = inp.dataset.gem, q = Number(inp.dataset.q);
      const arr = ((G.A || {}).gems || {})[k];
      if (!arr) return;
      const v = Math.max(0, Math.min(9999, Math.floor(NS.parseNum(inp.value, arr[q]))));
      arr[q] = v;
      NS.apply(false);
      syncGems(root);
    });
  }

  NS.registerTab({ key: 'res', name: '资源', render: render, bind: bind, sync: function (root) { ROWS.forEach(r => syncRow(root, r.key)); syncGems(root); } });
})();
