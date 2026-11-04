'use strict';
/* ============================================================
   mod_yao.js — 炼妖壶页（DLC《炼妖壶》专用，游戏 3.0.0）
   ------------------------------------------------------------
   这一页只在 DLC 真的加载了时出现（tab.when → dlcReady('yao')）：没买的玩家看到的还是原来 7 页，
   不会点进去一片空白；买了的玩家也能一眼分清哪些内容是 DLC 带来的。
   可改：魂玉 / 朱砂 / 孟婆汤（A.yao.jade / cinnabar / soup）、残页每种 +1、妖魄每种 +10、
        收妖过滤档位（含「也管幼灵」）、灵器强化等级。
   只读：壶中妖灵数 / 容量、百妖谱、首领保底、幽冥进度、灵器灵力。
   工具：超度未收藏的低成长野生（两步确认，走游戏自己的 yaoRelease）、重看新手教程（tut = 0）。
   字段出处（dlc/yao/yao.js，官方模组系统的 DLC 目录，不在 asar 里）：
     · A.yao 的完整结构在 yaoNormAccount()：pot / jade / pages / soup / soupDay / cinnabar /
       pity / seen / filter / filterBaby / soul / tut / log / rng / seq；
     · 一只妖灵 = { id, sp, kind, apt[3], g, sk[], lock, keep? }（yaoNormSpirit，:114）——
       「收藏」是 keep（yaoKeep，:421），lock 是画押锁住的那条词条键，两者别搞反；
     · 超度走 yaoRelease(ids)（:415）：它自己算魂玉、记妖魄、压实数组，不要手删 pot；
     · 残页 pages[k] = [普通张数, 朱批张数]，k 是灵技键 / x: 秘技键 / jt:时机 / js:术（:211）；
     · 灵器灵力 = yaoItemPow(it)（:433）；孟婆汤今日免费 = yaoSoupFree()（:404）。
     幽冥在 dlc/yao/yao_yin.js：RF.expedition = 'yin'、RF.yin = 层数，YIN_BAL / YIN_ZONES。
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
  const pot = function () { const y = YA(); return y && Array.isArray(y.pot) ? y.pot : []; };
  const int = (v, d) => (Number.isFinite(v) ? Math.floor(v) : (d || 0));

  const SLOT_N = { weapon: '武器', offhand: '副手', helm: '头盔', shoulders: '护肩', armor: '护甲',
    gloves: '手套', belt: '腰带', pants: '腿甲', boots: '靴子', ring1: '戒指一', ring2: '戒指二', amulet: '护符' };

  /* 清理工具的两步确认状态：第一次点只把按钮改成「确认」，4 秒内再点才真的超度。
     模块级变量，render 时清掉（重绘 = 用户已经离开那一步）。 */
  let armClean = 0;

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

  /* 今天那碗孟婆汤还在不在（yao.js:404 yaoSoupFree：soupDay 是不是今天）。 */
  const soupFree = function () { try { return typeof yaoSoupFree === 'function' ? !!yaoSoupFree() : false; } catch (e) { return false; } };

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
     分类照 yao.js:219 的 yaoPageName：jt: 是诀页、js: 是术页，其余按秘技族（化 / 契 / 变）。 */
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
      <div class="iap-row"><div class="iap-lab"><b>按类统计</b><small>残页在批命时加灵技 / 秘技，朱批（高级）那一档按 0.15 的几率掉</small></div>
        <div class="iap-cds">${chips}</div>
        <button class="iap-btn" data-do="page+1" title="每种已有的残页各加 1 张">每种 +1</button>
      </div>
    </div>`;
  }

  /* ---------- 妖魄 ----------
     攒够 YAO_BAL.essence.need（10 个）能换一只同族幼灵（25% 异色），所以按钮直接 +10。 */
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
      <div class="iap-row"><div class="iap-lab"><b>给已有的种族补货</b><small>只补已经有妖魄的种族，不会凭空开新图鉴</small></div>
        <button class="iap-btn" data-do="soul+${need}" title="每种已有的妖魄各加 ${need} 个">每种 +${need}</button>
      </div>
    </div>`;
  }

  /* ---------- 壶的状态 / 收妖过滤 ---------- */
  function potHTML() {
    const y = YA(), p = pot();
    const cap = typeof yaoCap === 'function' ? (Number(yaoCap()) || 0) : 5000;
    const keep = p.filter(s => s && s.keep).length;
    const seen = typeof yaoSeenCount === 'function' ? (Number(yaoSeenCount()) || 0) : 0;
    let all = 0;
    try { all = typeof yaoSpecies === 'function' ? Object.keys(yaoSpecies()).length : 0; } catch (e) { all = 0; }
    const fmax = (typeof YAO_BAL === 'object' && YAO_BAL && YAO_BAL.filterMax) ? int(YAO_BAL.filterMax, 4) : 4;
    const filter = int(y && y.filter);
    const baby = !y || y.filterBaby !== 0;

    const fchips = [0, 1, 2, 3, 4, 5, 6].filter(n => n <= fmax).map(function (n) {
      return `<button class="iap-chip${filter === n ? ' on' : ''}" data-filter="${n}">${n ? n + ' 条' : '关'}</button>`;
    }).join('');

    const pity = (y && y.pity && typeof y.pity === 'object') ? Object.keys(y.pity).map(function (k) {
      const n = int(y.pity[k]);
      return n >= 1 ? `<i class="iap-cd${n >= pityMax() ? ' on' : ''}">${NS.esc(k)} ${n}/${pityMax()}</i>` : '';
    }).join('') : '';

    return `<div class="iap-sec"><div class="iap-sechd"><b>壶</b><small>只读 · 收妖过滤可调</small></div>
      <div class="iap-row"><div class="iap-lab"><b>妖灵</b><small>容量 ${cap}，满了会自动超度最差的（收藏的除外）</small></div>
        <div class="iap-cur"><i>${p.length} / ${cap}</i></div>
        <div class="iap-cur"><i>收藏 ${keep}</i></div></div>
      <div class="iap-row"><div class="iap-lab"><b>百妖谱</b><small>收录过的种族数（深渊附妖 + 幽冥 + 魂）</small></div>
        <div class="iap-cur"><i>${seen} / ${all}</i></div></div>
      <div class="iap-row"><div class="iap-lab"><b>收妖过滤</b><small>灵技少于档位的野生自动超度换魂玉；异色、降服首领、魂永远留下</small></div>
        <div class="iap-cds">${fchips}</div></div>
      <div class="iap-row"><div class="iap-lab"><b>过滤也管幼灵</b><small>关掉之后幼灵一律留下（缺省是开）</small></div>
        <div class="iap-cds"><button class="iap-chip${baby ? ' on' : ''}" data-baby="1">${baby ? '开' : '关'}</button></div></div>
      ${pity ? `<div class="iap-row"><div class="iap-lab"><b>首领保底</b><small>击败次数，攒满必降服一次</small></div>
        <div class="iap-cds">${pity}</div></div>` : ''}
    </div>`;
  }
  const pityMax = function () {
    try { return int(YAO_BAL.capture.pity, 15) || 15; } catch (e) { return 15; }
  };

  /* ---------- 清理野生 ----------
     只碰「野生 + 未收藏 + 未绑定 + 不是魂 + 成长低于阈值」的，走 yaoRelease 让它自己结算魂玉和妖魄。
     幼灵 / 异色 / 降服首领 / 魂 / 誓约之魂一律不动 —— 这些是玩家真正要留的
     （和游戏自己的 yaoBatchOk（yao.js:519）同一个判定口径，只是多一条成长阈值）。 */
  function cleanTargets(thr) {
    const isMing = function (s) {
      try { return typeof yaoIsMing === 'function' ? !!yaoIsMing(s) : false; } catch (e) { return false; }
    };
    return pot().filter(function (s) {
      return s && !s.keep && !s.bind && int(s.kind) === 0 && !isMing(s) && Number(s.g) < thr;
    }).map(s => s.id);
  }
  function cleanHTML() {
    const y = YA();
    const tut = !!(y && y.tut);
    /* 默认阈值 1.05（成长低于 1.05 算差苗子）；渲染时先算一次，不用等 bind 才显示 */
    const n = cleanTargets(1.05).length;
    return `<div class="iap-sec"><div class="iap-sechd"><b>工具</b><small>会改存档，操作前先看一眼数量</small></div>
      <div class="iap-row"><div class="iap-lab"><b>超度野生</b><small>未收藏、成长低于阈值的野生（走游戏的超度，会给魂玉和妖魄）</small></div>
        <input class="iap-in sm" type="text" inputmode="decimal" spellcheck="false" data-thr value="1.05" aria-label="成长阈值">
        <div class="iap-cur"><i data-cnt>${n} 只</i></div>
        <button class="iap-btn" data-clean>超度</button></div>
      <div class="iap-row"><div class="iap-lab"><b>新手教程</b><small>${tut ? '已经自动弹过了' : '还没弹过'} · 重置后下次打开炼妖壶会重新讲一遍</small></div>
        <button class="iap-btn" data-tut>重新播放</button></div>
    </div>`;
  }

  /* ---------- 灵器 ---------- */
  function lingList() {
    const S = G.S, out = [];
    if (!S || !S.equip) return out;
    (G.SLOTS || []).forEach(function (sl) {
      const it = S.equip[sl];
      if (it && it.ling) out.push({ sl, it });
    });
    return out;
  }
  function lingHTML() {
    const list = lingList();
    if (!list.length) {
      return `<div class="iap-sec"><div class="iap-sechd"><b>灵器</b><small>只读 · 当前角色身上没有</small></div>
        <div class="iap-hint">灵器要在游戏里「铸胚 → 入器」做出来：铸一件白装底子，把妖灵封进去。
          做好的灵器词条由器灵决定，护肝台只开放强化等级和宝石（装备页里改）。</div></div>`;
    }
    const rows = list.map(function (r) {
      const it = r.it, ling = it.ling || {};
      const name = ling.name || ling.k || '器灵';
      const pow = typeof yaoItemPow === 'function' ? (Number(yaoItemPow(it)) || 0) : 0;
      const asleep = typeof yaoAsleep === 'function' ? !!yaoAsleep() : false;
      return `<div class="iap-row" data-ling="${r.sl}">
        <div class="iap-lab"><b>${SLOT_N[r.sl] || r.sl} · ${NS.esc(name)}</b>
          <small>灵力 +${pow}% · 灵技 ${Array.isArray(ling.sk) ? ling.sk.length : 0} 条${asleep ? ' · 器灵沉睡中' : ''}</small></div>
        <div class="iap-cur"><i>+${int(it.plus)}</i></div>
        <input class="iap-in sm" type="text" inputmode="numeric" spellcheck="false" data-plus value="${int(it.plus)}" aria-label="强化等级">
        <button class="iap-btn" data-do="plus">设为</button>
      </div>`;
    }).join('');
    return `<div class="iap-sec"><div class="iap-sechd"><b>灵器</b><small>强化 0 ~ ${G.MAX_PLUS} · 词条由器灵决定，不在这里改</small></div>${rows}</div>`;
  }

  /* ---------- 幽冥 ---------- */
  function yinInfo() {
    let R = null;
    try { R = (typeof RF !== 'undefined' && RF) ? RF : null; } catch (e) { R = null; }
    const on = !!(R && R.expedition === 'yin' && R.yin);
    const lv = on ? (Number(R.yin) || 0) : 0;
    const zones = (typeof YIN_ZONES !== 'undefined' && Array.isArray(YIN_ZONES)) ? YIN_ZONES : [];
    const per = (typeof YIN_BAL === 'object' && YIN_BAL) ? (int(YIN_BAL.per, 10) || 10) : 10;
    const idx = on && zones.length ? Math.floor((lv - 1) / per) % zones.length : -1;
    const unlock = (typeof YIN_BAL === 'object' && YIN_BAL) ? int(YIN_BAL.unlock, 30) : 30;
    return { on, lv, zones, per, idx, unlock };
  }
  function yinHTML() {
    const y = yinInfo();
    const S = G.S;
    const maxStage = S ? (Number(S.maxStage) || 0) : 0;
    const isEnvoy = S && S.cls === 'envoy';
    const open = isEnvoy || maxStage >= y.unlock;
    const chips = y.zones.map(function (z, i) {
      return `<i class="iap-cd${i === y.idx ? ' on' : ''}">${NS.esc(z.name || ('第 ' + (i + 1) + ' 区'))}</i>`;
    }).join('');
    return `<div class="iap-sec"><div class="iap-sechd"><b>幽冥</b><small>只读 · 深渊之外的独立地图</small></div>
      <div class="iap-row"><div class="iap-lab"><b>当前</b><small>${y.on ? '正在幽冥里刷' : '不在幽冥（在主线 / 秘境 / 团本）'}</small></div>
        <div class="iap-cur"><i>${y.on ? '第 ' + y.lv + ' 层' : '—'}</i></div></div>
      <div class="iap-row"><div class="iap-lab"><b>解锁条件</b><small>拥有 DLC，且主线到第 ${y.unlock} 阶段；孟萤一开始就能进</small></div>
        <div class="iap-cur"><i>${open ? '已解锁' : '未解锁'}</i></div></div>
      <div class="iap-row"><div class="iap-lab"><b>五区</b><small>每区 ${y.per} 层，${y.per * (y.zones.length || 5)} 层以后循环，越打越深</small></div>
        <div class="iap-cds">${chips || '<span class="dim">没有读到幽冥区表</span>'}</div></div>
    </div>`;
  }

  /* ---------- 页 ---------- */
  function render() {
    const S = G.S, A = G.A;
    if (!S || !S.cls) return `<div class="iap-empty">还没有进入角色，先选一个英雄再打开护肝台。</div>`;
    if (!A) return `<div class="iap-empty">账号档还没就绪（读档中），稍等再试。</div>`;
    if (!YA()) return `<div class="iap-empty bad">炼妖壶的账号档读不出来（A.yao 结构异常），先回游戏里打开一次炼妖壶。</div>`;
    armClean = 0;
    return `<div class="iap-note">这一页只在拥有 <b>DLC《炼妖壶》</b> 时出现。改完立刻写入存档，数值可以填 <b>1.5万</b> / <b>3k</b> 这种简写。</div>`
      + `<div class="iap-sec"><div class="iap-sechd"><b>资源</b><small>账号共用 · 魂玉 / 朱砂 / 孟婆汤</small></div>`
      + ROWS.map(rowHTML).join('') + '</div>'
      + pageHTML() + essenceHTML() + potHTML() + cleanHTML() + lingHTML() + yinHTML();
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
  function syncCount(root) {
    const el = root.querySelector('[data-cnt]');
    if (!el) return;
    const inp = root.querySelector('[data-thr]');
    const thr = Number(inp && inp.value) || 1.05;
    el.textContent = cleanTargets(thr).length + ' 只';
  }
  function sync(root) {
    ROWS.forEach(r => syncRow(root, r.key));
    syncCount(root);
  }

  /* ---------- 交互 ----------
     点击分成几路：过滤档位 / 幼灵开关 / 清理 / 教程 / 带 data-do 的按钮（灵器强化、残页、妖魄、资源行）。
     注意过滤档位和幼灵开关是 iap-chip，没有 data-do，所以不能先按 [data-do] 过滤。 */
  function bind(root) {
    root.addEventListener('click', function (e) {
      /* 收妖过滤档位 */
      const fchip = e.target.closest('[data-filter]');
      if (fchip) {
        const y = YA(); if (!y) return;
        const fmax = (typeof YAO_BAL === 'object' && YAO_BAL && YAO_BAL.filterMax) ? int(YAO_BAL.filterMax, 4) : 4;
        y.filter = Math.max(0, Math.min(fmax, int(Number(fchip.dataset.filter))));
        NS.apply(false);
        NS.panel.refresh();
        return;
      }

      /* 「也管幼灵」开关 */
      const baby = e.target.closest('[data-baby]');
      if (baby) {
        const y = YA(); if (!y) return;
        y.filterBaby = y.filterBaby === 0 ? 1 : 0;
        NS.apply(false);
        NS.panel.refresh();
        return;
      }

      /* 清理：两步确认，第一次点只把按钮改成「确认超度 N 只」 */
      const cl = e.target.closest('[data-clean]');
      if (cl) {
        const inp = root.querySelector('[data-thr]');
        const thr = Number(inp && inp.value) || 1.05;
        const ids = cleanTargets(thr);
        if (!ids.length) { NS.toast('没有符合条件的野生', true); return; }
        if (!armClean) {
          armClean = 1;
          cl.textContent = '确认超度 ' + ids.length + ' 只';
          cl.classList.add('pri');
          setTimeout(function () { armClean = 0; if (cl.isConnected) { cl.textContent = '超度'; cl.classList.remove('pri'); } }, 4000);
          return;
        }
        armClean = 0;
        let r = null;
        try { r = typeof yaoRelease === 'function' ? yaoRelease(ids) : null; } catch (e) { r = null; }
        if (!r) { NS.toast('超度失败：游戏里没有 yaoRelease', true); return; }
        NS.apply(false);
        NS.toast('超度 ' + r.n + ' 只 · 魂玉 +' + r.jade);
        NS.panel.refresh();
        return;
      }

      /* 教程重播 */
      const tut = e.target.closest('[data-tut]');
      if (tut) {
        const y = YA(); if (!y) return;
        y.tut = 0;
        NS.apply(false);
        NS.toast('下次打开炼妖壶会重新讲一遍');
        NS.panel.refresh();
        return;
      }

      const btn = e.target.closest('[data-do]');
      if (!btn) return;
      const act = btn.dataset.do;

      /* 灵器的强化 */
      if (act === 'plus') {
        const row = btn.closest('[data-ling]');
        if (!row) return;
        const S = G.S, it = S && S.equip ? S.equip[row.dataset.ling] : null;
        if (!it) return;
        const inp = row.querySelector('[data-plus]');
        const v = Math.max(0, Math.min(Number(G.MAX_PLUS) || 15, int(NS.parseNum(inp.value, it.plus))));
        it.plus = v;
        NS.apply(true);
        NS.toast('强化等级 +' + v);
        NS.panel.refresh();
        return;
      }

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

    /* 阈值输入：只更新「将超度几只」，不写档 */
    root.addEventListener('input', function (e) {
      if (e.target.closest('[data-thr]')) syncCount(root);
    });
    syncCount(root);
  }

  NS.registerTab({
    key: 'yao', name: '炼妖壶', render: render, bind: bind, sync: sync,
    when: dlcYao,          // 没买 / 没下载 DLC 时这一页整个不出现（按钮都不建）
  });
})();
