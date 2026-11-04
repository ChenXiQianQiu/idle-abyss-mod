'use strict';
/* ============================================================
   mod_yao.js — 炼妖壶页（DLC《炼妖壶》专用，游戏 3.0.0）
   ------------------------------------------------------------
   这一页只在 DLC 真的加载了时出现（tab.when → dlcReady('yao')）：没买的玩家看到的还是原来 7 页，
   买了的玩家也能一眼分清哪些内容是 DLC 带来的。
   页里只放**游戏自己做不了的事**，也就是改账号资源：
     · 魂玉 / 朱砂 / 孟婆汤 —— 游戏里只能刷出来
     · 残页每种 +1 —— 游戏里只有掉落和魂玉抽两种来源
     · 妖魄每种 +N —— 游戏里只能靠超度攒
   游戏自己的炼妖壶窗口已经有的东西这里一律不重复：收妖过滤档位与「过滤也管幼灵」
   （yao_ui.js:104）、批量超度与批量炼妖（:130、:198）、教程（:385）、幽冥进度与五区（:347）、
   灵器页（试穿 / 拓印 / 铸胚）、百妖谱。灵器的强化等级在**装备页**里改（装备页对所有已穿装备通用），
   这里也不再列一遍。
   字段出处（dlc/yao/yao.js，官方模组系统的 DLC 目录，不在 asar 里）：
     · A.yao 的完整结构在 yaoNormAccount()（:134）：jade / cinnabar / soup / soupDay / pages / soul …
     · 残页 pages[k] = [普通张数, 朱批张数]（:211、yaoGainPage:224），
       k 是灵技键 / x: 秘技键 / jt:时机 / js:术，分类照 yaoPageName（:219）；
     · 妖魄 soul[种族] = 个数，YAO_BAL.essence.need（10）个换一只同族幼灵；
     · 孟婆汤今日免费 = yaoSoupFree()（:404）。
   写档一律走 NS.apply(false)：游戏 save() → saveAccount() + 角色档，账号档跟着落盘。
   ============================================================ */
(function () {
  const NS = window.IAPM, G = NS.G, F = NS.fn;

  /* ---------- DLC 与账号档 ---------- */
  /* 页签门槛用 dlcReady（买了 + DLC 的代码真的加载了，dlc.js:29）而不是 dlcOwned：
     买了但 Steam 库里没勾选下载 DLC 时，yao.js 那些函数一个都不存在，这一页只会是空壳，
     不如干脆不显示 —— 和游戏里「灵器沉睡、孟萤上锁」的口径一致。 */
  const dlcYao = function () {
    try {
      if (typeof dlcReady === 'function') return !!dlcReady('yao');
      return typeof dlcOwned === 'function' && !!dlcOwned('yao');
    } catch (e) { return false; }
  };
  /* A.yao 缺了就按游戏自己的 yaoNormAccount() 补一份完整的
     （和资源页补 S.abyss 同一个写法：结构别手写，交给游戏）。 */
  const YA = function () {
    const A = G.A; if (!A) return null;
    if (!A.yao || typeof A.yao !== 'object' || Array.isArray(A.yao)) {
      try { if (typeof yaoNormAccount === 'function') yaoNormAccount(); } catch (e) { }
    }
    const y = A.yao;
    return y && typeof y === 'object' && !Array.isArray(y) ? y : null;
  };
  const int = (v, d) => (Number.isFinite(v) ? Math.floor(v) : (d || 0));

  /* 今天那碗孟婆汤还在不在（yao.js:404 yaoSoupFree：soupDay 是不是今天）。 */
  const soupFree = function () { try { return typeof yaoSoupFree === 'function' ? !!yaoSoupFree() : false; } catch (e) { return false; } };

  /* ---------- 资源 ---------- */
  const ROWS = [
    {
      key: 'jade', name: '魂玉', sub: '壶里的钱 · 批命 / 画押 / 入器 / 拓印 · 账号共用', max: 1e9,
      get: () => (YA() || {}).jade, set: v => { const y = YA(); if (y) y.jade = v; },
    },
    {
      key: 'cinnabar', name: '朱砂', sub: '画押锁一条词条 · 每次 1 个 · 账号共用', max: 1e6,
      get: () => (YA() || {}).cinnabar, set: v => { const y = YA(); if (y) y.cinnabar = v; },
    },
    {
      key: 'soup', name: '孟婆汤', sub: () => '重洗一只妖灵 · ' + (soupFree() ? '今天那碗还没用（免费）' : '今天免费的已经用了'), max: 999,
      get: () => (YA() || {}).soup, set: v => { const y = YA(); if (y) y.soup = v; },
    },
  ];

  function rowHTML(r) {
    const cur = Number(r.get()) || 0;
    const sub = typeof r.sub === 'function' ? r.sub() : r.sub;
    return `<div class="iap-row" data-res="${r.key}">
      <div class="iap-lab"><b>${r.name}</b><small>${sub}</small></div>
      <div class="iap-cur"><i data-cur>${F.fmt(cur)}</i></div>
      <input class="iap-in" type="text" inputmode="decimal" spellcheck="false" data-in value="${Math.floor(cur)}" aria-label="${r.name}">
      <button class="iap-btn" data-do="set" title="设为输入框里的数值">设为</button>
      <button class="iap-btn" data-do="add" title="在当前值上加上输入框里的数值">＋</button>
      <button class="iap-btn ghost" data-do="zero" title="清零">清零</button>
    </div>`;
  }

  /* ---------- 残页 ----------
     分类照 yao.js:219 的 yaoPageName：jt: 是诀页、js: 是术页，其余按秘技族（化 / 契 / 变）。
     这里只汇总张数 + 一键每种 +1；具体哪一张、还剩几张在游戏的壶中页里看。 */
  const FAM_N = { hua: '化页', qi: '契页', bian: '变页', jue: '诀页', shu: '术页' };
  const FAM_ORDER = ['hua', 'qi', 'bian', 'jue', 'shu'];
  function famOf(k) {
    if (/^jt:/.test(k)) return 'jue';
    if (/^js:/.test(k)) return 'shu';
    try { const f = typeof yaoPageFam === 'function' ? yaoPageFam(k) : ''; return FAM_N[f] ? f : 'hua'; } catch (e) { return 'hua'; }
  }
  function pageStat() {
    const y = YA(), out = { hua: 0, qi: 0, bian: 0, jue: 0, shu: 0 };
    let kinds = 0;
    if (y && y.pages && typeof y.pages === 'object') {
      Object.keys(y.pages).forEach(function (k) {
        const p = Array.isArray(y.pages[k]) ? y.pages[k] : [];
        const n = int(p[0]) + int(p[1]);
        if (n <= 0) return;
        out[famOf(k)] += n; kinds++;
      });
    }
    return { out, kinds };
  }
  function pageHTML() {
    const st = pageStat(), total = FAM_ORDER.reduce((n, f) => n + st.out[f], 0);
    const chips = FAM_ORDER.map(function (f) {
      const n = st.out[f];
      return `<i class="iap-cd${n ? ' on' : ''}">${FAM_N[f]} ${n}</i>`;
    }).join('');
    return `<div class="iap-sec"><div class="iap-sechd"><b>残页</b><small>共 ${total} 张 · ${st.kinds} 种 · 账号共用</small></div>
      <div class="iap-row"><div class="iap-lab"><b>每种 +1</b><small>只给已经有的残页加，加在普通档（不发朱批）</small></div>
        <div class="iap-cds">${chips}</div>
        <button class="iap-btn" data-do="page+1" title="每种已有的残页各加 1 张">每种 +1</button>
      </div>
    </div>`;
  }

  /* ---------- 妖魄 ----------
     攒够 YAO_BAL.essence.need（10 个）能换一只同族幼灵（25% 异色），所以按钮直接 +10。
     只补已经有妖魄的种族，不凭空开图鉴。 */
  function essenceStat() {
    const y = YA(), s = y && y.soul && typeof y.soul === 'object' ? y.soul : {};
    let total = 0, kinds = 0;
    Object.keys(s).forEach(function (k) { const n = int(s[k]); if (n > 0) { total += n; kinds++; } });
    return { total, kinds };
  }
  function essenceHTML() {
    const st = essenceStat();
    const need = (typeof YAO_BAL === 'object' && YAO_BAL && YAO_BAL.essence) ? int(YAO_BAL.essence.need, 10) : 10;
    return `<div class="iap-sec"><div class="iap-sechd"><b>妖魄</b><small>共 ${st.total} 个 · ${st.kinds} 种 · 每 ${need} 个换一只同族幼灵</small></div>
      <div class="iap-row"><div class="iap-lab"><b>每种 +${need}</b><small>只补已经有妖魄的种族，不会凭空开新图鉴</small></div>
        <button class="iap-btn" data-do="soul+${need}" title="每种已有的妖魄各加 ${need} 个">每种 +${need}</button>
      </div>
    </div>`;
  }

  /* ---------- 页 ---------- */
  function render() {
    const S = G.S, A = G.A;
    if (!S || !S.cls) return `<div class="iap-empty">还没有进入角色，先选一个英雄再打开护肝台。</div>`;
    if (!A) return `<div class="iap-empty">账号档还没就绪（读档中），稍等再试。</div>`;
    if (!YA()) return `<div class="iap-empty bad">炼妖壶的账号档读不出来（A.yao 结构异常），先回游戏里打开一次炼妖壶。</div>`;
    return `<div class="iap-note">这一页只在拥有 <b>DLC《炼妖壶》</b> 时出现，只放<b>游戏里做不到的事</b>：
      改魂玉 / 朱砂 / 孟婆汤、补残页与妖魄。收妖过滤、批量超度与炼妖、灵器、幽冥进度都在游戏自己的
      炼妖壶窗口里，这里不重复；灵器的强化等级请到<b>装备页</b>改。</div>`
      + `<div class="iap-sec"><div class="iap-sechd"><b>资源</b><small>账号共用 · 改完立刻写入存档，可填 1.5万 / 3k 这种简写</small></div>`
      + ROWS.map(rowHTML).join('') + '</div>'
      + pageHTML() + essenceHTML();
  }

  /* ---------- 同步（1 秒一次，只刷数字） ---------- */
  function syncRow(root, key) {
    const r = ROWS.find(x => x.key === key);
    const row = root.querySelector(`[data-res="${key}"]`);
    if (!r || !row) return;
    const cur = Number(r.get()) || 0;
    row.querySelector('[data-cur]').textContent = F.fmt(cur);
    const inp = row.querySelector('[data-in]');
    if (document.activeElement !== inp) inp.value = Math.floor(cur);
  }
  function sync(root) { ROWS.forEach(r => syncRow(root, r.key)); }

  /* ---------- 交互 ---------- */
  function bind(root) {
    root.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-do]');
      if (!btn) return;
      const act = btn.dataset.do;

      /* 残页：每种已有的各 +1（加在普通那一档，朱批不凭空发） */
      if (act === 'page+1') {
        const y = YA(); if (!y || !y.pages) return;
        let n = 0;
        Object.keys(y.pages).forEach(function (k) {
          const p = Array.isArray(y.pages[k]) ? y.pages[k] : null;
          if (!p || (int(p[0]) + int(p[1])) <= 0) return;
          p[0] = int(p[0]) + 1; n++;
        });
        if (!n) { NS.toast('还没有任何残页', true); return; }
        NS.apply(false);
        NS.toast(n + ' 种残页各 +1');
        NS.panel.refresh();
        return;
      }

      /* 妖魄：每种已有的各 +need */
      if (/^soul\+/.test(act)) {
        const y = YA(); if (!y) return;
        const add = int(Number(act.slice(5)), 10) || 10;
        if (!y.soul || typeof y.soul !== 'object') y.soul = {};
        let n = 0;
        Object.keys(y.soul).forEach(function (k) {
          if (int(y.soul[k]) <= 0) return;
          y.soul[k] = Math.min(1e9, int(y.soul[k]) + add); n++;
        });
        if (!n) { NS.toast('还没有任何妖魄', true); return; }
        NS.apply(false);
        NS.toast(n + ' 种妖魄各 +' + add);
        NS.panel.refresh();
        return;
      }

      /* 资源行的 设为 / ＋ / 清零 */
      const row = btn.closest('[data-res]');
      if (!row) return;
      const r = ROWS.find(x => x.key === row.dataset.res);
      if (!r) return;
      const inp = row.querySelector('[data-in]');
      const cur = Number(r.get()) || 0;
      const typed = NS.parseNum(inp.value, cur);
      let next = cur;
      if (act === 'set') next = typed;
      else if (act === 'add') next = cur + typed;
      else if (act === 'zero') next = 0;
      next = Math.max(0, Math.min(r.max, Math.floor(next)));
      r.set(next);
      NS.apply(false);
      syncRow(root, r.key);
      if (r.max !== 1e9 && next >= r.max) NS.toast(r.name + ' 已达上限 ' + r.max);
    });
  }

  NS.registerTab({
    key: 'yao', name: '炼妖壶', render: render, bind: bind, sync: sync,
    when: dlcYao,          // 没买 / 没下载 DLC 时这一页整个不出现（按钮都不建）
  });
})();
