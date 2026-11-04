'use strict';
/* ============================================================
   mod_yao.js — 炼妖壶页（DLC《炼妖壶》专用，游戏 3.0.0）
   ------------------------------------------------------------
   这一页只在 DLC 真的加载了时出现（tab.when → dlcReady('yao')）：没买的玩家看到的还是原来 7 页，
   买了的玩家也能一眼分清哪些内容是 DLC 带来的。
   页里只放**游戏自己做不了的事**，分成两个子页签：

   【资源】改账号资源
     · 魂玉 / 朱砂 / 孟婆汤 —— 游戏里只能刷出来
     · 残页每种 +1 —— 游戏里只有掉落和魂玉抽两种来源
     · 妖魄每种 +N —— 游戏里只能靠超度攒
   游戏自己的炼妖壶窗口已经有的东西这里一律不重复：收妖过滤档位与「过滤也管幼灵」
   （yao_ui.js:104）、批量超度与批量炼妖（:130、:198）、教程（:385）、幽冥进度与五区（:347）、
   灵器页（试穿 / 拓印 / 铸胚）、百妖谱。灵器的强化等级在**装备页**里改。

   【妖灵】改单只妖灵（游戏里只能靠收妖 / 炼妖 / 孟婆汤重洗，改不了具体数值）
     · 种族（决定名字与五行）、品质（野生 / 幼灵 / 异色）、资质三项、成长
     · 灵技（词条 + 普通 / 高级）与秘技（元素化 / 状态化 / 词条化 / 契 / 诀 / 变 / 鸣 / 拓印）
     · 自带灵力没有独立字段，靠「目标灵力 → 反算成长」调

   字段出处（dlc/yao/yao.js，官方模组系统的 DLC 目录，不在 asar 里）：
     · A.yao 的完整结构在 yaoNormAccount()（:134）：jade / cinnabar / soup / soupDay / pages / soul / pot …
     · 残页 pages[k] = [普通张数, 朱批张数]（:211、yaoGainPage:224），
       k 是灵技键 / x: 秘技键 / jt:时机 / js:术，分类照 yaoPageName（:219）；
     · 妖魄 soul[种族] = 个数，YAO_BAL.essence.need（10）个换一只同族幼灵；
     · 孟婆汤今日免费 = yaoSoupFree()（:404）。
     · 一只妖灵 = { id, sp 种族键, kind 0 野生 / 1 幼灵 / 2 异色, apt:[攻资,御资,灵资],
                    g 成长, sk:[{k,hi}] 灵技与秘技同一张表, lock 画押的键, keep 收藏, bind 誓约绑定 }
     · yaoNormSpirit()（:114）是**读档时的重建**：apt 夹到 300~3000、g 夹到 0.5~1.5、
       sk 只认 YAO_KEYS 与 YAO_MI 里的键、去重、最多 16 条（带「骊龙之魂」时 18）、
       秘技最多 4 条且 hi 强制 0。这里每次改完都按同一套规则收敛，保证「看到的 = 存下来的」。
     · 自带灵力**没有字段**：yaoItemPow()（:433）= Σ(普通 1% / 高级 2% / 秘技 1.5%) × 成长。
     · 每条灵技的数值（yaoLine:424）= 王庭满值 × 档位 × (资质[按词条类别]/1300，夹 0.7~1.2) × 成长，
       所以改资质 / 成长会直接改灵器上的词条数值，灵器要调 yaoItemFix 重建。
     · 灵器上的器灵是入器时的**深拷贝**（yaoImbue:469，还删了 id），改了壶里的不会同步过去，
       所以目标下拉框把「壶中」和「灵器上」分成两类；改灵器上的那份才立刻生效。
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

  /* ============================================================
     妖灵编辑
     ------------------------------------------------------------
     所有改动都在**游戏自己的数据结构**上做，然后交给游戏的规则收敛：
       tidy()   ← 和 yaoNormSpirit() 同一套夹取（资质 300~3000、成长 0.5~1.5、
                  条数 16 / 骊龙 18、秘技 ≤4 且 hi=0、去重、键必须存在）
       commit() → yaoItemFix()（灵器目标才需要，重建词条与名字）→ NS.apply(false)
     状态只有两个模块级变量（sel 选中的目标、view 子页签、fam 加秘技时的类别），
     因为面板每次刷新都会把整块 DOM 重建，状态不能放在 DOM 上。
     ============================================================ */
  let view = 'res';                                  // res / sp
  let sel = { src: 'pot', id: '' };                  // 当前编辑的目标
  let fam = 'el';                                    // 「＋ 秘技」用哪个族

  const KIND_N = ['野生', '幼灵', '异色'];
  const WX_N = ['木行', '火行', '土行', '金行', '水行'];
  const MI_FAM = [['el', '元素化'], ['as', '状态化'], ['cv', '词条化'], ['qi', '契'], ['jue', '诀'], ['bian', '变'], ['ming', '鸣'], ['tuo', '拓印']];

  const species = function () { try { return typeof yaoSpecies === 'function' ? yaoSpecies() : {}; } catch (e) { return {}; } };
  const isMi = function (k) { return typeof k === 'string' && k.indexOf('x:') === 0; };
  const miOk = function (k) { try { return typeof yaoMiOk === 'function' ? !!yaoMiOk(k) : false; } catch (e) { return false; } };
  const miMax = function () { return typeof YAO_MI_MAX === 'number' ? YAO_MI_MAX : 4; };
  /* 灵技条数上限：带「骊龙之魂」的 18 条，其余 16（yao_ming.js:136 yaoLineCap）。 */
  const capOf = function (s) {
    try { if (typeof yaoLineCap === 'function') return yaoLineCap(s); } catch (e) { }
    const base = (typeof YAO_BAL === 'object' && YAO_BAL && YAO_BAL.fuse) ? int(YAO_BAL.fuse.cap, 16) : 16;
    return (s && (s.sk || []).some(x => x && x.k === 'x:m.lilong')) ? 18 : base;
  };
  /* 自带灵力：游戏算出来的值（yaoItemPow 是 const 箭头函数，覆盖不了，只能读）。 */
  const powOf = function (s) {
    try { return typeof yaoItemPow === 'function' ? Number(yaoItemPow({ ling: s })) || 0 : 0; } catch (e) { return 0; }
  };
  /* 每条灵技的百分比之和（还没乘成长），用来从「目标灵力」反算成长。 */
  const powBase = function (s) {
    const P = (typeof YAO_BAL === 'object' && YAO_BAL && Array.isArray(YAO_BAL.pow)) ? YAO_BAL.pow : [1, 2];
    const MP = (typeof YAO_BAL === 'object' && YAO_BAL && Number.isFinite(YAO_BAL.miPow)) ? YAO_BAL.miPow : 1.5;
    const vil = (s.sk || []).some(x => x && x.k === 'x:m.u_village');       // 乡愁：普通灵技按高级算
    return (s.sk || []).reduce(function (n, x) {
      return n + (isMi(x.k) ? MP : (P[(x.hi || vil) ? 1 : 0] || 0));
    }, 0);
  };

  /* ---------- 按 yaoNormSpirit 的规则收敛 ---------- */
  function tidy(s) {
    const warn = [];
    s.apt = [0, 1, 2].map(function (i) {
      const v = Math.round(Number(s.apt && s.apt[i]));
      return NS.clampNum(Number.isFinite(v) ? v : 1000, 300, 3000);
    });
    const g = Math.round(Number(s.g) * 1000) / 1000;
    s.g = NS.clampNum(Number.isFinite(g) ? g : 1, .5, 1.5);

    const cap = capOf(s), maxMi = miMax(), AFF = G.AFF || {};
    const seen = {}, out = [];
    let mi = 0, overCap = 0, overMi = 0;
    (Array.isArray(s.sk) ? s.sk : []).forEach(function (x) {
      if (!x || typeof x.k !== 'string' || seen[x.k]) return;
      const m = isMi(x.k);
      if (m ? !miOk(x.k) : (x.k === 'ele' || !AFF[x.k])) return;
      if (out.length >= cap) { overCap++; return; }
      if (m && mi >= maxMi) { overMi++; return; }
      if (m) mi++;
      seen[x.k] = 1;
      out.push({ k: x.k, hi: m ? 0 : (x.hi ? 1 : 0) });
    });
    s.sk = out;
    if (s.lock && !seen[s.lock]) s.lock = null;
    if (overCap) warn.push('灵技最多 ' + cap + ' 条');
    if (overMi) warn.push('秘技最多 ' + maxMi + ' 条');
    return warn;
  }

  /* ---------- 可编辑的目标：壶里的妖灵 + 带器灵的灵器 ---------- */
  function lingItems() {
    const S = G.S, out = [];
    if (!S) return out;
    const eq = S.equip || {};
    Object.keys(eq).forEach(function (sl) {
      const it = eq[sl];
      if (!it || !it.ling) return;
      const ty = (G.SLOT_TYPE && G.SLOT_TYPE[sl]) || sl;
      out.push({ it: it, tag: '已装备·' + ((G.TYPE_NAME && G.TYPE_NAME[ty]) || ty) });
    });
    (S.inv || []).forEach(function (it) { if (it && it.ling) out.push({ it: it, tag: '背包' }); });
    (S.stash || []).forEach(function (it) { if (it && it.ling) out.push({ it: it, tag: '仓库' }); });
    return out;
  }
  function targetList() {
    const y = YA(), out = [];
    if (y && Array.isArray(y.pot)) {
      /* 壶里的按「收藏 → 品质 → 条数 → 成长」排，最好的在最前面 */
      y.pot.slice().sort(function (a, b) {
        return (b.keep ? 1 : 0) - (a.keep ? 1 : 0) || (b.kind || 0) - (a.kind || 0)
          || (b.sk ? b.sk.length : 0) - (a.sk ? a.sk.length : 0) || (b.g || 0) - (a.g || 0);
      }).forEach(function (s) { out.push({ src: 'pot', id: s.id, s: s, tag: '壶中' }); });
    }
    lingItems().forEach(function (x) { out.push({ src: 'ling', id: x.it.id, it: x.it, s: x.it.ling, tag: x.tag }); });
    return out;
  }
  /* 当前选中的目标；选中的没了（被超度 / 分解 / 入器）就落到第一个。 */
  function cur() {
    const list = targetList();
    let t = null;
    for (let i = 0; i < list.length; i++) if (list[i].src === sel.src && list[i].id === sel.id) { t = list[i]; break; }
    if (!t) { t = list[0] || null; if (t) sel = { src: t.src, id: t.id }; }
    return t;
  }
  function labelOf(x) {
    const s = x.s, sp = species()[s.sp];
    const nm = x.src === 'ling' ? (x.it.name || x.it.bname || '灵器') : ((sp && sp.n) || s.sp || '？');
    const tail = ' ｜ 成长 ' + (Number(s.g) || 1).toFixed(3) + ' ｜ ' + (s.sk ? s.sk.length : 0) + ' 技';
    return x.src === 'pot' ? nm + tail : nm + ' ｜ ' + x.tag + tail;
  }

  /* ---------- 下拉框选项（都是静态表，缓存一次） ---------- */
  let spList = null;
  function speciesList() {
    if (spList) return spList;
    const m = species(), out = [];
    Object.keys(m).forEach(function (k) {
      const s = m[k];
      out.push({ k: k, n: s.n || k, wx: s.wx, zone: s.zone, boss: s.boss });
    });
    out.sort(function (a, b) {
      return (a.zone || 0) - (b.zone || 0) || (a.boss ? 1 : 0) - (b.boss ? 1 : 0)
        || String(a.n).localeCompare(String(b.n), 'zh');
    });
    return (spList = out);
  }
  let miList = null;
  function miOptionsList() {
    if (miList) return miList;
    const MI = (typeof YAO_MI === 'object' && YAO_MI) ? YAO_MI : {}, out = [];
    Object.keys(MI).forEach(function (k) {
      let n = k;
      try { n = typeof yaoMiName === 'function' ? yaoMiName(k) : k; } catch (e) { }
      out.push({ k: k, n: n, fam: MI[k].kind || '' });
    });
    return (miList = out);
  }
  /* 灵技下拉：已经在用的键标灰，避免撞名（撞名的第二条会被 yaoNormSpirit 丢掉）。 */
  function skOptions(s, curK, self) {
    const AFF = G.AFF || {}, used = {};
    (s.sk || []).forEach(function (x, i) { if (i !== self) used[x.k] = 1; });
    return Object.keys(AFF).filter(k => k !== 'ele').map(function (k) {
      return `<option value="${k}"${k === curK ? ' selected' : ''}${used[k] ? ' disabled' : ''}>${NS.esc(AFF[k].n || k)}</option>`;
    }).join('');
  }
  /* 秘技下拉：按族分 optgroup（元素化 36 / 状态化 56 / 词条化 16 / 契 16 / 诀 480 / 变 8 / 鸣 / 拓印）。 */
  function miOptions(s, curK, self) {
    const used = {};
    (s.sk || []).forEach(function (x, i) { if (i !== self) used[x.k] = 1; });
    const all = miOptionsList();
    return MI_FAM.map(function (f) {
      const rows = all.filter(x => x.fam === f[0]);
      if (!rows.length) return '';
      return `<optgroup label="${f[1]}（${rows.length}）">` + rows.map(function (x) {
        return `<option value="${x.k}"${x.k === curK ? ' selected' : ''}${used[x.k] ? ' disabled' : ''}>${NS.esc(x.n)}</option>`;
      }).join('') + '</optgroup>';
    }).join('');
  }

  /* ---------- 妖灵子页 ---------- */
  function spiritHTML() {
    const list = targetList();
    if (!list.length) {
      return `<div class="iap-empty">壶里还没有妖灵，也没有带器灵的灵器。<br>
        先去收一只；或者把灵器上的器灵「出窍」回壶里再来改。</div>`;
    }
    const t = cur(), s = t.s;
    if (!s || !Array.isArray(s.sk)) return `<div class="iap-empty bad">这只妖灵的数据读不出来（结构异常）。</div>`;
    const sp = species()[s.sp] || {};
    const cap = capOf(s), maxMi = miMax();
    const miN = s.sk.filter(function (x) { return isMi(x.k); }).length;
    const hiN = s.sk.filter(function (x) { return !isMi(x.k) && x.hi; }).length;
    const potN = (YA() && Array.isArray(YA().pot)) ? YA().pot.length : 0;

    const targetOpts = list.map(function (x) {
      const on = (x.src === sel.src && x.id === sel.id) ? ' selected' : '';
      return `<option value="${x.src}|${NS.esc(x.id)}"${on}>${NS.esc(labelOf(x))}</option>`;
    }).join('');
    const spOpts = speciesList().map(function (x) {
      const on = x.k === s.sp ? ' selected' : '';
      return `<option value="${NS.esc(x.k)}"${on}>${NS.esc(x.n)}（${WX_N[x.wx] || '—'}）</option>`;
    }).join('');
    const kindChips = KIND_N.map(function (n, i) {
      return `<button class="iap-chip${int(s.kind) === i ? ' on' : ''}" data-y="kind" data-v="${i}">${n}</button>`;
    }).join('');

    /* 灵技 / 秘技混在同一个 sk 里，data-i 必须是数组下标（删 / 改都按它），
       显示用的序号分开数，免得出现「1 2 5 7」这种。 */
    let sn = 0, mn = 0;
    const skRows = [], miRows = [];
    s.sk.forEach(function (x, i) {
      if (isMi(x.k)) {
        mn++;
        miRows.push(`<div class="iap-skrow"><span class="iap-ix">${mn}</span>
          <select class="iap-in" data-y="mi" data-i="${i}">${miOptions(s, x.k, i)}</select>
          <button class="iap-btn ghost tiny" data-y="midel" data-i="${i}" title="删掉这条秘技">×</button></div>`);
      } else {
        sn++;
        skRows.push(`<div class="iap-skrow"><span class="iap-ix">${sn}</span>
          <select class="iap-in" data-y="sk" data-i="${i}">${skOptions(s, x.k, i)}</select>
          <button class="iap-btn tiny${x.hi ? ' on' : ''}" data-y="hi" data-i="${i}"
            title="普通 / 高级：高级的词条按高档掷，自带灵力也从 1% 变 2%">${x.hi ? '高级' : '普通'}</button>
          <button class="iap-btn ghost tiny" data-y="skdel" data-i="${i}" title="删掉这条灵技">×</button></div>`);
      }
    });

    const famOpts = MI_FAM.map(function (f) {
      return `<option value="${f[0]}"${fam === f[0] ? ' selected' : ''}>${f[1]}</option>`;
    }).join('');

    return `<div class="iap-sec"><div class="iap-sechd"><b>目标</b><small>壶中 ${potN} 只 · 灵器 ${list.length - potN} 件 · 灵器上的器灵是入器时的副本，改壶里的不会同步过去</small></div>
      <div class="iap-fld"><div class="iap-lab"><b>编辑</b><small>${t.src === 'pot' ? '壶里的妖灵' : '灵器上的器灵（' + t.tag + '）'}</small></div>
        <select class="iap-in" data-y="target">${targetOpts}</select></div>
    </div>

    <div class="iap-sec"><div class="iap-sechd"><b>基础</b><small>品质与资质决定能做出多强的灵器</small></div>
      <div class="iap-fld"><div class="iap-lab"><b>种族</b><small>决定名字与五行；灵技池只是游戏掷点用的，这里不受限</small></div>
        <i class="iap-cd on">${WX_N[sp.wx] || '—'}</i>
        <select class="iap-in" data-y="sp">${spOpts}</select></div>
      <div class="iap-fld"><div class="iap-lab"><b>品质</b><small>影响资质倍率、天生条数与超度得到的魂玉</small></div>
        <div class="iap-chips sub">${kindChips}</div>
        ${t.src === 'pot' ? `<button class="iap-btn${s.keep ? ' pri' : ''}" data-y="keep" title="收藏：批量超度不会动它">${s.keep ? '已收藏' : '收藏'}</button>` : ''}
      </div>
      <div class="iap-fld"><div class="iap-lab"><b>资质</b><small>攻资 / 御资 / 灵资 · 300 ~ 3000 · 按词条类别各自取一项</small></div>
        <div class="iap-apts">
          <label>攻</label><input class="iap-in" type="text" inputmode="numeric" spellcheck="false" data-y="apt" data-i="0" value="${int(s.apt[0])}">
          <label>御</label><input class="iap-in" type="text" inputmode="numeric" spellcheck="false" data-y="apt" data-i="1" value="${int(s.apt[1])}">
          <label>灵</label><input class="iap-in" type="text" inputmode="numeric" spellcheck="false" data-y="apt" data-i="2" value="${int(s.apt[2])}">
        </div></div>
      <div class="iap-fld"><div class="iap-lab"><b>成长</b><small>0.500 ~ 1.500 · 每条词条和灵力都乘它</small></div>
        <input class="iap-in sm" type="text" inputmode="decimal" spellcheck="false" data-y="g" value="${(Number(s.g) || 1).toFixed(3)}">
        <span class="iap-hint">按回车或点别处生效</span></div>
      <div class="iap-fld"><div class="iap-lab"><b>自带灵力</b><small>没有独立字段：Σ(普通 1% / 高级 2% / 秘技 1.5%) × 成长</small></div>
        <span class="iap-cur wide"><i data-pow>+${powOf(s).toFixed(1)}%</i></span>
        <input class="iap-in sm" type="text" inputmode="decimal" spellcheck="false" data-y="pwt" placeholder="目标 %" aria-label="目标灵力">
        <button class="iap-btn" data-y="powset" title="按目标灵力反算成长（成长同时会改词条数值）">调成长</button></div>
    </div>

    <div class="iap-sec"><div class="iap-sechd"><b>灵技</b><small>${sn} 条 · 高级 ${hiN} 条 · 加上秘技共 ${s.sk.length} / ${cap} 条 · 每条普通 +1% 高级 +2% 灵力</small></div>
      ${skRows.join('') || '<div class="iap-empty sm">还没有灵技</div>'}
      <div class="iap-skadd"><button class="iap-btn" data-y="skadd">＋ 灵技</button>
        <span class="iap-hint">最多 ${cap} 条（带「骊龙之魂」时 18 条），同名不能重复</span></div>
    </div>

    <div class="iap-sec"><div class="iap-sechd"><b>秘技</b><small>${miN} / ${maxMi} 条 · 也算进上面的 ${cap} 条上限</small></div>
      ${miRows.join('') || '<div class="iap-empty sm">还没有秘技</div>'}
      <div class="iap-skadd"><select class="iap-in" data-y="fam">${famOpts}</select>
        <button class="iap-btn" data-y="miadd">＋ 秘技</button>
        <span class="iap-hint">契全身最多 2 条、状态化最多 3 条，超出的按顺序只取前几个</span></div>
    </div>`;
  }

  /* ---------- 页 ---------- */
  function render() {
    const S = G.S, A = G.A;
    if (!S || !S.cls) return `<div class="iap-empty">还没有进入角色，先选一个英雄再打开护肝台。</div>`;
    if (!A) return `<div class="iap-empty">账号档还没就绪（读档中），稍等再试。</div>`;
    if (!YA()) return `<div class="iap-empty bad">炼妖壶的账号档读不出来（A.yao 结构异常），先回游戏里打开一次炼妖壶。</div>`;
    const chips = `<div class="iap-chips sub">` + [['res', '资源'], ['sp', '妖灵']].map(function (v) {
      return `<button class="iap-chip${view === v[0] ? ' on' : ''}" data-y="view" data-v="${v[0]}">${v[1]}</button>`;
    }).join('') + `</div>`;
    const head = `<div class="iap-note">这一页只在拥有 <b>DLC《炼妖壶》</b> 时出现。</div>`;
    if (view === 'sp') return head + chips + spiritHTML();
    return head + chips
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
  /* 只刷「自带灵力」这一个数字（改成长 / 资质时用，不重建 DOM，免得丢焦点） */
  function syncPow(root) {
    const t = cur(); if (!t) return;
    const el = root.querySelector('[data-pow]');
    if (el) el.textContent = '+' + powOf(t.s).toFixed(1) + '%';
  }

  /* ---------- 提交 ---------- */
  /* soft = true：只写档 + 刷数字，不重建 DOM（给成长 / 资质这种「边输边看」的字段用，
     否则 change 一触发就重绘，紧接着的按钮点击会落在已经被换掉的节点上）。 */
  function commit(t, msg, soft) {
    const warn = tidy(t.s);
    if (t.src === 'ling' && typeof yaoItemFix === 'function') {
      try { yaoItemFix(t.it); } catch (e) { console.warn('[IAPM] yaoItemFix', e); }
    }
    NS.apply(false);
    if (soft) { if (warn.length) NS.toast(warn.join(' · '), true); return; }
    NS.panel.refresh();
    if (msg) NS.toast(msg);
    else if (warn.length) NS.toast(warn.join(' · '), true);
  }

  /* ---------- 交互 ---------- */
  function bind(root) {
    /* --- 子页签 / 妖灵编辑的点击 --- */
    root.addEventListener('click', function (e) {
      const b = e.target.closest('[data-y]');
      if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
      const y = b.dataset.y;

      if (y === 'view') { view = b.dataset.v === 'sp' ? 'sp' : 'res'; NS.panel.refresh(); return; }

      const t = cur(); if (!t) return;
      const s = t.s;
      const i = int(Number(b.dataset.i));

      if (y === 'kind') {
        s.kind = NS.clampNum(int(Number(b.dataset.v)), 0, 2);
        commit(t, '品质：' + KIND_N[s.kind]); return;
      }
      if (y === 'keep') {
        if (s.keep) delete s.keep; else s.keep = 1;
        commit(t, s.keep ? '已收藏' : '取消收藏'); return;
      }
      if (y === 'hi') {
        if (s.sk[i] && !isMi(s.sk[i].k)) s.sk[i].hi = s.sk[i].hi ? 0 : 1;
        commit(t); return;
      }
      if (y === 'skdel' || y === 'midel') {
        if (!s.sk[i]) return;
        const nm = isMi(s.sk[i].k) ? '秘技' : '灵技';
        s.sk.splice(i, 1);
        commit(t, '删掉一条' + nm); return;
      }
      if (y === 'skadd') {
        if (s.sk.length >= capOf(s)) { NS.toast('条数已满（' + capOf(s) + ' 条）', true); return; }
        const used = {}; s.sk.forEach(x => used[x.k] = 1);
        const k = Object.keys(G.AFF || {}).filter(k => k !== 'ele' && !used[k])[0];
        if (!k) { NS.toast('没有可以加的灵技了', true); return; }
        s.sk.push({ k: k, hi: 0 });
        commit(t, '加了一条灵技'); return;
      }
      if (y === 'miadd') {
        if (s.sk.filter(x => isMi(x.k)).length >= miMax()) { NS.toast('秘技最多 ' + miMax() + ' 条', true); return; }
        if (s.sk.length >= capOf(s)) { NS.toast('条数已满（' + capOf(s) + ' 条）', true); return; }
        const used = {}; s.sk.forEach(x => used[x.k] = 1);
        const row = miOptionsList().filter(x => x.fam === fam && !used[x.k])[0];
        if (!row) { NS.toast('这一类已经全加上了', true); return; }
        s.sk.push({ k: row.k, hi: 0 });
        commit(t, '加了一条秘技'); return;
      }
      if (y === 'powset') {
        const inp = root.querySelector('[data-y="pwt"]');
        const target = NS.parseNum(inp && inp.value, NaN);
        if (!Number.isFinite(target) || target <= 0) { NS.toast('先填目标灵力，比如 25', true); return; }
        const base = powBase(s);
        if (base <= 0) { NS.toast('这只还没有灵技，灵力只能是 0', true); return; }
        const want = Math.round(target / base * 1000) / 1000;
        s.g = NS.clampNum(want, .5, 1.5);
        commit(t, '成长 ' + s.g.toFixed(3) + ' → 灵力 +' + powOf(s).toFixed(1) + '%'
          + (Math.abs(s.g - want) > 1e-6 ? '（目标超出 0.5~1.5，已夹到边上）' : '')); return;
      }
    });

    /* --- 下拉框与输入框 --- */
    root.addEventListener('change', function (e) {
      const el = e.target, y = el && el.getAttribute && el.getAttribute('data-y');
      if (!y) return;

      if (y === 'target') {
        const v = String(el.value).split('|');
        sel = { src: v[0], id: v.slice(1).join('|') };
        NS.panel.refresh(); return;
      }
      const t = cur(); if (!t) return;
      const s = t.s, i = int(Number(el.dataset.i));

      if (y === 'sp') {
        if (!species()[el.value]) { NS.toast('没有这个种族', true); return; }
        s.sp = el.value; commit(t, '种族已改'); return;
      }
      if (y === 'g') {
        const v = NS.parseNum(el.value, Number(s.g));
        s.g = Number.isFinite(v) ? v : s.g;
        commit(t, '', true);
        el.value = s.g.toFixed(3);          // 把夹取后的值写回输入框
        syncPow(root); return;
      }
      if (y === 'apt') {
        const v = NS.parseNum(el.value, Number(s.apt[i]));
        s.apt[i] = Number.isFinite(v) ? v : s.apt[i];
        commit(t, '', true);
        el.value = int(s.apt[i]);
        syncPow(root); return;
      }
      if (y === 'sk') {
        if (!s.sk[i] || isMi(el.value)) return;
        s.sk[i].k = el.value;
        commit(t); return;
      }
      if (y === 'mi') {
        if (!s.sk[i] || !miOk(el.value)) return;
        s.sk[i].k = el.value; s.sk[i].hi = 0;
        commit(t); return;
      }
      if (y === 'fam') { fam = el.value; return; }      // 只记住「＋ 秘技」加哪一类，不写档
    });

    /* --- 资源页的按钮（残页 / 妖魄 / 三行资源） --- */
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
      const curN = Number(r.get()) || 0;
      const typed = NS.parseNum(inp.value, curN);
      let next = curN;
      if (act === 'set') next = typed;
      else if (act === 'add') next = curN + typed;
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
