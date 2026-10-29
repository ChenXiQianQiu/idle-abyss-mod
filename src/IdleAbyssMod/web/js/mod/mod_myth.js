'use strict';
/* ============================================================
   mod_myth.js — 秘境页（传奇秘境 / 神兽 / 山海图录，游戏 2.4.0 新增）
   ------------------------------------------------------------
   四个开关，都不复制游戏逻辑，只改它读的那几个概率：

   1) 100 层起必定神兽
      游戏：myth.js:68 mythSpawnRoll(lv)
         `if (DEMO || !mythOn() || lv < MYTH_BAL.from || RF.weekly || RF.expedition) return null;`
         `const p = lv % 10 === 0 ? MYTH_BAL.spawn.gate : MYTH_BAL.spawn.base;`
         `if (Math.random() >= p) return null;`
      即「召出守护者时，普通层 8% / 逢十层 25% 换成神兽」。MYTH_BAL.from 本来就是 100，
      所以把 spawn.base / spawn.gate 都设成 1，就是 100 层起每次守护者都是神兽。
      周常秘境与远征（RF.weekly / RF.expedition）依旧不刷神兽 —— 那是游戏自己排除的，
      这两个开关不碰它，免得周常奖励被神兽顶掉。

   2) 150 层起必定神兽真身
      同一函数末尾：`const avatar = lv >= MYTH_BAL.avatar.from && Math.random() < MYTH_BAL.avatar.chance;`
      avatar.from = 150、chance = 0.3，把 chance 设成 1 即 150 层起必定真身
      （生命 ×3、掉落掷两次、招牌技能间隔 ×0.8）。

   3) 专属装备必出 / 4) 专属称号必出
      游戏：myth.js:237 mythReward(roll, lv)
         `const pItem = acc.kills[k] === 1 && i === 0 ? D.first : D.item;`
         `if (pity[0] + 1 >= D.pityItem || Math.random() < pItem) { … mythGrantItem(k) … }`
         `if (pity[1] + 1 >= D.pityTitle || Math.random() < D.title) { … mythGrantTitle(k) … }`
      MYTH_BAL.drop 里 item 15% / first 30% / title 10%，保底 6 次 / 10 次。
      把 drop.item 与 drop.first 都设成 1 就是每次装备判定必出（首杀那一次也一样），
      把 drop.title 设成 1 就是每次称号判定必出。
      注意判定式是 `Math.random() < p`，p = 1 时 Math.random() 取值 [0,1) 恒成立，
      所以「必出」是严格 100%，不需要动保底计数（pity 照样会被清零，不会攒着）。
      真身掷两次（MYTH_BAL.avatar.rolls），所以一次真身击杀 = 装备 + 1 颗神契星 + 称号。

   为什么改数值而不是包装函数：mythSpawnRoll / mythReward 都是顶层 function 声明，能包；
   但前者内部有 realmCur / deep / weighted 一整套权重抽取，后者还牵着保底计数和
   A.myth 的写入顺序，重写一份等于把游戏的平衡表抄一遍，以后版本一改就对不上。
   改概率只动几个数字，关掉时原样写回，最不容易出问题。

   5) 指定神兽（这一条是包装函数，不是改数值）
      游戏：myth.js:68 mythSpawnRoll(lv)，rift.js:206 裸名调用。
      「刷不刷」由上面 1) 的必定神兽 / 原版概率决定，这一条只决定「刷出来的是哪一只」：
      原函数照常跑（该不出就不出），只在真的掷出神兽之后把 roll.k 换成指定那只。
      权重抽取还是游戏自己的（realmCur / deep / weighted），所以「随机」时和原版完全一致。
      注意指定不按界过滤：在 100 层也能指定四象那只，这属于作弊范围，界面里有说明。

   另外顺手给了两个整表开关（解锁全部称号 / 神契全满），因为山海图录是独立乘区，
   想验证后期强度时一件件打太慢。这两步只写 A.myth，走游戏自己的 refreshStats。
   ============================================================ */
(function () {
  const NS = window.IAP, G = NS.G, F = NS.fn;
  const MY = (NS.myth = {
    forceBeast: !!NS.prefs.mythForceBeast,
    forceAvatar: !!NS.prefs.mythForceAvatar,
    forceItem: !!NS.prefs.mythForceItem,
    forceTitle: !!NS.prefs.mythForceTitle,
    /* 指定神兽：'' / 'any' = 随机（按当前界权重），否则刷出神兽时固定成这一只。
       「刷不刷」是别的开关的事，这里只管「是哪一只」。 */
    pickBeast: String(NS.prefs.mythPickBeast || ''),
    orig: null,
  });
  const rerender = function () { if (NS.panel) NS.panel.refresh(); };

  function savePrefs() {
    NS.prefs.mythForceBeast = MY.forceBeast;
    NS.prefs.mythForceAvatar = MY.forceAvatar;
    NS.prefs.mythForceItem = MY.forceItem;
    NS.prefs.mythForceTitle = MY.forceTitle;
    NS.prefs.mythPickBeast = MY.pickBeast;
    NS.savePrefs();
  }
  /* v0.6.2 有个「必刷层」开关，和「100 层起必定神兽」功能重复，已经删掉；
     这里顺手把残留的偏好键清掉，免得 localStorage 里越攒越多。 */
  if (NS.prefs.mythForceLv !== undefined) { delete NS.prefs.mythForceLv; NS.savePrefs(); }

  /* ---------- 开关：改 MYTH_BAL 里的几个概率 ----------
     第一次调用时把原值记下来，之后开 / 关都只是在这两组数之间切换，
     关掉后与未装 Mod 完全一致。原值逐字段兜底记录（而不是整体判空），
     这样以后再加字段也不会把已经被改过的值误当成原值。 */
  function applyCfg() {
    const B = G.MYTH_BAL;
    if (!B || !B.spawn || !B.avatar || !B.drop) return false;
    const O = MY.orig || (MY.orig = {});
    if (O.base == null) O.base = B.spawn.base;
    if (O.gate == null) O.gate = B.spawn.gate;
    if (O.avatar == null) O.avatar = B.avatar.chance;
    if (O.item == null) O.item = B.drop.item;
    if (O.first == null) O.first = B.drop.first;
    if (O.title == null) O.title = B.drop.title;
    B.spawn.base = MY.forceBeast ? 1 : O.base;
    B.spawn.gate = MY.forceBeast ? 1 : O.gate;
    B.avatar.chance = MY.forceAvatar ? 1 : O.avatar;
    B.drop.item = MY.forceItem ? 1 : O.item;
    B.drop.first = MY.forceItem ? 1 : O.first;
    B.drop.title = MY.forceTitle ? 1 : O.title;
    return true;
  }
  MY.apply = applyCfg;
  applyCfg();
  /* 游戏脚本都在 Mod 之前，理论上已就绪；万一顺序变了，1 秒后补一次 */
  if (!MY.orig) setTimeout(applyCfg, 1000);

  /* ---------- 指定神兽：包装 mythSpawnRoll ----------
     mythSpawnRoll 是顶层 function 声明（myth.js:68），挂在 window 上，rift.js:206 是裸名调用，
     所以覆盖 window 上的同名属性就能接管。

     只做一件事：原函数照常跑（该不出就不出、该走权重就走权重），
     如果它真的返回了一只神兽，再把 roll.k 换成指定的那一只。
     这样「刷不刷」的判定完全留在游戏手里（也就是上面那几个概率开关说了算），
     这一条只管「刷出来的是哪一只」，不会和「必定神兽」重复。 */
  function hookSpawn() {
    if (MY.hookedSpawn || typeof mythSpawnRoll !== 'function') return;
    const orig = mythSpawnRoll;
    MY.origSpawn = orig;
    window.mythSpawnRoll = function (lv) {
      const r = orig.apply(this, arguments);
      const k = MY.pickBeast;
      if (r && k && k !== 'any' && G.MYTH && G.MYTH[k]) r.k = k;
      return r;
    };
    MY.hookedSpawn = true;
  }
  hookSpawn();
  if (!MY.hookedSpawn) setTimeout(hookSpawn, 1000);

  /* ---------- 数据读取 ---------- */
  /* mythNormAccount() 会把 A.myth 补成完整结构（own / pact / pity / titles / kills），
     顺带丢掉非法值，和游戏读档时走的是同一条路。 */
  const acc = function () {
    const A = G.A;
    if (!A) return null;
    try { if (typeof mythNormAccount === 'function') return mythNormAccount(); } catch (e) { }
    return (A.myth && typeof A.myth === 'object') ? A.myth : null;
  };
  const isNew = function () { try { return typeof isNewRules === 'function' ? !!isNewRules() : false; } catch (e) { return false; } };
  const riftLv = function () {
    try { return (typeof RF !== 'undefined' && RF && RF.on) ? (Number(RF.lv) || 0) : 0; } catch (e) { return 0; }
  };
  const best = function () { try { return typeof riftBest === 'function' ? (Number(riftBest()) || 0) : 0; } catch (e) { return 0; } };

  /* ---------- 页面 ---------- */
  function toggleChip(key, on, name, note) {
    return `<div class="iap-row"><div class="iap-lab"><b>${name}</b><small>${note}</small></div>
      <button class="iap-chip${on ? ' on' : ''}" data-do="toggle:${key}">${on ? '已开启' : '已关闭'}</button></div>`;
  }

  /* 51 只神兽按界分组的标签墙：绿 = 已拥有装备，✦ = 已拿称号，★ = 神契等级 */
  function beastChips(a) {
    const T = G.MYTH, keys = G.MYTH_KEYS, realms = G.MYTH_REALMS;
    if (!T || !keys.length) return '<span class="dim">没有读到神兽表。</span>';
    const out = realms.map(function (r, i) {
      const list = keys.filter(function (k) { return T[k] && T[k].realm === i; });
      if (!list.length) return '';
      const chips = list.map(function (k) {
        const M = T[k], own = !!(a.own && a.own[k]), title = !!(a.titles && a.titles[k]);
        const pact = Number(a.pact && a.pact[k]) || 0;
        const tip = `${M.n} · ${M.item.n}（${M.item.g}）${title ? ' · 称号：' + M.title.n : ''}${pact ? ' · 神契 ' + pact + ' 星' : ''}`;
        return `<i class="iap-cd${own ? ' on' : ''}" title="${NS.esc(tip)}">${NS.esc(M.n)}${pact ? ' ' + '★'.repeat(pact) : ''}${title ? ' ✦' : ''}</i>`;
      }).join('');
      return `<div class="iap-lab" style="padding:2px 6px 0"><small>${NS.esc(r.n)} · ${NS.esc(String(r.from))} 层起</small></div>
        <div class="iap-cds" style="justify-content:flex-start;padding:0 6px 4px">${chips}</div>`;
    }).join('');
    return out;
  }

  function render() {
    const S = G.S, A = G.A;
    if (!S || !S.cls) return `<div class="iap-empty">还没有进入角色，先选一个英雄再打开调试台。</div>`;
    if (!A) return `<div class="iap-empty">账号档还没就绪（读档中），稍等再试。</div>`;
    const B = G.MYTH_BAL, T = G.MYTH;
    if (!B || !T || !G.MYTH_KEYS.length) return `<div class="iap-empty">这个版本还没有传奇秘境（需要游戏 2.4.0 以上）。</div>`;

    const a = acc() || { own: {}, pact: {}, titles: {}, kills: {} };
    const total = G.MYTH_KEYS.length;
    const ownN = Object.keys(a.own || {}).length;
    const titleN = Object.keys(a.titles || {}).length;
    const pactN = Object.keys(a.pact || {}).reduce(function (s, k) { return s + (Number(a.pact[k]) || 0); }, 0);
    const codexPct = Math.round(titleN * B.codex * 1000) / 10;
    const lv = riftLv();
    const ok = isNew();

    const warn = ok ? '' : `<div class="iap-hint bad">当前角色不是新规则，游戏本身就不会刷神兽（mythOn() 要求 isNewRules()），开关不会生效。</div>`;
    const here = lv >= B.from ? `第 <b>${lv}</b> 层 · 传奇秘境范围内` : (lv ? `第 <b>${lv}</b> 层 · 还不到 ${B.from} 层` : '不在秘境里');
    /* 说明文字里的「原版」一律取 MY.orig：B 里的值已经被开关改过了 */
    const O = MY.orig || { base: B.spawn.base, gate: B.spawn.gate, avatar: B.avatar.chance, item: B.drop.item, first: B.drop.first, title: B.drop.title };
    const pctOf = function (v) { return Math.round(Number(v) * 100) + '%'; };

    return `<div class="iap-note">传奇秘境 · 神兽与神话装备 · 第 <b>${B.from}</b> 层起 · 真身第 <b>${B.avatar.from}</b> 层起
      · 当前 ${here}</div>
      ${warn}
      <div class="iap-sec"><div class="iap-sechd"><b>神兽刷新</b><small>只改概率，不改抽取权重</small></div>
        ${toggleChip('forceBeast', MY.forceBeast, '100 层起必定神兽', '守护者出现时 100% 换成神兽（普通层 8% / 逢十层 25% → 100%）')}
        ${toggleChip('forceAvatar', MY.forceAvatar, '150 层起必定真身', '神兽一律是真身：生命 ×3、掉落掷两次、招牌技能间隔 ×0.8（30% → 100%）')}
        <div class="iap-row"><div class="iap-lab"><b>指定神兽</b><small>刷出神兽时固定成这一只 · 随机 = 按当前界的权重抽</small></div>
          <select class="iap-in" style="width:190px" data-m="pick" aria-label="指定神兽">
            <option value="any"${!MY.pickBeast || MY.pickBeast === 'any' ? ' selected' : ''}>随机（按当前界权重）</option>
            ${(G.MYTH_KEYS || []).map(function (k) {
              const M = G.MYTH[k];
              return `<option value="${k}"${MY.pickBeast === k ? ' selected' : ''}>${NS.esc(M.n)} · ${NS.esc(M.item.n)}</option>`;
            }).join('')}
          </select></div>
        ${MY.hookedSpawn ? '' : '<div class="iap-hint bad">挂钩没接上（找不到 mythSpawnRoll），指定神兽不会生效。</div>'}
        <div class="iap-hint">原版：每次召出守护者时掷一次，普通层 ${pctOf(O.base)}、逢十层 ${pctOf(O.gate)}
          换成神兽，出现时时限 +${B.time} 秒、生命 = 守护者 ×${B.hpM}；${B.avatar.from} 层起再掷一次
          ${pctOf(O.avatar)} 变成真身。<br>
          「指定神兽」只管<b>刷出来的是哪一只</b>，不管刷不刷 —— 要不要每层都出神兽，看上面那个
          「100 层起必定神兽」。两个一起开就是「每层都出、而且都是同一只」。<br>
          指定不按界过滤：在 100 层也能指定四象那只（界越高血越厚、掉落结晶越多）。
          层数用游戏自带的「选择层数」跳，这里不管导航。
          周常秘境和远征不刷神兽（游戏自己排除的），这些开关不碰那条规则。</div>
      </div>
      <div class="iap-sec"><div class="iap-sechd"><b>神兽掉落</b><small>只改概率，保底计数照常走</small></div>
        ${toggleChip('forceItem', MY.forceItem, '专属装备必出', '每次装备判定 100% 给专属神话装备（原版首杀 ' + pctOf(O.first) + ' / 之后 ' + pctOf(O.item) + '）')}
        ${toggleChip('forceTitle', MY.forceTitle, '专属称号必出', '每次称号判定 100% 给专属称号（原版 ' + pctOf(O.title) + '）')}
        <div class="iap-hint">原版：击败神兽时装备与称号各掷一次，装备首杀 ${pctOf(O.first)}、之后 ${pctOf(O.item)}，
          称号 ${pctOf(O.title)}；装备连续 ${B.drop.pityItem - 1} 次没出、第 ${B.drop.pityItem} 次必出，
          称号第 ${B.drop.pityTitle} 次必出。中不中都另掉一件传奇或套装（30% 套装）。<br>
          开了「必出」之后保底计数照样会被清零，不会攒着；真身掷两次，所以一次真身击杀 =
          装备 + 1 颗神契星 + 称号。已经拥有那只神兽的装备时，装备判定会自动转成神契 +1 星
          （满 ${B.pactMax} 星后折深渊结晶）。</div>
      </div>
      <div class="iap-sec"><div class="iap-sechd"><b>收集进度</b><small>账号共用</small></div>
        <div class="iap-row"><div class="iap-lab"><b>神兽装备</b><small>神话（r = 7）· 账号唯一 · 不能分解</small></div>
          <div class="iap-cur"><i data-m="own">${ownN}/${total}</i></div></div>
        <div class="iap-row"><div class="iap-lab"><b>神契总星数</b><small>重复拿到同一只 +1 星，满 ${B.pactMax} 星后折深渊结晶</small></div>
          <div class="iap-cur"><i data-m="pact">${pactN}/${total * B.pactMax}</i></div></div>
        <div class="iap-row"><div class="iap-lab"><b>山海图录</b><small>每个称号：伤害与最大生命各 +${B.codex * 100}%（独立乘区，团本也算）</small></div>
          <div class="iap-cur"><i data-m="title">${titleN}/${total}</i></div></div>
        <div class="iap-row"><div class="iap-lab"><b>图录加成</b><small>当前合计</small></div>
          <div class="iap-cur"><i data-m="codex">+${codexPct}%</i></div></div>
        <div class="iap-affadd">
          <button class="iap-btn" data-do="alltitle">解锁全部称号</button>
          <button class="iap-btn" data-do="allpact">神契全满</button>
        </div>
        <div class="iap-hint">「解锁全部称号」只写 A.myth.titles，不动当前佩戴的称号，也不发装备；
          图录加成会立刻重算。「神契全满」把每只神兽的神契都设成 ${B.pactMax} 星（神格数值 ×${(1 + B.pactStep * B.pactMax).toFixed(1)}），
          只对已经穿在身上的神话装备生效。<br>
          想要神话装备本身：去<b>装备页 → 生成 → 神话</b>，51 只神兽的专属装备都能直接造一件。</div>
      </div>
      <div class="iap-sec"><div class="iap-sechd"><b>神兽一览</b><small>绿 = 已拥有装备 · ★ = 神契 · ✦ = 已有称号</small></div>
        ${beastChips(a)}
      </div>`;
  }

  const TOGGLE_NAME = {
    forceBeast: '100 层起必定神兽',
    forceAvatar: '150 层起必定真身',
    forceItem: '专属装备必出',
    forceTitle: '专属称号必出',
  };

  function bind(root) {
    root.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-do]');
      if (!btn) return;
      const act = btn.dataset.do;
      if (act.indexOf('toggle:') === 0) {
        const k = act.slice(7);
        if (!TOGGLE_NAME[k]) return;
        MY[k] = !MY[k];
        savePrefs();
        const applied = applyCfg();
        NS.toast(TOGGLE_NAME[k] + (MY[k] ? ' 已开启' : ' 已关闭') + (applied ? '' : '（没读到 MYTH_BAL，未生效）'), !applied && MY[k]);
        rerender();
        return;
      }
      const a = acc();
      if (!a) return;
      if (act === 'alltitle') {
        if (!a.titles || typeof a.titles !== 'object') a.titles = {};
        G.MYTH_KEYS.forEach(function (k) { a.titles[k] = true; });
        try { if (typeof ach === 'function') ach('ACH_MYTH_TITLE50'); } catch (e) { }
        NS.apply(false);
        NS.toast('山海图录已全解锁（' + G.MYTH_KEYS.length + ' 个称号）');
        rerender();
        return;
      }
      if (act === 'allpact') {
        const max = (G.MYTH_BAL && G.MYTH_BAL.pactMax) || 5;
        if (!a.pact || typeof a.pact !== 'object') a.pact = {};
        G.MYTH_KEYS.forEach(function (k) { a.pact[k] = max; });
        NS.apply(false);
        NS.toast('神契全满（每只 ' + max + ' 星）');
        rerender();
        return;
      }
    });

    /* 指定神兽：只存偏好，不必重绘（下拉框自己已经显示新值） */
    root.addEventListener('change', function (e) {
      const sel = e.target.closest('[data-m="pick"]');
      if (!sel) return;
      MY.pickBeast = String(sel.value || 'any');
      savePrefs();
      const M = (MY.pickBeast !== 'any' && G.MYTH) ? G.MYTH[MY.pickBeast] : null;
      NS.toast(M ? '神兽固定为 ' + M.n + ' · ' + M.item.n : '神兽改回随机', !MY.hookedSpawn);
    });
  }

  /* 每秒轻量同步：只刷数字，不重建 DOM（重建会把「神兽一览」的滚动位置顶回去） */
  function sync(root) {
    const a = acc();
    if (!a) return;
    const B = G.MYTH_BAL || {};
    const total = G.MYTH_KEYS.length || 0;
    const set = function (k, v) { const el = root.querySelector(`[data-m="${k}"]`); if (el) el.textContent = v; };
    const titleN = Object.keys(a.titles || {}).length;
    set('own', `${Object.keys(a.own || {}).length}/${total}`);
    set('pact', `${Object.keys(a.pact || {}).reduce(function (s, k) { return s + (Number(a.pact[k]) || 0); }, 0)}/${total * ((B && B.pactMax) || 5)}`);
    set('title', `${titleN}/${total}`);
    set('codex', `+${Math.round(titleN * ((B && B.codex) || 0) * 1000) / 10}%`);
  }

  NS.registerTab({ key: 'myth', name: '秘境', render: render, bind: bind, sync: sync });
})();
