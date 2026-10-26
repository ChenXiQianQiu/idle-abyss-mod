'use strict';
/* ============================================================
   mod_raid.js — 团本页（永夜王庭）
   ------------------------------------------------------------
   两个开关，都只在「单人挑战」里生效，联机团本完全走游戏原逻辑：

   1) 单人必定掉落
      游戏数据（data_raid.js:56）：
        drops: { base: { 1: 0, 2: 0, 3: 1, 4: 1 }, extra: { 1: .2, ... } }
      单人 teamSize = RAID_BAL.solo.size = 1，所以基础 0 件、额外 20% 才 +1 件，
      也就是单人打完首领只有 20% 概率掉 1 件。
      开关打开后，raidDevRollDrops 返回 0 件时补 1 件，走同样的
      raidLootTable() + raidRollItem()，产出规格与正常掉落一致。

   2) 无限掉落资格
      资格 = S.raid.cd[`${难度}:${首领}`]，只有真掉到装备才写
      （raid_ui.js:955 `if (items.length) raidUseCD(diff, B.id)`），
      每周由 raidWeekSync 清空（raid_items.js:451）。
      开关打开后，单人模式下 raidUseCD 直接返回 true 但不写 CD，
      于是本周每个首领的资格用不完。

   实现方式：包装游戏的全局函数。游戏是经典脚本，顶层 function 声明会挂到
   window 上，raidSoloLoot 里是裸名调用，所以包装 window 上的同名属性就能生效；
   开关关掉时原样转发给保存下来的原函数，行为与未装 Mod 完全一致。
   ============================================================ */
(function () {
  const NS = window.IAP, G = NS.G, F = NS.fn;
  const R = (NS.raid = {
    mustDrop: !!NS.prefs.raidMustDrop,
    noCd: !!NS.prefs.raidNoCd,
    hooked: { useCD: false, roll: false },
  });
  const rerender = function () { if (NS.panel) NS.panel.refresh(); };

  const savePrefs = function () {
    NS.prefs.raidMustDrop = R.mustDrop;
    NS.prefs.raidNoCd = R.noCd;
    NS.savePrefs();
  };
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
      const out = orig.roll.apply(this, arguments) || [];
      const size = Number(teamSize) || 1;
      if (R.mustDrop && soloNow() && size <= 1 && !out.length) {
        const it = rollOne(bossId, diff, rng, classes);
        if (it) out.push(it);
      }
      return out;
    };
    R.hooked.roll = true;
  }

  /* 按首领掉落表随机一件，规格与 raidDevRollDrops 里的一致 */
  function rollOne(bossId, diff, rng, classes) {
    try {
      const table = typeof raidLootTable === 'function' ? raidLootTable(bossId, classes) : null;
      if (!table || !table.length) return null;
      const pick = table[Math.min(table.length - 1, Math.floor(rng() * table.length))];
      if (!pick || typeof raidRollItem !== 'function') return null;
      return raidRollItem(pick.id, diff, rng);
    } catch (e) { console.warn('[IAP] 补掉落失败', e); return null; }
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

    return `<div class="iap-note">永夜王庭每周每个角色、每个首领各只有 <b>1 次</b>拿装备的资格。单人挑战原本只有 <b>${dropExtra}%</b> 几率掉 1 件（基础 ${dropBase} 件）。</div>
      ${hookedTxt}
      <div class="iap-sec"><div class="iap-sechd"><b>单人挑战</b><small>只影响单人，联机团本不受影响</small></div>
        ${toggleChip('mustDrop', R.mustDrop, '必定掉落', '每个首领保底 1 件王庭装备')}
        ${toggleChip('noCd', R.noCd, '无限掉落资格', '掉到装备也不消耗本周资格')}
      </div>
      <div class="iap-sec"><div class="iap-sechd"><b>本周资格</b><small>第 ${NS.esc(week)} 周 · 绿色 = 还能掉</small></div>
        ${diffs}
        <div class="iap-affadd"><button class="iap-btn" data-do="resetc">重置本周资格（三档全清）</button></div>
      </div>`;
  }

  function bind(root) {
    root.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-do]');
      if (!btn) return;
      const act = btn.dataset.do;
      if (act.indexOf('toggle:') === 0) {
        const k = act.slice(7);
        if (k === 'mustDrop' || k === 'noCd') {
          R[k] = !R[k];
          savePrefs();
          NS.toast((k === 'mustDrop' ? '必定掉落' : '无限掉落资格') + (R[k] ? ' 已开启' : ' 已关闭'));
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
  }

  NS.registerTab({ key: 'raid', name: '团本', render: render, bind: bind });
})();
