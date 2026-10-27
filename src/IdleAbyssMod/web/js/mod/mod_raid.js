'use strict';
/* ============================================================
   mod_raid.js — 团本页（永夜王庭）
   ------------------------------------------------------------
   三个开关 + 一个数值，都只在「单人挑战」里生效，联机团本完全走游戏原逻辑：

   1) 单人必定掉落
      游戏数据（data_raid.js:56）：
        drops: { base: { 1: 0, 2: 0, 3: 1, 4: 1 }, extra: { 1: .2, ... } }
      单人 teamSize = RAID_BAL.solo.size = 1，所以基础 0 件、额外 20% 才 +1 件，
      也就是单人打完首领只有 20% 概率掉 1 件。
      开关打开后，raidDevRollDrops 返回 0 件时补 1 件，走同样的
      raidLootTable() + raidRollItem()，产出规格与正常掉落一致。
      补件之后还要再走一次女王的稀世判定（见 tryRelic）：原函数那句
      `if (out.length && bossId === 'queen' && rng() < RAID_BAL.relic)` 是
      「有掉落才掷」，补件在它之后，不补这一步的话保底那件永远不是稀世，
      开关开着刷女王一百次也见不到永夜之心（概率还是原版的 20% × 1% = 0.2%）。

   2) 无限掉落资格
      资格 = S.raid.cd[`${难度}:${首领}`]，只有真掉到装备才写
      （raid_ui.js:955 `if (items.length) raidUseCD(diff, B.id)`），
      每周由 raidWeekSync 清空（raid_items.js:451）。
      开关打开后，单人模式下 raidUseCD 直接返回 true 但不写 CD，
      于是本周每个首领的资格用不完。

   3) 只掉本职业 / 通用
      掉落池由 raidLootTable() 给出（data_raid.js:189）：
        `RAID_ITEMS.filter(i => i.boss === bossId && i.kind !== 'relic')`
      它**不按职业过滤**——8 个职业的同部位装备全在池里，谁刷都一样
      （data_raid.js:172 的注释写明这是用户当初的决定）。所以单人打首领，
      8/9 的概率掉到别的职业的装备，只能进账号共用仓库，本职业拿不到。
      开关打开后，把掉落里「别的职业」的装备换成同部位、本职业的版本，
      通用首饰（cls = null，全职业可用）与稀世原样保留。
      换的是整件装备（重新走 raidRollItem），不是只改 cls 字段——职业一变，
      武器名、基础值、词缀池（affRollPool 按职业取）都得跟着换。

   4) 女王稀世概率
      直接改写 RAID_BAL.relic（data_raid.js:61，默认 .01）。
      raid_ui.js:1143 的判定读的就是这个字段，所以不用改逻辑，
      游戏自己的「女王有掉落时把最后一件换成稀世」就按新概率走。
      设为 100% 就是每次通关必掉永夜之心 / 女王的婚戒。

   实现方式：包装游戏的全局函数。游戏是经典脚本，顶层 function 声明会挂到
   window 上，raidSoloLoot 里是裸名调用，所以包装 window 上的同名属性就能生效；
   开关关掉时原样转发给保存下来的原函数，行为与未装 Mod 完全一致。
   ============================================================ */
(function () {
  const NS = window.IAP, G = NS.G, F = NS.fn;
  const R = (NS.raid = {
    mustDrop: !!NS.prefs.raidMustDrop,
    noCd: !!NS.prefs.raidNoCd,
    onlyOwn: !!NS.prefs.raidOnlyOwn,
    relicPct: Number.isFinite(NS.prefs.raidRelicPct) ? NS.prefs.raidRelicPct : null,   // null = 不接管，用游戏原值
    hooked: { useCD: false, roll: false },
  });
  const rerender = function () { if (NS.panel) NS.panel.refresh(); };

  const savePrefs = function () {
    NS.prefs.raidMustDrop = R.mustDrop;
    NS.prefs.raidNoCd = R.noCd;
    NS.prefs.raidOnlyOwn = R.onlyOwn;
    if (R.relicPct == null) delete NS.prefs.raidRelicPct;
    else NS.prefs.raidRelicPct = R.relicPct;
    delete NS.prefs.raidQueenJewel;                 // v0.3.1 起不再提供「女王掉普通首饰」
    NS.savePrefs();
  };

  /* 当前稀世概率（百分数，保留 1 位小数） */
  const relicPctNow = function () {
    const bal = G.RAID_BAL;
    const v = (bal && typeof bal.relic === 'number') ? bal.relic : .01;
    return Math.round(v * 1000) / 10;
  };
  /* 写 RAID_BAL.relic：游戏自己的判定逻辑不用改，概率就变了 */
  function applyRelic(pct) {
    const bal = G.RAID_BAL;
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    if (bal) bal.relic = Math.round(p * 10) / 1000;
    R.relicPct = p;
    savePrefs();
    return p;
  }
  /* 上次设过的概率在启动时补一次：RAID_BAL 每次开游戏都是默认 0.01 */
  if (R.relicPct != null) applyRelic(R.relicPct);
  /* 是否正处在单人挑战里（RAID_SOLO.on 由 raidSoloStart / raidSoloReset 维护） */
  const soloNow = function () {
    try { return !!(G.RAID_SOLO && G.RAID_SOLO.on); } catch (e) { return false; }
  };
  const cdCount = function (diff) {
    try { return (typeof raidCdCounts === 'function' ? raidCdCounts()[diff] : 0) || 0; } catch (e) { return 0; }
  };
  const hasCD = function (diff, boss) {
    try { return typeof raidHasCD === 'function' ? !!raidHasCD(diff, boss) : false; } catch (e) { return false; }
  };
  const ownCls = function () {
    try { const S = G.S; return (S && S.cls) || ''; } catch (e) { return ''; }
  };
  const asRng = function (rng) { return typeof rng === 'function' ? rng : Math.random; };

  /* ---------- 包装游戏函数 ---------- */
  const orig = {};

  function hookUseCD() {
    if (R.hooked.useCD || typeof raidUseCD !== 'function') return;
    orig.useCD = raidUseCD;
    window.raidUseCD = function (diff, boss) {
      /* 单人 + 开关打开：假装用掉，不写 S.raid.cd，资格永远还在 */
      if (R.noCd && soloNow()) return true;
      return orig.useCD.apply(this, arguments);
    };
    R.hooked.useCD = true;
  }

  function hookRoll() {
    if (R.hooked.roll || typeof raidDevRollDrops !== 'function') return;
    orig.roll = raidDevRollDrops;
    window.raidDevRollDrops = function (bossId, diff, rng, teamSize, classes) {
      const size = Number(teamSize) || 1;
      const solo = soloNow() && size <= 1;
      let out = orig.roll.apply(this, arguments) || [];
      /* 先换职业，再补保底：补出来的那件也必须符合「本职业 / 通用」 */
      if (solo && R.onlyOwn && out.length) {
        out = out.map(function (it) { return toOwnClass(it, diff, rng); });
      }
      if (solo && R.mustDrop && !out.length) {
        const it = rollOne(bossId, diff, rng, classes);
        if (it) out.push(it);
        /* 原函数的稀世判定写在 `if (out.length && ...)` 里，也就是「有掉落才掷」。
           补件发生在它之后，不补这一步的话，保底补出来的那件永远不可能是稀世，
           女王刷一百次也见不到永夜之心。 */
        if (out.length) tryRelic(out, bossId, diff, rng);
      }
      return out;
    };
    R.hooked.roll = true;
  }

  /* 复刻 raidDevRollDrops 末尾的稀世替换（data_raid.js:61 relic = .01）：
     女王有掉落时，把最后一件换成稀世（永夜之心 / 女王的婚戒）。
     稀世的 cls 是 null，所以上面的 toOwnClass 不会把它换成本职业装备。 */
  function tryRelic(out, bossId, diff, rng) {
    if (bossId !== 'queen' || !out.length) return;
    const bal = G.RAID_BAL;
    const chance = (bal && typeof bal.relic === 'number') ? bal.relic : .01;
    const J = G.RAID_JEWELS;
    if (!J) return;
    const rr = asRng(rng);
    if (!(rr() < chance)) return;
    const relics = Object.keys(J).filter(function (k) { return J[k] && J[k].relic; });
    if (!relics.length || typeof raidRollItem !== 'function') return;
    try {
      const pick = relics[Math.min(relics.length - 1, Math.floor(rr() * relics.length))];
      const it = raidRollItem(pick, diff, rr);
      if (it) out[out.length - 1] = it;
    } catch (e) { console.warn('[IAP] 稀世替换失败', e); }
  }

  /* 掉落池。onlyOwn 打开时只留本职业装备与通用首饰（cls 为 null）。
     万一过滤完是空表（数据改版之类），退回原池，宁可不筛也不给 0 件。 */
  function lootTable(bossId, classes) {
    let t = [];
    try { t = typeof raidLootTable === 'function' ? (raidLootTable(bossId, classes) || []) : []; } catch (e) { t = []; }
    if (!Array.isArray(t)) t = [];
    if (R.onlyOwn) {
      const cls = ownCls();
      const f = cls ? t.filter(function (i) { return !i.cls || i.cls === cls; }) : t;
      if (f.length) return f;
    }
    return t;
  }

  /* 按首领掉落表随机一件，规格与 raidDevRollDrops 里的一致 */
  function rollOne(bossId, diff, rng, classes) {
    try {
      const rr = asRng(rng);
      const table = lootTable(bossId, classes);
      if (!table.length) return null;
      const pick = table[Math.min(table.length - 1, Math.floor(rr() * table.length))];
      if (!pick || typeof raidRollItem !== 'function') return null;
      return raidRollItem(pick.id, diff, rr);
    } catch (e) { console.warn('[IAP] 补掉落失败', e); return null; }
  }

  /* 把别职业的装备换成同部位、本职业的版本。
     王庭掉落表里每个职业的同部位都在（data_raid.js:180 按 RAID_CLASSES 展开），
     所以一定能换到；通用首饰（cls = null）本来就是全职业可用，原样返回。 */
  function toOwnClass(it, diff, rng) {
    const cls = ownCls();
    if (!it || !cls || !it.raid || !it.cls || it.cls === cls) return it;
    const table = G.RAID_ITEM;
    const def = table && table[it.raid];
    if (!def || !def.t) return it;
    const alt = table[cls + '_' + def.t];
    if (!alt || typeof raidRollItem !== 'function') return it;
    try {
      /* 辉耀状态沿用原来那件，避免换个职业白送（或白扣）一次 radiant 判定 */
      const out = raidRollItem(alt.id, diff || it.raidDiff, asRng(rng), { radiant: !!it.radiant });
      return out || it;
    } catch (e) { console.warn('[IAP] 换成本职业装备失败', e); return it; }
  }

  hookUseCD(); hookRoll();
  /* 游戏脚本都在 Mod 之前，理论上已经就绪；万一顺序变了，1 秒后补一次 */
  if (!R.hooked.useCD || !R.hooked.roll) setTimeout(function () { hookUseCD(); hookRoll(); }, 1000);

  /* ---------- 页面 ---------- */
  function toggleChip(key, on, name, note) {
    return `<div class="iap-row"><div class="iap-lab"><b>${name}</b><small>${note}</small></div>
      <button class="iap-chip${on ? ' on' : ''}" data-do="toggle:${key}">${on ? '已开启' : '已关闭'}</button></div>`;
  }

  function render() {
    const S = G.S;
    if (!S || !S.cls) return `<div class="iap-empty">还没有进入角色，先选一个英雄再打开调试台。</div>`;
    if (typeof raidWeekCheck === 'function') { try { raidWeekCheck(); } catch (e) { } }   // 先处理跨周清 CD
    if (!S.raid) return `<div class="iap-empty">角色存档里没有团本数据（还没进过王庭？）。</div>`;

    const bal = G.RAID_BAL || {};
    const dropBase = (bal.drops && bal.drops.base && bal.drops.base[1]) || 0;
    const dropExtra = Math.round(((bal.drops && bal.drops.extra && bal.drops.extra[1]) || 0) * 100);

    const diffs = G.RAID_DIFFS.map(function (d) {
      const bosses = G.RAID_BOSSES.map(function (b) {
        const on = hasCD(d.id, b.id);
        const nm = (G.RAID_BOSS_SHORT && G.RAID_BOSS_SHORT[b.id]) || b.name;
        return `<i class="iap-cd${on ? ' on' : ''}" title="${NS.esc(b.name)} · ${on ? '本周还有掉落资格' : '本周已用掉'}">${NS.esc(nm)}</i>`;
      }).join('');
      return `<div class="iap-row"><div class="iap-lab"><b>${NS.esc(d.n)}</b><small>本周可掉落 ${cdCount(d.id)}/${G.RAID_BOSSES.length}</small></div>
        <div class="iap-cds">${bosses}</div></div>`;
    }).join('');

    const week = S.raid.week == null ? '?' : String(S.raid.week);
    const hookedTxt = (R.hooked.useCD && R.hooked.roll)
      ? ''
      : `<div class="iap-hint bad">挂钩没接上（${!R.hooked.useCD ? 'raidUseCD ' : ''}${!R.hooked.roll ? 'raidDevRollDrops' : ''}找不到），开关不会生效。</div>`;

    const cls = ownCls();
    const C = G.CLASSES;
    const clsName = (C && C[cls] && C[cls].n) ? C[cls].n : (cls || '未选');
    const relicPct = relicPctNow();                     // 0.01 → 1（百分数）
    const poolOf = function (bossId) {
      let t = [];
      try { t = typeof raidLootTable === 'function' ? (raidLootTable(bossId) || []) : []; } catch (e) { }
      const n = t.filter(function (i) { return !i.cls || i.cls === cls; }).length;
      return '只剩 ' + n + ' 件（原池 ' + t.length + ' 件）';
    };

    return `<div class="iap-note">永夜王庭每周每个角色、每个首领各只有 <b>1 次</b>拿装备的资格。单人挑战原本只有 <b>${dropExtra}%</b> 几率掉 1 件（基础 ${dropBase} 件）。</div>
      ${hookedTxt}
      <div class="iap-sec"><div class="iap-sechd"><b>单人挑战</b><small>只影响单人，联机团本不受影响</small></div>
        ${toggleChip('mustDrop', R.mustDrop, '必定掉落', '每个首领保底 1 件王庭装备')}
        ${toggleChip('onlyOwn', R.onlyOwn, '只掉本职业 / 通用', '掉落池只留本职业装备与全职业通用首饰')}
        ${toggleChip('noCd', R.noCd, '无限掉落资格', '掉到装备也不消耗本周资格')}
        <div class="iap-hint">当前职业：<b>${NS.esc(clsName)}</b>。原版掉落池 8 个职业混在一起，本职业只占 1/8，
          掉了也只能进共用仓库；开启后池子只剩本职业 + 通用首饰。
          通用首饰只挂在馆长 / 女官 / 园丁 / 守夜四个首领身上（各约 50%），门卫、宴主原本就没有首饰。
          女王的池子只有武器，过滤后 ${poolOf('queen')}，掉的一定是本职业武器。</div>
      </div>
      <div class="iap-sec"><div class="iap-sechd"><b>女王稀世</b><small>只影响单人挑战里的永夜女王</small></div>
        <div class="iap-row"><div class="iap-lab"><b>稀世概率</b><small>永夜之心 / 女王的婚戒 · 原版 1%</small></div>
          <input class="iap-in" type="text" inputmode="decimal" spellcheck="false" data-raid="relic" value="${relicPct}" aria-label="稀世概率（百分数）">
        </div>
        <div class="iap-chips">
          <button class="iap-chip${relicPct === 1 ? ' on' : ''}" data-relic="1">1%（原版）</button>
          <button class="iap-chip${relicPct === 10 ? ' on' : ''}" data-relic="10">10%</button>
          <button class="iap-chip${relicPct === 50 ? ' on' : ''}" data-relic="50">50%</button>
          <button class="iap-chip${relicPct === 100 ? ' on' : ''}" data-relic="100">100%</button>
        </div>
        <div class="iap-hint">稀世只从「女王这一件」里掷：开「必定掉落」后每次通关都掷一次（当前 <b>${relicPct}%</b>）；
          不开则只有 ${dropExtra}% × ${relicPct}% ≈ ${Math.round(dropExtra * relicPct) / 100}% 才轮得到。
          设为 100% 就是每次通关必掉一件稀世。除稀世外，女王只掉本职业武器（池子里没有普通首饰）。</div>
      </div>
      <div class="iap-sec"><div class="iap-sechd"><b>本周资格</b><small>第 ${NS.esc(week)} 周 · 绿色 = 还能掉</small></div>
        ${diffs}
        <div class="iap-affadd"><button class="iap-btn" data-do="resetc">重置本周资格（三档全清）</button></div>
      </div>`;
  }

  const TOGGLE_NAME = {
    mustDrop: '必定掉落',
    onlyOwn: '只掉本职业 / 通用',
    noCd: '无限掉落资格',
  };

  function bind(root) {
    root.addEventListener('click', function (e) {
      /* 稀世概率的快捷档 */
      const rl = e.target.closest('[data-relic]');
      if (rl) {
        const p = applyRelic(Number(rl.dataset.relic));
        rerender();
        NS.toast('女王稀世概率 → ' + p + '%');
        return;
      }
      const btn = e.target.closest('[data-do]');
      if (!btn) return;
      const act = btn.dataset.do;
      if (act.indexOf('toggle:') === 0) {
        const k = act.slice(7);
        if (TOGGLE_NAME[k]) {
          R[k] = !R[k];
          savePrefs();
          NS.toast(TOGGLE_NAME[k] + (R[k] ? ' 已开启' : ' 已关闭'));
          rerender();
        }
        return;
      }
      if (act === 'resetc') {
        const S = G.S;
        if (!S || !S.raid) return;
        S.raid.cd = {};
        NS.apply(false);
        NS.toast('已重置三个难度的本周掉落资格');
        rerender();
        return;
      }
    });

    /* 稀世概率输入框：回车 / 失焦时生效（面板里不会漏给游戏热键） */
    root.addEventListener('change', function (e) {
      const box = e.target;
      if (!box.dataset || box.dataset.raid !== 'relic') return;
      const p = applyRelic(NS.parseNum(box.value, relicPctNow()));
      rerender();
      NS.toast('女王稀世概率 → ' + p + '%');
    });
  }

  NS.registerTab({ key: 'raid', name: '团本', render: render, bind: bind });
})();
