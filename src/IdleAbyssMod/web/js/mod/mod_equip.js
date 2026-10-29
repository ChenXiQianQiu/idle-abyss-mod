'use strict';
/* ============================================================
   mod_equip.js — 装备页
   ------------------------------------------------------------
   能力：
     · 浏览 / 筛选 身上的、背包里的、个人仓库、共用仓库的全部装备
     · 改品质、上古 / 太古、物品等级、强化等级
     · 改基础数值（武器伤害 / 护甲 / 副手加成 / 格挡），夹在
       items.js rollItem 的掷点区间内
     · 增删改随机词缀，数值夹在 affRange()（王庭走 raidRollAff）的区间内
     · 镶嵌 / 替换宝石（数量上限取 SOCKET_MAX）
     · 用游戏自己的生成器造一件新装备再细调：主线 rollItem / 王庭 raidRollItem /
       奇物 rollOddity / 神话 mythRollItem，四种来源的产出规格与正常掉落完全一致
   所有区间都直接调用游戏的公式，改出来的装备和正常掉落同规格。
   ============================================================ */
(function () {
  const NS = window.IAP, G = NS.G, F = NS.fn;
  const EQ = (NS.eq = {
    sel: null, src: 'all', q: '',
    /* 生成器的表单状态。放在这里而不是只读 DOM：重绘（选装备 / 换品质 / 生成完）
       会把左侧重建，不记下来的话每次都要重新选部位和难度。 */
    gen: { src: 'main', t: 'weapon', r: 3, ilvl: 0, rid: '', diff: 'n', radiant: false, odd: '', myth: '' },
  });
  const SRC_FILTERS = [['all', '全部'], ['eq', '已装备'], ['inv', '背包'], ['stash', '仓库'], ['shared', '共用']];
  /* 容量上限，照 state.js:7 的 INV_MAX / STASH_MAX 与 state.js:8 的 SHARED_TAB_SIZE */
  const LIM = {
    inv: function () { return typeof INV_MAX === 'number' ? INV_MAX : 120; },
    stash: function () { return typeof STASH_MAX === 'number' ? STASH_MAX : 56; },
    tab: function () { return typeof SHARED_TAB_SIZE === 'number' ? SHARED_TAB_SIZE : 56; },
  };

  const icon = function (it) { try { return typeof itemIconURL === 'function' ? itemIconURL(it) : ''; } catch (e) { return ''; } };
  const pct = function (k) { try { return F.statIsPct(k); } catch (e) { return false; } };
  const statName = function (k) { try { return F.statName(k); } catch (e) { return k; } };
  const valTxt = function (v, k) { return F.pv(v) + (pct(k) ? '%' : ''); };
  const rerender = function () { if (NS.panel) NS.panel.refresh(); };

  /* ---------- 生成器 ----------
     三种来源，都调游戏自己的生成器，产出的规格与正常掉落完全一致：
       · 主线  rollItem(ilvl, r, t, cls)                  items.js:114（品质 / 词缀 / 基础值全在这）
       · 王庭  raidRollItem(id, diff, rng, { radiant })   raid_items.js:303
       · 奇物  rollOddity(k, ilvl)                        oddity.js:17
       · 神话  mythRollItem(k, cls)                       myth.js:49（底子 = 史诗辉耀王庭，r = 7）
     王庭的 id 是 `${职业}_${部位}`（data_raid.js:181），另有通用首饰 j_* 与稀世 x_*；
     它的物品等级由难度决定（新规则三档都是 100），所以不开放 ilvl 输入。 */
  const GEN_SRC = [['main', '主线'], ['raid', '王庭'], ['odd', '奇物'], ['myth', '神话']];
  /* 部位名直接用游戏的 TYPE_NAME（data_items.js:8），别自己再抄一份 */
  const partName = function (t) { return (G.TYPE_NAME && G.TYPE_NAME[t]) || t; };

  /* 生成器表单的当前状态（ilvl 首次按最高阶段兜底，并夹在规则上限内） */
  function genState() {
    const g = EQ.gen, cap = F.ruleIlvl(9999);
    if (!Number.isFinite(g.ilvl) || g.ilvl <= 0) g.ilvl = Number(G.S.maxStage) || 1;
    g.ilvl = Math.max(1, Math.min(cap, Math.floor(g.ilvl)));
    return g;
  }

  /* 王庭掉落表按职业分组。本职业排第一，其余按 CLASSES 的顺序；最后是通用首饰与稀世。
     RAID_ITEMS 是 data_raid.js:177 展开的完整表（8 职业 × 9 部位 + 4 首饰 + 2 稀世）。 */
  function raidGroups() {
    let list = [];
    try { list = Array.isArray(RAID_ITEMS) ? RAID_ITEMS : []; } catch (e) { list = []; }
    const cls = (G.S && G.S.cls) || '', C = G.CLASSES || {}, order = [];
    if (cls) order.push(cls);
    Object.keys(C).forEach(function (c) { if (c !== cls) order.push(c); });
    const groups = [];
    order.forEach(function (c) {
      const arr = list.filter(function (i) { return i.cls === c; });
      if (!arr.length) return;
      groups.push({ label: (c === cls ? '本职业 · ' : '') + ((C[c] && C[c].n) || c), items: arr });
    });
    const jew = list.filter(function (i) { return i.kind === 'jewel'; });
    const rel = list.filter(function (i) { return i.kind === 'relic'; });
    if (jew.length) groups.push({ label: '通用首饰（全职业）', items: jew });
    if (rel.length) groups.push({ label: '稀世（永夜女王）', items: rel });
    return groups;
  }

  function raidSelectHTML(g) {
    const groups = raidGroups();
    if (!groups.length) return `<span class="iap-hint bad">王庭掉落表不可用</span>`;
    /* 记录里存的那件可能已经不在这张表里（换职业 / 改版），退回到第一件 */
    if (!groups.some(gr => gr.items.some(i => i.id === g.rid))) g.rid = groups[0].items[0].id;
    const html = groups.map(function (gr) {
      return `<optgroup label="${NS.esc(gr.label)}">` + gr.items.map(function (i) {
        return `<option value="${i.id}"${i.id === g.rid ? ' selected' : ''}>${NS.esc(i.name)} · ${partName(i.t)}</option>`;
      }).join('') + '</optgroup>';
    }).join('');
    return `<select class="iap-in" data-gen="rid" aria-label="王庭装备">${html}</select>`;
  }

  function diffSelectHTML(g) {
    const ds = G.RAID_DIFFS || [];
    if (!ds.length) return '';
    if (!ds.some(d => d.id === g.diff)) g.diff = ds[0].id;
    return `<select class="iap-in sm" data-gen="diff" aria-label="难度">` + ds.map(function (d) {
      return `<option value="${d.id}"${d.id === g.diff ? ' selected' : ''}>${d.n}</option>`;
    }).join('') + '</select>';
  }

  /* 奇物下拉框：已拥有的在名字后面标出来（账号唯一，重复生成游戏不会拦，只会在读档时
     按实际存档重建 A.odd，等于多出一份幽灵复制品）。 */
  function oddSelectHTML(g) {
    let O = {};
    try { O = (typeof ODDITIES === 'object' && ODDITIES) ? ODDITIES : {}; } catch (e) { O = {}; }
    const keys = Object.keys(O);
    if (!keys.length) return `<span class="iap-hint bad">奇物表不可用</span>`;
    if (keys.indexOf(g.odd) < 0) g.odd = keys[0];
    const owned = (G.A && G.A.odd) || {};
    return `<select class="iap-in" data-gen="odd" aria-label="奇物">` + keys.map(function (k) {
      return `<option value="${k}"${k === g.odd ? ' selected' : ''}>${NS.esc(O[k].name)}（${partName(O[k].t)}）${owned[k] ? ' · 已拥有' : ''}</option>`;
    }).join('') + '</select>';
  }

  /* 神话装备下拉框：51 只神兽按五个界分组（data_myth.js MYTH_REALMS）。
     神话是账号唯一的，已拥有过的在名字后面标出来 —— 再生成一件游戏不会拦，
     但那只神兽的「首次获得」判定已经过了，多出来的就是纯粹的复制品。 */
  function mythGroups() {
    const T = G.MYTH, keys = G.MYTH_KEYS, realms = G.MYTH_REALMS;
    if (!T || !keys.length) return [];
    return realms.map(function (r, i) {
      const items = keys.filter(function (k) { return T[k] && T[k].realm === i; });
      if (!items.length) return null;
      return { label: r.n, items: items.map(function (k) {
        return { k: k, n: T[k].n, item: T[k].item.n, part: T[k].item.t };
      }) };
    }).filter(Boolean);
  }

  function mythSelectHTML(g) {
    const groups = mythGroups();
    if (!groups.length) return `<span class="iap-hint bad">神兽表不可用（游戏版本低于 2.4.0？）</span>`;
    const owned = (((G.A || {}).myth || {}).own) || {};
    if (!groups.some(gr => gr.items.some(x => x.k === g.myth))) g.myth = groups[0].items[0].k;
    const html = groups.map(function (gr) {
      return `<optgroup label="${NS.esc(gr.label)}">` + gr.items.map(function (x) {
        return `<option value="${x.k}"${x.k === g.myth ? ' selected' : ''}>${NS.esc(x.n)} · ${NS.esc(x.item)}（${partName(x.part)}）${owned[x.k] ? ' · 已拥有' : ''}</option>`;
      }).join('') + '</optgroup>';
    }).join('');
    return `<select class="iap-in" data-gen="myth" aria-label="神兽">${html}</select>`;
  }

  function genFormHTML() {
    const g = genState();
    const chips = GEN_SRC.map(function (p) {
      return `<button class="iap-chip${g.src === p[0] ? ' on' : ''}" data-gensrc="${p[0]}">${p[1]}</button>`;
    }).join('');
    let body = '', hint = '';
    if (g.src === 'raid') {
      const d = (G.RAID_DIFFS || []).find(x => x.id === g.diff) || {};
      body = `<div class="iap-genrow">${raidSelectHTML(g)}</div>
        <div class="iap-genrow">${diffSelectHTML(g)}
          <button class="iap-chip${g.radiant ? ' on' : ''}" data-do="genrad" title="王庭版的上古：基础值 / 词缀上限 / 固定生命 / ◆ 特效一起 ×1.3">辉耀 ×1.3</button>
          <button class="iap-btn pri" data-do="gen">生成</button></div>`;
      hint = `王庭装备三档都是 ilvl ${F.ruleIlvl(9999)}（新规则），难度只改品阶倍率${d.n ? '，当前 <b>' + d.n + '</b>' : ''}。
        本职业与通用首饰进背包，别职业的进共用仓库。`;
    } else if (g.src === 'myth') {
      const MB = G.MYTH_BAL || {};
      body = `<div class="iap-genrow">${mythSelectHTML(g)}</div>
        <div class="iap-genrow">
          <button class="iap-btn pri" data-do="gen">生成</button>
        </div>`;
      hint = `神话是第 7 品质（r = 7），底子按<b>史诗辉耀王庭</b>的公式生成：账号唯一、不能分解，
        每件带一条神格（转化 / 改写 / 共鸣）。重复拿同一只会转成神契，这里不做保底，
        点一次就出。当前职业 <b>${NS.esc((G.CLASSES && G.CLASSES[G.S.cls] && G.CLASSES[G.S.cls].n) || G.S.cls)}</b>；
        想换职业用共用仓库取回，游戏会自动按新职业重掷底子。${MB.from ? '' : '<br><b>没读到 MYTH_BAL，生成器可能不完整。</b>'}`;
    } else if (g.src === 'odd') {
      body = `<div class="iap-genrow">${oddSelectHTML(g)}</div>
        <div class="iap-genrow">
          <input class="iap-in sm" type="text" inputmode="numeric" data-gen="ilvl" value="${g.ilvl}" aria-label="物品等级">
          <button class="iap-btn pri" data-do="gen">生成</button>
        </div>`;
      hint = `奇物是账号唯一的第 6 品质（r = 5），每件同时只存在一份；下拉框里标了「已拥有」的再生成就是多一份。`;
    } else {
      const types = ['weapon', 'offhand', 'helm', 'shoulders', 'armor', 'gloves', 'belt', 'pants', 'boots', 'ring', 'amulet'];
      const opts = types.map(function (t) {
        return `<option value="${t}"${t === g.t ? ' selected' : ''}>${G.TYPE_NAME[t] || t}</option>`;
      }).join('');
      const rars = [0, 1, 2, 3, 4].map(function (r) {
        return `<option value="${r}"${r === g.r ? ' selected' : ''}>${G.RAR[r].n}</option>`;
      }).join('');
      body = `<div class="iap-genrow">
          <select class="iap-in sm" data-gen="t" aria-label="部位">${opts}</select>
          <select class="iap-in sm" data-gen="r" aria-label="品质">${rars}</select>
        </div>
        <div class="iap-genrow">
          <input class="iap-in sm" type="text" inputmode="numeric" data-gen="ilvl" value="${g.ilvl}" aria-label="物品等级">
          <button class="iap-btn pri" data-do="gen">生成</button>
        </div>`;
      hint = `物品等级上限 ${F.ruleIlvl(9999)}（新规则 100）；生成的装备进背包并自动选中。`;
    }
    return `<div class="iap-gen">
      <div class="iap-genhd">生成一件新装备（走游戏自己的掉落生成器）</div>
      <div class="iap-chips">${chips}</div>
      ${body}
      <div class="iap-hint">${hint}</div>
    </div>`;
  }

  /* 只重画列表本体（搜索框在输入时要保留焦点和光标，不能整页重绘） */
  function itemsHTML() {
    const all = NS.collectItems();
    const items = all.filter(function (x) {
      if (EQ.src !== 'all' && x.src !== EQ.src) return false;
      if (EQ.q) {
        const key = (NS.itemName(x.it) + ' ' + (x.it.name || '') + ' ' + (x.it.bname || '')).toLowerCase();
        if (key.indexOf(EQ.q.toLowerCase()) < 0) return false;
      }
      return true;
    });
    EQ._list = items;
    return items.length ? items.map(function (x, i) {
      const it = x.it, sel = EQ.sel === it;
      return `<button class="iap-item${sel ? ' on' : ''}" data-idx="${i}" style="--c:${NS.rarColor(it)}">
        <img src="${icon(it)}" alt="">
        <span class="iap-itemtx"><b>${NS.esc(NS.itemName(it))}</b>
        <small>${x.tag} · ${G.TYPE_NAME[it.t] || it.t} · ilvl ${it.ilvl}${it.raid ? ' · 王庭' : ''}${it.odd ? ' · 奇物' : ''}</small></span>
      </button>`;
    }).join('') : `<div class="iap-empty sm">没有符合条件的装备</div>`;
  }

  function listHTML() {
    const chips = SRC_FILTERS.map(([k, n]) => `<button class="iap-chip${EQ.src === k ? ' on' : ''}" data-src="${k}">${n}</button>`).join('');
    return `<div class="iap-eqtop"><div class="iap-chips">${chips}</div>
      <input class="iap-in" type="search" data-q placeholder="搜索名称" value="${NS.esc(EQ.q)}"></div>
      <div class="iap-eqitems">${itemsHTML()}</div>`;
  }

  /* ---------- 右侧编辑器 ---------- */
  function numField(label, attr, value, hint) {
    return `<div class="iap-row"><div class="iap-lab"><b>${label}</b><small>${hint || ''}</small></div>
      <input class="iap-in" type="text" inputmode="decimal" spellcheck="false" ${attr} value="${value}"></div>`;
  }

  function baseFields(it) {
    const out = [];
    const add = function (label, field, key) {
      const r = NS.baseRange(it, field);
      if (!r) return;
      const cur = field === 'imp' ? (it.imp ? it.imp.v : 0) : it[field];
      if (cur == null) return;
      out.push(numField(label, `data-eq="base:${field}"`, F.pv(Math.round(cur * 10) / 10),
        `合法 ${F.pv(Math.round(r[0] * 10) / 10)} ~ ${F.pv(Math.round(r[1] * 10) / 10)}`));
    };
    if (it.t === 'weapon') { add('最小伤害', 'min'); add('最大伤害', 'max'); }
    if (it.t === 'offhand') {
      if (it.imp) add(it.imp.k === 'ias' ? '副手攻速加成' : '副手伤害加成', 'imp');
      if (it.block != null) add('格挡率', 'block');
    }
    if (it.armor != null) add('护甲', 'armor');
    return out.length ? `<div class="iap-sec"><div class="iap-sechd"><b>基础数值</b><small>区间 = 该等级 / 品质能掷出的范围</small></div>${out.join('')}</div>` : '';
  }

  /* 词条下拉框。王庭装备额外给一个「生命·王庭」选项，等价于装备自带的那条
     王庭生命词条（数值按 RAID_LIFE_MUL 掷，比普通 life 词缀大一个量级）；
     同一件装备最多一条，选了就把别处的清掉。 */
  function affSelect(it, i, f) {
    const fixed = !!(f.fixed && !f.raid);
    const other = (it.aff || []).some((g, j) => j !== i && g.fixed && !g.raid);
    const opts = [];
    /* 只有带 RAID_LIFE_MUL 的部位（护甲类、首饰）才有王庭生命词条；武器 / 副手没有。
       神话装备同样带这条（底子就是王庭装），所以一并算进来。 */
    if ((it.raid || it.myth) && (!other || fixed) && (fixed || NS.raidLifeRange(it))) {
      opts.push({ v: '__life_fixed', n: '生命·王庭' });
    }
    affOptions(it, i).forEach(function (k) {
      if (fixed && k === 'life') return;                  // 已经是王庭生命，不再列普通生命
      opts.push({ v: k, n: statName(k) || k });
    });
    /* 当前词条不在候选池里（换职业 / 老存档）时补一项，否则下拉框会错误地显示成第一项 */
    if (!fixed && !opts.some(x => x.v === f.k)) opts.unshift({ v: f.k, n: statName(f.k) || f.k || '?' });
    const cur = fixed ? '__life_fixed' : f.k;
    return `<select class="iap-in sm" data-eq="affk:${i}" aria-label="词条">${
      opts.map(x => `<option value="${x.v}"${x.v === cur ? ' selected' : ''}>${x.n}</option>`).join('')
    }</select>`;
  }

  function affRows(it) {
    const list = it.aff || [];
    const rows = list.map(function (f, i) {
      /* raid:1 = 装备卡上带 ◆ 的那几条，才是真正的「固定词条」：值由 RAID_EFFECTS 表定义，
         而且读档时 raidItemFix 会先 filter 掉再整条重建（raid_items.js:380-383），
         手改存不下来，所以只读。 */
      if (f.raid) {
        return `<div class="iap-aff ro"><span class="iap-affk">◆ ${statName(f.k)}</span>
          <span class="iap-affv">${valTxt(f.v, f.k)}</span>
          <span class="iap-range">固定词条 · 由装备表定义<br><i>读档时游戏会重建，手改存不下来</i></span></div>`;
      }
      const r = NS.affRangeAny(it, f) || [0, 0];
      const eff = f.v * F.plusM(it);
      const effTxt = `强化后 ${valTxt(Math.round(eff * 10) / 10, f.k)}`;
      /* fixed:1 = 王庭防具那条生命词条。它**不是**固定词条（装备卡上也没有 ◆）：
         只是一条必带的普通词缀，数值按王庭专用的 RAID_LIFE_MUL 公式掷，不适用主线
         life 的区间。词条本身可以在下拉框里换（换成别的就变成普通词缀）。 */
      return `<div class="iap-aff">
        ${affSelect(it, i, f)}
        <input class="iap-in sm" type="text" inputmode="decimal" spellcheck="false" data-eq="affv:${i}" value="${F.pv(f.v)}">
        <span class="iap-range">${valTxt(r[0], f.k)} ~ ${valTxt(r[1], f.k)}<br><i>${f.fixed ? '王庭生命词条 · ' + effTxt : effTxt}</i></span>
        <button class="iap-btn ghost" data-do="delaff:${i}" title="删除这条词缀">×</button>
      </div>`;
    }).join('');
    const cap = NS.affCap(it);
    const cur = (it.aff || []).filter(f => !f.raid && !f.fixed).length;
    const addBtn = cur < cap
      ? `<button class="iap-btn" data-do="addaff">＋ 添加词缀（${cur}/${cap}）</button>`
      : `<span class="iap-hint">词缀已满（${cur}/${cap}，该品质上限）</span>`;
    /* 王庭装备没有上古 / 太古，但同样有「这条词缀最高能到多少」，
       所以满值做成独立按钮，对所有非奇物装备都开放。 */
    const maxBtn = `<button class="iap-btn pri" data-do="maxaff" title="把每条可改词缀拉到这件装备当前能掷出的最高值">词缀全满</button>`;
    return `<div class="iap-sec"><div class="iap-sechd"><b>词缀</b><small>数值上限 = 该装备等级下能掷出的最高值</small></div>
      ${rows || '<div class="iap-hint">这件装备没有随机词缀。</div>'}<div class="iap-affadd">${addBtn}${maxBtn}</div></div>`;
  }

  function affOptions(it, idx) {
    const cur = idx >= 0 ? it.aff[idx] : null;
    const used = it.aff.filter((f, i) => i !== idx && !f.raid && !f.fixed).map(f => f.k);
    const cls = it.cls || (G.S && G.S.cls) || (typeof DEFAULT_HERO === 'function' ? DEFAULT_HERO() : 'warrior');
    let pool = [];
    try { pool = F.affPool(it.t, used, cls) || []; } catch (e) { pool = Object.keys(G.AFF); }
    if (cur && pool.indexOf(cur.k) < 0) pool = [cur.k].concat(pool);
    return pool;
  }

  function sockRows(it) {
    const max = G.SOCKET_MAX[it.t] || 0;
    if (!max) return '';
    const sock = it.sock || (it.sock = []);
    const cat = sockCat(it.t);
    const rows = sock.map(function (g, i) {
      const gemOpts = ['<option value="">（空孔）</option>'].concat(G.GEM_KEYS.map(k => `<option value="${k}"${g && g.g === k ? ' selected' : ''}>${G.GEMS[k].n}</option>`)).join('');
      const qOpts = [0, 1, 2, 3, 4].map(q => `<option value="${q}"${g && g.q === q ? ' selected' : ''}>${G.GEM_GRADE[q] || '普通'}</option>`).join('');
      let eff = '空';
      if (g) { try { eff = gemEffect(g.g, g.q, cat); } catch (e) { eff = ''; } }
      return `<div class="iap-aff"><select class="iap-in sm" data-eq="sockg:${i}">${gemOpts}</select>
        <select class="iap-in sm" data-eq="sockq:${i}">${qOpts}</select>
        <span class="iap-range">${eff}</span></div>`;
    }).join('');
    const addBtn = sock.length < max ? `<button class="iap-btn" data-do="addsock">＋ 开孔（${sock.length}/${max}）</button>` : '';
    return `<div class="iap-sec"><div class="iap-sechd"><b>镶嵌</b><small>该部位最多 ${max} 孔</small></div>${rows || '<div class="iap-hint">没有孔。</div>'}<div class="iap-affadd">${addBtn}</div></div>`;
  }

  /* 副标题：部位 · 品阶 · ilvl。
     王庭装备单独一行说明「王庭 · 传奇 / 套装（套装名 / 特效名）」，因为它的 r = 6
     在掉落体系里就是主线传奇（r=3）/ 套装（r=4）那一档，而「辉耀」对应上古。 */
  function subline(it) {
    const parts = [G.TYPE_NAME[it.t] || it.t];
    const tag = NS.raidTag(it);
    if (tag) {
      parts.push('王庭 · ' + tag.kindName + (tag.setName ? '（' + tag.setName + '）' : '') + (tag.fxName ? '（' + tag.fxName + '）' : ''));
      if (tag.radiant) parts.push('辉耀');
    } else if (it.myth) {
      /* 神话：界 + 神兽 + 神格名，底子按史诗辉耀王庭算（所以词缀区间也走辉耀） */
      const M = (G.MYTH || {})[it.myth], realms = G.MYTH_REALMS;
      parts.push(G.RAR[it.r] ? G.RAR[it.r].n : '神话');
      if (M) {
        if (realms[M.realm]) parts.push(realms[M.realm].n);
        parts.push(M.n + ' · ' + M.item.n + ' · 神格「' + M.item.g + '」');
      }
    } else {
      parts.push(G.RAR[it.r] ? G.RAR[it.r].n : '?');
      if (it.leg) parts.push('传奇特效 ' + it.leg);
      if (it.set) parts.push('套装 ' + it.set);
    }
    parts.push('ilvl ' + it.ilvl);
    return parts.join(' · ');
  }

  function editorHTML(it) {
    if (!it) return `<div class="iap-empty">左边选一件装备，或者先生成一件。</div>`;
    const raid = !!it.raid, myth = !!it.myth, court = raid || myth;
    const cap = F.ruleIlvl(9999);
    const head = `<div class="iap-edhd"><img src="${icon(it)}" alt="">
        <div class="iap-edname"><b style="color:${NS.rarColor(it)}">${NS.esc(NS.itemName(it))}</b>
        <small>${NS.esc(subline(it))}</small></div>
      </div>`;
    /* 奇物（r=5）的数值来自奇物表，改品质 / 词缀会直接破坏它的语义，只开放强化 */
    if (it.odd) {
      const od = (typeof ODDITIES === 'object' && ODDITIES[it.odd]) || {};
      return head + `<div class="iap-sec"><div class="iap-sechd"><b>奇物</b><small>词缀与数值由奇物表决定，这里只开放强化等级</small></div>
        <div class="iap-hint">${NS.esc(od.name || it.odd)}：${NS.esc(od.desc || '')}${od.curse ? '　代价：' + NS.esc(od.curse) : ''}</div>
        ${numField('强化等级 +', 'data-eq="plus"', it.plus || 0, `0 ~ ${G.MAX_PLUS}`)}</div>`;
    }
    const rBtns = [0, 1, 2, 3, 4].map(r => `<button class="iap-chip${it.r === r ? ' on' : ''}" data-r="${r}"${court ? ' disabled' : ''}>${G.RAR[r].n}</button>`).join('');
    /* 王庭：r 固定 6（品质按钮禁用），但「辉耀」就是它的上古，可以自由开关。
       游戏里王庭没有太古（raid_items.js:373 硬写 anc = false），所以不给太古按钮。
       神话：r 固定 7，底子已经按「史诗辉耀王庭」掷好，改品质 / 翻辉耀都会和 mythSeed 对不上，
       所以这里只说明、不给开关。 */
    const flags = raid
      ? `<button class="iap-chip${it.radiant ? ' on' : ''}" data-do="radiant" title="王庭版的上古：基础值 / 词缀上限 / 固定生命 / ◆ 特效一起 ×1.3">辉耀（数值 ×1.3）</button>
         <span class="iap-hint">王庭品阶 = 主线的传奇 / 套装档，「辉耀」= 主线的上古。王庭没有太古。</span>`
      : myth
        ? `<span class="iap-hint">神话：底子按<b>史诗辉耀王庭</b>生成，品质与基础值不开放手改；词缀可以改，区间已按辉耀（×1.3）算。</span>`
        : `
      <button class="iap-chip${it.anc ? ' on' : ''}" data-do="anc">上古（数值 ×1.3）</button>
      <button class="iap-chip${it.primal ? ' on' : ''}" data-do="primal">太古（词缀满值）</button>`;
    const secNote = court
      ? (myth ? '神话品质与基础值由生成器决定，不开放手改' : '王庭品质与基础值由品阶倍率决定，不开放手改')
      : '改品质会改变词缀区间与词缀条数上限';
    return head + `<div class="iap-sec"><div class="iap-sechd"><b>品质与等级</b><small>${secNote}</small></div>
        <div class="iap-chips">${rBtns}</div>
        <div class="iap-chips">${flags}</div>
        ${numField('物品等级', 'data-eq="ilvl"', it.ilvl, `1 ~ ${cap}`)}
        ${numField('强化等级 +', 'data-eq="plus"', it.plus || 0, `0 ~ ${G.MAX_PLUS}`)}
      </div>
      ${baseFields(it)}
      ${affRows(it)}
      ${sockRows(it)}`;
  }

  function render() {
    const S = G.S;
    if (!S || !S.cls) return `<div class="iap-empty">还没有进入角色，先选一个英雄再打开调试台。</div>`;
    const all = NS.collectItems();
    if (EQ.sel && all.every(x => x.it !== EQ.sel)) EQ.sel = null;
    return `<div class="iap-eqwrap">
      <div class="iap-eqlist">${genFormHTML()}${listHTML()}</div>
      <div class="iap-eqed">${editorHTML(EQ.sel)}</div>
    </div>`;
  }

  /* ---------- 交互 ---------- */
  function clampAff(it, f) {
    const r = NS.affRangeAny(it, f);
    if (!r) return;
    const v = NS.clampNum(Number(f.v), r[0], r[1]);
    f.v = NS.roundStat(v, pct(f.k));
    f.q = r[1] > r[0] ? Math.max(0, Math.min(1, (f.v - r[0]) / (r[1] - r[0]))) : 1;
  }
  /* 把一条词缀拉到当前能掷出的最高值（王庭生命词条同样适用） */
  function maxAff(it, f) {
    const r = NS.affRangeAny(it, f);
    if (!r) return;
    f.v = NS.roundStat(r[1], pct(f.k));
    f.q = 1;
  }

  /* ---------- 王庭「辉耀」 ----------
     raid_items.js:317-339 里 radiant 同时乘在四处：
       · 基础数值  a = 4 × P(ilvl) × spread(.85~1.15) × baseScale × power × rm
       · 随机词缀  raidRollAff：top = A.f(ilvl) × 1.1 × rm，cap × 1.25（不是 1.3）
       · 固定生命  RAID_LIFE_MUL × lifePower × P(ilvl) × spread × rm
       · ◆ 特效    raidItemFix 里 Math.round(v × rm)
     所以不能只翻标志位：基础值等比缩放、随机词缀按掷点位置 q 重算（raidRollAff
     本身就是 v = lo + (hi - lo) × q，保留 q 重算等价于「同一掷点换个区间」）、
     固定生命等比缩放、◆ 特效交给 raidItemFix 重建。来回切能完全还原。 */
  function setRadiant(it, on) {
    const bal = (typeof RAID_ITEM_BAL === 'object' && RAID_ITEM_BAL) ? RAID_ITEM_BAL : { radiantMul: 1.3 };
    const mul = Number(bal.radiantMul) || 1.3;
    const k = (on ? mul : 1) / (it.radiant ? mul : 1);
    const prev = Object.assign({}, it, { radiant: !!it.radiant });     // 浅拷贝，只用来算旧区间
    it.radiant = !!on;
    if (k !== 1) {
      ['min', 'max', 'armor'].forEach(function (f) {
        if (Number.isFinite(it[f])) it[f] = it[f] * k;
      });
      if (Number.isFinite(it.block)) it.block = Math.round(it.block * k * 10) / 10;
      if (it.imp && Number.isFinite(it.imp.v)) it.imp.v = Math.round(it.imp.v * k * 10) / 10;
    }
    (it.aff || []).forEach(function (f) {
      if (f.raid) return;                                    // ◆ 特效由 raidItemFix 按新 rm 重建
      if (f.fixed) { f.v = Math.max(1, Math.round(f.v * k)); return; }
      const nr = NS.affRangeOf(f.k, it), or = NS.affRangeOf(f.k, prev);
      if (!nr || !or) return;
      let q = Number.isFinite(f.q) ? f.q : (or[1] > or[0] ? (f.v - or[0]) / (or[1] - or[0]) : 1);
      q = Math.max(0, Math.min(1, q));
      f.v = NS.roundStat(nr[0] + (nr[1] - nr[0]) * q, pct(f.k));
      f.q = q;
    });
    /* 读档时游戏自己也会走这一步（raid_items.js:360），所以这里调用完全一致 */
    if (typeof raidItemFix === 'function') { try { raidItemFix(it); } catch (e) { console.warn('[IAP] raidItemFix 失败', e); } }
  }

  /* 点选装备：只换右侧编辑器 + 切换列表的选中态，不重建列表 DOM。
     整页重绘会让左侧列表的滚动位置归零，点下面那几件时列表会「跳回顶部」。 */
  function selectItem(it) {
    EQ.sel = it;
    const holder = document.querySelector('.iap-eqitems');
    if (holder && EQ._list) {
      holder.querySelectorAll('[data-idx]').forEach(function (b) {
        const x = EQ._list[Number(b.dataset.idx)];
        b.classList.toggle('on', !!x && x.it === it);
      });
    }
    const ed = document.querySelector('.iap-eqed');
    if (ed) {
      const top = ed.scrollTop;
      ed.innerHTML = editorHTML(it);
      ed.scrollTop = top;
    }
  }

  function bind(root) {
    root.addEventListener('click', function (e) {
      const pick = e.target.closest('[data-idx]');
      if (pick && EQ._list) {
        const x = EQ._list[Number(pick.dataset.idx)];
        if (x) selectItem(x.it);
        return;
      }
      const chip = e.target.closest('[data-src]');
      if (chip) { EQ.src = chip.dataset.src; rerender(); return; }
      /* 生成器的来源切换：主线 / 王庭 / 奇物 三套表单字段不一样，要整块重画 */
      const gsrc = e.target.closest('[data-gensrc]');
      if (gsrc) { genState().src = gsrc.dataset.gensrc; rerender(); return; }
      const rb = e.target.closest('[data-r]');
      if (rb && EQ.sel) {
        EQ.sel.r = Number(rb.dataset.r);
        (EQ.sel.aff || []).forEach(f => { if (!f.raid) clampAff(EQ.sel, f); });
        NS.apply(false); rerender(); return;
      }
      const btn = e.target.closest('[data-do]');
      if (!btn) return;
      const act = btn.dataset.do, it = EQ.sel;
      /* 生成不依赖右侧选中哪件装备（刚打开面板时列表是空的） */
      if (act === 'gen') { genItem(root); return; }
      if (act === 'genrad') { const g = genState(); g.radiant = !g.radiant; rerender(); return; }
      if (!it) return;
      if (act === 'anc' || act === 'primal') {
        if (!Array.isArray(it.aff)) it.aff = [];
        if (act === 'primal') {
          it.primal = !it.primal;
          if (it.primal) it.anc = true;                  // 游戏里太古一定同时是上古（items.js: anc = primal || ...）
        } else {
          it.anc = !it.anc;
          if (!it.anc) it.primal = false;
        }
        it.aff.forEach(function (f) {
          if (f.raid) return;
          if (it.primal) maxAff(it, f); else clampAff(it, f);
        });
        NS.apply(false); rerender(); return;
      }
      /* 王庭辉耀：等价于主线的「上古」，四类数值一起 ×1.3 / ÷1.3 */
      if (act === 'radiant') {
        if (!it.raid) { NS.toast('只有王庭装备才有辉耀', true); return; }
        setRadiant(it, !it.radiant);
        NS.apply(false); rerender();
        NS.toast('辉耀' + (it.radiant ? ' 已开启（数值 ×1.3）' : ' 已关闭（回到普通王庭）'));
        return;
      }
      /* 词缀全满：不碰任何标志位，只把数值顶到区间上限。王庭装备靠它（没有太古可用）。 */
      if (act === 'maxaff') {
        if (!Array.isArray(it.aff)) it.aff = [];
        let n = 0;
        it.aff.forEach(function (f) { if (!f.raid) { maxAff(it, f); n++; } });
        NS.apply(false); rerender();
        NS.toast(n ? `${n} 条词缀已拉满` : '这件装备没有可改的词缀', !n);
        return;
      }
      if (act === 'addaff') {
        if (!Array.isArray(it.aff)) it.aff = [];
        const used = it.aff.filter(f => !f.raid && !f.fixed).map(f => f.k);
        const pool = affOptions(it, -1).filter(k => used.indexOf(k) < 0);
        if (!pool.length) { NS.toast('该部位没有可加的词缀了', true); return; }
        const k = pool[0], r = NS.affRangeOf(k, it) || [1, 1];
        const f = { k: k, v: NS.roundStat(r[1], pct(k)), q: 1 };
        it.aff.push(f); NS.apply(false); rerender(); return;
      }
      if (act.indexOf('delaff:') === 0) {
        const i = Number(act.split(':')[1]);
        /* 只有 ◆ 固定词条不能删（读档会被重建，删了也白删）；生命词条是普通词缀，可以删。 */
        if (!it.aff[i] || it.aff[i].raid) return;
        it.aff.splice(i, 1); NS.apply(false); rerender(); return;
      }
      if (act === 'addsock') {
        const max = G.SOCKET_MAX[it.t] || 0;
        it.sock = it.sock || [];
        if (it.sock.length >= max) return;
        it.sock.push(null); NS.apply(false); rerender(); return;
      }
    });

    root.addEventListener('input', function (e) {
      const box = e.target;
      if (!box.dataset || box.dataset.q === undefined) return;
      EQ.q = box.value;
      const holder = root.querySelector('.iap-eqitems');
      if (holder) holder.innerHTML = itemsHTML();          // 只换列表，搜索框保持焦点
    });

    root.addEventListener('change', function (e) {
      const el = e.target;
      /* 生成器自己的字段：只更新表单状态，不影响右侧编辑器 */
      if (el.dataset && el.dataset.gen) {
        const g = genState(), k = el.dataset.gen;
        if (k === 'ilvl') g.ilvl = Math.floor(NS.clampNum(NS.parseNum(el.value, g.ilvl), 1, F.ruleIlvl(9999)));
        else if (k === 'r') g.r = Number(el.value) || 0;
        else if (k === 't') g.t = el.value;
        else if (k === 'rid') g.rid = el.value;
        else if (k === 'diff') g.diff = el.value;
        else if (k === 'odd') g.odd = el.value;
        else if (k === 'myth') g.myth = el.value;
        return;
      }
      const it = EQ.sel;
      if (!it || !el.dataset || !el.dataset.eq) return;
      const [kind, arg] = String(el.dataset.eq).split(':');
      const S = G.S;
      if (kind === 'ilvl') {
        const cap = F.ruleIlvl(9999);
        it.ilvl = Math.floor(NS.clampNum(NS.parseNum(el.value, it.ilvl), 1, cap));
        (it.aff || []).forEach(f => { if (!f.raid) clampAff(it, f); });
      } else if (kind === 'plus') {
        it.plus = Math.floor(NS.clampNum(NS.parseNum(el.value, it.plus || 0), 0, G.MAX_PLUS));
      } else if (kind === 'base') {
        const r = NS.baseRange(it, arg);
        if (r) {
          const v = NS.clampNum(NS.parseNum(el.value, 0), r[0], r[1]);
          const val = Math.round(v * 10) / 10;
          if (arg === 'imp') it.imp.v = val; else it[arg] = val;
        }
      } else if (kind === 'affk') {
        const i = Number(arg), f = it.aff[i];
        if (f && !f.raid) {
          if (el.value === '__life_fixed') {
            /* 选「生命·王庭」：挂上 fixed 标记，数值改走 RAID_LIFE_MUL 那条公式。
               该部位没有生命乘数（武器 / 副手）就直接拒绝，避免写成 1 点生命。
               同一件装备只保留一条，别处的先摘掉。 */
            if (!NS.raidLifeRange(it)) { NS.toast('这个部位没有王庭生命词条', true); return; }
            it.aff.forEach(function (g, j) { if (j !== i && g.fixed && !g.raid) delete g.fixed; });
            f.k = 'life';
            f.fixed = 1;
          } else if (G.AFF[el.value]) {
            if (f.fixed) delete f.fixed;                 // 换成普通词条，fixed 标记要摘掉
            f.k = el.value;
          } else {
            return;                                      // 空值 / 不在词缀表里的值：原样不动
          }
          const r = NS.affRangeAny(it, f) || [1, 1];
          f.v = NS.roundStat(NS.clampNum(Number(f.v) || 0, r[0], r[1]), pct(f.k));
          f.q = r[1] > r[0] ? Math.max(0, Math.min(1, (f.v - r[0]) / (r[1] - r[0]))) : 1;
        }
      } else if (kind === 'affv') {
        const i = Number(arg), f = it.aff[i];
        if (f && !f.raid) { f.v = NS.parseNum(el.value, f.v); clampAff(it, f); }   // fixed 生命词条也允许改
      } else if (kind === 'sockg') {
        const i = Number(arg), g = it.sock[i];
        if (!el.value) { it.sock[i] = null; }
        else it.sock[i] = { g: el.value, q: g ? g.q : 0 };
      } else if (kind === 'sockq') {
        const i = Number(arg), g = it.sock[i];
        if (g) g.q = Number(el.value) || 0;
      }
      NS.apply(false); rerender();
    });
  }

  /* ---------- 生成 ---------- */
  /* 生成物放哪儿：照 handleNew（items.js:445）的分流规则，但**跳过自动装备与自动分解**，
     免得点一下「生成」就把身上的装备换掉。
       本职业 / 通用 → 背包 → 个人仓库 → 共用仓库
       别职业       → 共用仓库 → 个人仓库 → 背包
     顺手记图鉴（codexRecordItem / raidCodexOwn），与正常掉落一致。 */
  function putItem(it) {
    const S = G.S, A = G.A;
    try { if (typeof codexRecordItem === 'function') codexRecordItem(it); } catch (e) { }
    if (it.raid && typeof raidCodexOwn === 'function') { try { raidCodexOwn(it.raid); } catch (e) { } }
    const own = !it.cls || it.cls === S.cls;
    const inv = S.inv || (S.inv = []), stash = S.stash || (S.stash = []);
    const tabs = (A && A.shared && Array.isArray(A.shared.tabs)) ? A.shared.tabs : null;
    const open = (A && A.shared && A.shared.open) || 0;
    const tabCap = LIM.tab(), tabRoom = function () {
      if (!tabs) return -1;
      for (let i = 0; i < tabs.length; i++) if (i < open && tabs[i].length < tabCap) return i;
      return -1;
    };
    if (own) {
      if (inv.length < LIM.inv()) { inv.push(it); return '背包'; }
      if (stash.length < LIM.stash()) { stash.push(it); return '个人仓库'; }
    }
    const ti = tabRoom();
    if (ti >= 0) { tabs[ti].push(it); return '共用仓库 ' + (ti + 1); }
    if (stash.length < LIM.stash()) { stash.push(it); return '个人仓库'; }
    inv.push(it); return '背包';
  }

  /* 从 DOM 里再读一遍 ilvl（change 事件在按钮 mousedown 时已经触发过，
     这里兜一层：万一用户直接回车，也不会用到上一次的值） */
  function readGen(root) {
    const g = genState();
    const box = root.querySelector('[data-gen="ilvl"]');
    if (box) g.ilvl = Math.floor(NS.clampNum(NS.parseNum(box.value, g.ilvl), 1, F.ruleIlvl(9999)));
    return g;
  }

  function done(it, where) {
    EQ.sel = it;
    NS.apply(false);                       // refreshStats → markAll → save（save 里会连带写账号档）
    NS.toast('已生成 ' + NS.itemName(it) + ' → ' + where);
    rerender();
  }

  function genItem(root) {
    const g = readGen(root);
    if (g.src === 'raid') return genRaid(g);
    if (g.src === 'odd') return genOdd(g);
    if (g.src === 'myth') return genMyth(g);
    return genMain(g);
  }

  /* 主线：用游戏自己的 rollItem，保证品质 / 词缀条数 / 基础数值全部合法 */
  function genMain(g) {
    const S = G.S;
    if ((S.inv || []).length >= LIM.inv()) { NS.toast('背包已满（' + LIM.inv() + ' 格），先清一点', true); return; }
    let it = null;
    try { it = rollItem(g.ilvl, g.r, g.t, S.cls); } catch (e) { console.warn('[IAP] rollItem 失败', e); }
    if (!it) { NS.toast('生成失败', true); return; }
    S.inv.push(it);
    done(it, '背包');
  }

  /* 王庭：raidRollItem 只吃 id + 难度，等级与品阶倍率都由它自己算。
     rng 必须显式传 Math.random —— 不传时它会退回 mulberry32(1)，每次生成的装备一模一样。 */
  function genRaid(g) {
    if (typeof raidRollItem !== 'function') { NS.toast('找不到 raidRollItem，生成器不可用', true); return; }
    if (!g.rid) { NS.toast('王庭掉落表是空的', true); return; }
    let it = null;
    try { it = raidRollItem(g.rid, g.diff, Math.random, { radiant: !!g.radiant }); } catch (e) { console.warn('[IAP] raidRollItem 失败', e); }
    if (!it) { NS.toast('生成失败', true); return; }
    done(it, putItem(it));
  }

  /* 奇物：rollOddity 内部走 rollItem，再改写 r = 5 / odd / 清空词缀，
     并把职业按 oddClassFor()（职业专属、副手类型）定下来。 */
  function genOdd(g) {
    if (typeof rollOddity !== 'function') { NS.toast('找不到 rollOddity，生成器不可用', true); return; }
    let it = null;
    try { it = rollOddity(g.odd, g.ilvl); } catch (e) { console.warn('[IAP] rollOddity 失败', e); }
    if (!it) { NS.toast('生成失败', true); return; }
    /* 账号唯一性登记：不写的话本局游戏还以为没拥有，会再掉一件同样的 */
    try { if (typeof oddClaim === 'function') oddClaim(it); } catch (e) { }
    done(it, putItem(it));
  }

  /* 神话：mythRollItem(k, cls) = mythBase(k, cls, 随机种子)，底子就是「史诗辉耀王庭」的
     raidRollItem，再剥掉王庭身份换成 r = 7（myth.js:39）。神格、神契都在 myth.js 里算，
     这里只负责造出来并登记账号唯一性。
     A.myth.own 一定要写：不写的话游戏还以为没拥有过，下一只神兽掉落会再给一件同款。 */
  function genMyth(g) {
    if (typeof mythRollItem !== 'function') { NS.toast('找不到 mythRollItem（游戏版本低于 2.4.0？）', true); return; }
    const S = G.S, A = G.A;
    if (!A) { NS.toast('账号档还没就绪', true); return; }
    const k = g.myth;
    if (!k) { NS.toast('没有选中神兽', true); return; }
    let it = null;
    try { it = mythRollItem(k, S.cls); } catch (e) { console.warn('[IAP] mythRollItem 失败', e); }
    if (!it) { NS.toast('生成失败', true); return; }
    /* mythNormAccount() 会顺带把 A.myth 补成完整结构（own / pact / pity / titles / kills） */
    let acc = null;
    try { acc = typeof mythNormAccount === 'function' ? mythNormAccount() : A.myth; } catch (e) { acc = null; }
    if (!acc || typeof acc !== 'object') acc = A.myth = { own: {}, pact: {}, pity: {}, titles: {}, kills: {} };
    if (!acc.own || typeof acc.own !== 'object') acc.own = {};
    const first = !acc.own[k];
    acc.own[k] = true;
    if (first) {
      try { if (typeof ach === 'function') ach('ACH_MYTH'); } catch (e) { }
      try {
        const K = G.MYTH_KEYS;
        if (K.length && K.every(x => acc.own[x]) && typeof ach === 'function') ach('ACH_MYTH50');
      } catch (e) { }
    }
    done(it, putItem(it) + (first ? '' : '（这只已经拥有过，重复件）'));
  }

  NS.registerTab({ key: 'eq', name: '装备', render: render, bind: bind });
})();
