'use strict';
/* ============================================================
   mod_camp.js — 营地页（派遣 / 好感）
   ------------------------------------------------------------
   两件事，都只写账号档 A，不碰角色档：

   1) 派遣无需等待
      派遣队伍存在 A.dispatch，每条是
        { id, slots, cls, zone, start, dur, elapsed }
      剩余时间由 camp.js:12 的 campElapsed() 算：
        clamp(max(tm.elapsed, (Date.now() - tm.start) / 1000), 0, tm.dur)
      所以把 elapsed 写成 dur（同时把 start 往前推 dur 秒）就等于「时间已经走完」，
      campIsDone() 立刻为真，营地里的「领取」按钮就能点。
      不动 dur、不动 zone，奖励仍按原时长结算（campPlan 读的是 tm.dur），
      不会造出「0 小时拿满额奖励」这种游戏自己不可能产生的数据。

   2) 好感一键全满
      好感小时数存在 A.affinity[`${a}|${b}`]，键由 campPairKey()（camp.js:255）
      按 heroIds() 的顺序拼出来。等级由 campAffLv() 数 CAMP_BAL.affinity
      = [2, 6, 12, 24, 48] 里跨过了几档，所以写 48 就是 Lv 5（五段对话全解锁）。
      领取奖励时游戏只会往上加（camp.js:144），不会覆盖，直接赋值是安全的。

   落盘统一走 saveAccount()：save() 也会连带写账号，但会多做一次角色存档和
   属性快照，这里没必要。A 的所有改动都由 saveAccount 里的 validAccount 兜底校验。
   ============================================================ */
(function () {
  const NS = window.IAP, G = NS.G, F = NS.fn;
  const C = (NS.camp = { sig: '' });
  const rerender = function () { if (NS.panel) NS.panel.refresh(); };

  /* ---------- 游戏函数的安全调用 ----------
     营地相关函数都是 camp.js 的顶层 function 声明，Mod 脚本晚于它们加载，
     正常一定存在；仍然逐个 typeof，避免换版本后整页炸掉。 */
  function teams() {
    try { return typeof campTeams === 'function' ? (campTeams() || []) : []; } catch (e) { return []; }
  }
  function isDone(tm) {
    try { return typeof campIsDone === 'function' ? !!campIsDone(tm) : false; } catch (e) { return false; }
  }
  function pct(tm) {
    try { return typeof campPct === 'function' ? campPct(tm) : 0; } catch (e) { return 0; }
  }
  function leftTxt(tm) {
    try { return durTxt(Math.ceil(Math.max(0, campLeft(tm)) / 1000)); } catch (e) { return '?'; }
  }
  function who(tm) {
    try { return typeof campWho === 'function' ? campWho(tm) : (tm.slots || []).join('、'); } catch (e) { return '?'; }
  }
  function zoneName(tm) {
    try { return typeof campZone === 'function' ? campZone(tm.zone) : String(tm.zone); } catch (e) { return '?'; }
  }
  function roster() {
    try { return typeof campRoster === 'function' ? (campRoster() || []) : []; } catch (e) { return []; }
  }
  function pairs() {
    try { return typeof campPairs === 'function' ? (campPairs() || []) : []; } catch (e) { return []; }
  }
  function pairHTML(key) {
    try { return typeof campPairHTML === 'function' ? campPairHTML(key) : NS.esc(key); } catch (e) { return NS.esc(key); }
  }
  function affLv(h) {
    try { return typeof campAffLv === 'function' ? campAffLv(h) : 0; } catch (e) { return 0; }
  }
  function affLvName(i) {
    try { return (typeof CAMP_AFF_LV !== 'undefined' && CAMP_AFF_LV[i]) || ''; } catch (e) { return ''; }
  }
  function campBal() {
    try { return (typeof CAMP_BAL === 'object' && CAMP_BAL) ? CAMP_BAL : null; } catch (e) { return null; }
  }
  /* 好感满级所需的累计小时 = CAMP_BAL.affinity 的最后一档（默认 48） */
  function affMax() {
    const bal = campBal();
    if (bal && Array.isArray(bal.affinity) && bal.affinity.length) return Math.max.apply(null, bal.affinity);
    return 48;
  }

  /* 把账号档里营地相关的字段补齐（旧档没有 dispatch / affinity） */
  function acc() {
    if (typeof campAcc === 'function') { try { campAcc(); } catch (e) { } }
    const A = G.A;
    if (A && (!A.affinity || typeof A.affinity !== 'object' || Array.isArray(A.affinity))) A.affinity = {};
    if (A && !Array.isArray(A.dispatch)) A.dispatch = [];
    return A;
  }

  /* ---------- 派遣 ---------- */
  /* 让一支队伍立刻走完：elapsed 直接写 dur，start 同步往前推，
     这样 campElapsed 的 max(...) 两边都是 dur，读档后也不会回退。 */
  function finishOne(tm) {
    if (!tm) return false;
    const dur = Number(tm.dur) || 0;
    if (dur <= 0) return false;
    tm.elapsed = dur;
    tm.start = Date.now() - dur * 1000;
    return true;
  }

  function finishAll() {
    const A = acc();
    const list = teams();
    if (!list.length) { NS.toast('没有正在派遣的队伍', true); return; }
    let n = 0;
    list.forEach(function (tm) { if (finishOne(tm)) n++; });
    NS.saveAcc();
    NS.toast(n ? `${n} 支队伍已归来，去领奖励` : '没有可完成的队伍', !n);
    rerender();
  }

  function claimOne(id) {
    let r = null;
    try { r = typeof campClaim === 'function' ? campClaim(id) : null; } catch (e) { console.warn('[IAP] campClaim 失败', e); }
    return r;
  }

  const gemsOf = function (r) {
    return r && r.gems ? Object.values(r.gems).reduce(function (a, b) { return a + (Number(b) || 0); }, 0) : 0;
  };

  function claimAll() {
    const list = teams().filter(function (tm) { return isDone(tm); });
    if (!list.length) { NS.toast('没有已归来的队伍，先点「全部立即完成」', true); return; }
    let ok = 0, shards = 0, gems = 0, items = 0;
    list.forEach(function (tm) {
      const r = claimOne(tm.id);
      if (!r) return;
      ok++;
      shards += (Number(r.shards) || 0) + (Number(r.salv) || 0);
      gems += gemsOf(r);
      items += (r.items || []).length;
    });
    NS.toast(ok ? `${ok} 支队伍已领取：魂晶 +${F.fmt(shards)} · 宝石 ${gems} · 装备 ${items}` : '领取失败，奖励没有发放', !ok);
    rerender();
  }

  /* ---------- 好感 ---------- */
  function affOf(key) {
    const A = G.A;
    return (A && A.affinity && +A.affinity[key]) || 0;
  }
  function setAff(key, hours) {
    const A = acc();
    if (!A) return false;
    A.affinity[key] = Math.max(0, Math.floor(hours));
    return true;
  }

  function affFillAll() {
    const max = affMax(), list = pairs();
    if (!list.length) { NS.toast('没有可提升的角色组合', true); return; }
    list.forEach(function (key) { setAff(key, max); });
    NS.saveAcc();
    NS.toast(`${list.length} 组好感全部拉满（${max} 小时 · Lv ${affLv(max)}）`);
    rerender();
  }

  /* ---------- 页面 ---------- */
  function render() {
    const S = G.S, A = G.A;
    if (!S || !S.cls) return `<div class="iap-empty">还没有进入角色，先选一个英雄再打开调试台。</div>`;
    if (!A) return `<div class="iap-empty">账号档还没就绪（读档中），稍等再试。</div>`;
    acc();

    const list = teams();
    C.sig = list.map(function (tm) { return tm.id + (isDone(tm) ? '1' : '0'); }).join(',');

    const rows = list.map(function (tm) {
      const done = isDone(tm);
      return `<div class="iap-row">
        <div class="iap-lab"><b>${who(tm)}</b><small>${zoneName(tm)} · <i data-cleft="${tm.id}">${done ? '已归来 · 待领取' : '剩余 ' + leftTxt(tm)}</i></small></div>
        <span class="iap-cbar"><i data-cbar="${tm.id}" style="width:${pct(tm)}%"></i></span>
        ${done ? '' : `<button class="iap-btn" data-do="fin:${tm.id}" title="把剩余时间直接走完；奖励仍按原时长结算">立即完成</button>`}
        <button class="iap-btn pri" data-do="claim:${tm.id}"${done ? '' : ' disabled'} title="${done ? '领取这支队伍的奖励' : '还没走完，先点「立即完成」'}">领取</button>
      </div>`;
    }).join('');

    const nRoster = roster().length;
    const empty = list.length ? '' : (nRoster
      ? `<div class="iap-hint">当前没有在派遣的队伍。到营地里派出一支后，回到这里就能直接完成。</div>`
      : `<div class="iap-hint bad">其他存档位里还没有角色，游戏不允许派遣。先到别的存档位建一个角色。</div>`);

    const maxH = affMax();
    const affRows = pairs().map(function (key) {
      const h = affOf(key), lv = affLv(h), full = h >= maxH;
      return `<div class="iap-row">
        <div class="iap-lab"><b>${pairHTML(key)}</b><small>同行 ${h} / ${maxH} 小时 · Lv ${lv}${lv ? ' ' + NS.esc(affLvName(lv - 1)) : ''}</small></div>
        <button class="iap-btn${full ? '' : ' pri'}" data-do="affmax:${key}"${full ? ' disabled' : ''}>${full ? '已满' : '拉满'}</button>
      </div>`;
    }).join('');

    return `<div class="iap-note">营地数据在<b>账号档</b>（<code>account.json</code>），和当前角色档分开存；改完立刻写盘。</div>
      <div class="iap-sec"><div class="iap-sechd"><b>派遣</b><small>最多 3 队 · 每队 1–2 人 · 按现实时间计时</small></div>
        ${rows}${empty}
        <div class="iap-affadd">
          <button class="iap-btn pri" data-do="finall"${list.length ? '' : ' disabled'}>全部立即完成</button>
          <button class="iap-btn" data-do="claimall">一键领取</button>
        </div>
        <div class="iap-hint">「立即完成」只是把已经走过的秒数补到时长（<code>tm.elapsed = tm.dur</code>），
          奖励仍按原时长结算；两人同行照常加好感、额外奖励照常 ×1.6。</div>
      </div>
      <div class="iap-sec"><div class="iap-sechd"><b>好感</b><small>满级需要 ${maxH} 小时同行 · 共 ${pairs().length} 组</small></div>
        ${affRows || '<div class="iap-hint">没有可提升的角色组合。</div>'}
        <div class="iap-affadd">
          <button class="iap-btn pri" data-do="affall">一键全满</button>
          <span class="iap-hint">写的是累计同行小时数，等级由游戏按 ${(campBal() && campBal().affinity || []).join(' / ')} 小时分档换算。</span>
        </div>
      </div>`;
  }

  /* 每秒刷新一次剩余时间；队伍刚走完时整页重画（按钮要换成「领取」） */
  function sync(root) {
    const list = teams();
    const sig = list.map(function (tm) { return tm.id + (isDone(tm) ? '1' : '0'); }).join(',');
    if (sig !== C.sig) { C.sig = sig; rerender(); return; }
    root.querySelectorAll('[data-cleft]').forEach(function (el) {
      const tm = list.find(function (x) { return x.id === el.dataset.cleft; });
      if (!tm) return;
      el.textContent = isDone(tm) ? '已归来 · 待领取' : '剩余 ' + leftTxt(tm);
    });
    root.querySelectorAll('[data-cbar]').forEach(function (el) {
      const tm = list.find(function (x) { return x.id === el.dataset.cbar; });
      if (tm) el.style.width = pct(tm) + '%';
    });
  }

  function bind(root) {
    root.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-do]');
      if (!btn) return;
      const act = btn.dataset.do;
      const i = act.indexOf(':');
      const k = i < 0 ? act : act.slice(0, i), v = i < 0 ? '' : act.slice(i + 1);
      if (k === 'fin') {
        const tm = teams().find(function (x) { return x.id === v; });
        if (!tm || !finishOne(tm)) { NS.toast('这支队伍已经不在了', true); rerender(); return; }
        NS.saveAcc();
        NS.toast('已立即完成，可以领取了');
        rerender();
        return;
      }
      if (k === 'claim') {
        const r = claimOne(v);
        if (!r) { NS.toast('领取失败，奖励没有发放', true); rerender(); return; }
        let msg = `魂晶 +${F.fmt((Number(r.shards) || 0) + (Number(r.salv) || 0))} · 宝石 ${gemsOf(r)} · 装备 ${(r.items || []).length}`;
        if (r.aff) msg += ` · 好感 +${r.aff.to - r.aff.from}`;
        NS.toast(msg);
        rerender();
        return;
      }
      if (k === 'finall') { finishAll(); return; }
      if (k === 'claimall') { claimAll(); return; }
      if (k === 'affall') { affFillAll(); return; }
      if (k === 'affmax') {
        const max = affMax();
        if (!setAff(v, max)) { NS.toast('账号档还没就绪', true); return; }
        NS.saveAcc();
        NS.toast('好感已拉满（' + max + ' 小时 · Lv ' + affLv(max) + '）');
        rerender();
        return;
      }
    });
  }

  NS.registerTab({ key: 'camp', name: '营地', render: render, bind: bind, sync: sync });
})();
