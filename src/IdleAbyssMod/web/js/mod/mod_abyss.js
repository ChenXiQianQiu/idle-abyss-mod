'use strict';
/* ============================================================
   mod_abyss.js — 深渊誓约页（游戏 2.8.3 新增）
   ------------------------------------------------------------
   数据全在角色档 S.abyss（abyss.js:24 abyssNormState）：
     presets[3] 三套预设（深度 + 誓约）、pick 当前预设、auto 自动挑战、
     heart / ward / tear 三种货币、frac 小数累积、
     best 历史最佳评级、bestDepth 最深深度、runs / clears 次数、
     week { seed, best, got[] } 本周阶梯（got 记已领的评级档）。
   账号档 A.abyss 只有一个 intro（解锁剧情播过没有）。

   页面只做三件事：
     1) 展示：解锁状态、纪录、本周阶梯、三种货币
     2) 速查：24 条誓约的誓重与效果、蚀刻的阶数与失败表
     3) 微调：货币数量、本周阶梯标记、预设深度 —— 都能改，
        但都夹在游戏自己的合法范围内（深度按 step 对齐、评级上限 999999）

   「对某一件装备蚀刻 / 腐化」的操作在装备页的编辑器里（mod_etch.js），
   因为那本来就是对单件装备的操作，放在这里还得再做一个装备选择器。
   不碰战斗：深渊挑战本身还是走游戏的 abyss.js，这里只读写它的存档字段。
   ============================================================ */
(function () {
  const NS = window.IAP, G = NS.G, F = NS.fn;
  const AB = (NS.abyss = { open: '' });        // open = 展开的誓约分类（空 = 全展开）

  const CAT_NAME = { horde: '敌群', lord: '首领', field: '环境', self: '自身' };
  const CAT_COLOR = { horde: '#ff6a5a', lord: '#ffb040', field: '#b070ff', self: '#5ac8ff' };

  /* 角色档里的深渊状态；结构不对时按游戏的结构补一份 */
  function st() {
    const S = G.S;
    if (!S) return null;
    if (!S.abyss || typeof S.abyss !== 'object' || Array.isArray(S.abyss)) {
      S.abyss = (typeof abyssNewState === 'function' ? abyssNewState() : null) || {
        presets: [], pick: 0, auto: 0, heart: 0, ward: 0, tear: 0,
        frac: { heart: 0, ward: 0, tear: 0 }, best: 0, bestDepth: 0, runs: 0, clears: 0, week: null, log: [],
      };
    }
    const a = S.abyss;
    if (!a.frac || typeof a.frac !== 'object') a.frac = { heart: 0, ward: 0, tear: 0 };
    return a;
  }
  const B = function () { return G.ABYSS_BAL || {}; };
  const E = function () { return G.ABYSS_ETCH || {}; };

  /* 解锁条件：秘境纪录 ≥ 150 层，或通关过《这就是最后了》（abyss.js abyssUnlocked） */
  function unlocked() {
    try { return typeof abyssUnlocked === 'function' ? !!abyssUnlocked() : false; } catch (e) { return false; }
  }
  /* 评级 = 深度 + 誓重；奖励公式照 ABYSS_BAL 抄一份，用来告诉玩家「现在这一把能拿多少」 */
  function heartAt(rating) {
    const h = B().heart || { base: .1, per: 1 / 300 };
    return Math.max(0, (h.base || 0) + (rating - 150) * (h.per || 0));
  }

  function headHTML(a) {
    const b = B(), lock = !unlocked();
    const best = Number(a.best) || 0, bestD = Number(a.bestDepth) || 0;
    const rank = (b.ranks || []).find(function (r) { return best >= r[0]; });
    const cur = (a.presets && a.presets[a.pick]) || null;
    const rating = cur ? (Number(cur.depth) || 0) + tagWeight(cur.tags) : 0;
    return `<div class="iap-note">深渊誓约 · 角色绑定 · 一次挑战 = 一层秘境（深度 + 自选誓约）· 评级 600 拿满奖励</div>
      ${lock ? `<div class="iap-hint bad">还没解锁：秘境纪录需要 ≥ ${(b.unlock && b.unlock.rift) || 150} 层，或者通关《这就是最后了》。</div>` : ''}
      <div class="iap-sec"><div class="iap-sechd"><b>纪录</b><small>${rank ? '位阶：' + NS.esc(rank[1]) : '还没有位阶（450 起）'}</small></div>
        <div class="iap-row"><div class="iap-lab"><b>历史最佳评级</b><small>评级 = 深度 + 誓重，封顶 ${b.cap || 600}</small></div>
          <div class="iap-cur"><i>${best}</i></div></div>
        <div class="iap-row"><div class="iap-lab"><b>最深深度</b><small>起点 ${(b.depth && b.depth.min) || 150}，每档 ${(b.depth && b.depth.step) || 5} 层</small></div>
          <div class="iap-cur"><i>${bestD}</i></div></div>
        <div class="iap-row"><div class="iap-lab"><b>挑战 / 通关</b><small>通关才拿蚀心</small></div>
          <div class="iap-cur"><i>${Number(a.runs) || 0} / ${Number(a.clears) || 0}</i></div></div>
      </div>
      ${cur ? `<div class="iap-sec"><div class="iap-sechd"><b>当前预设 ${a.pick + 1}</b><small>评级 <b>${rating}</b> · 预计蚀心 +${Math.floor(heartAt(rating) * 10) / 10}</small></div>
        <div class="iap-row"><div class="iap-lab"><b>深度</b><small>${(b.depth && b.depth.min) || 150} ~ 纪录 + ${(b.depth && b.depth.over) || 10}</small></div>
          <input class="iap-in" type="text" inputmode="numeric" spellcheck="false" data-ab="depth" value="${Number(cur.depth) || 0}" aria-label="深度"></div>
        <div class="iap-hint">这一套的誓约共 <b>${Object.keys(cur.tags || {}).length}</b> 条，誓重 <b>${tagWeight(cur.tags)}</b>。
          深度和誓约的正式调整在游戏里做（副本 → 深渊誓约），这里只改深度做试算。</div>
      </div>` : ''}`;
  }

  /* 誓重 = 每条誓约按等级取 w 相加（abyss.js 的 abyssWeight 同一条规则） */
  function tagWeight(tags) {
    const list = G.ABYSS_TAGS || [];
    let n = 0;
    list.forEach(function (g) {
      const lv = tags && tags[g.id];
      if (!Number.isInteger(lv) || lv < 1 || lv > g.lv.length) return;
      n += Number(g.lv[lv - 1].w) || 0;
    });
    return n;
  }

  function weekHTML(a) {
    const w = B().week || { steps: [] };
    const wk = a.week;
    if (!wk || !Array.isArray(w.steps)) return '';
    const got = Array.isArray(wk.got) ? wk.got : [];
    const rows = w.steps.map(function (s) {
      const on = got.indexOf(s.at) >= 0;
      const parts = [];
      if (s.heart) parts.push('蚀心 ' + s.heart);
      if (s.ward) parts.push('守心符 ' + s.ward);
      if (s.tear) parts.push('深渊之泪 ' + s.tear);
      return `<div class="iap-row"><div class="iap-lab"><b>${s.at}</b><small>${parts.join(' · ')}</small></div>
        <div class="iap-cur"><i class="${on ? '' : 'dim'}">${on ? '已领' : '未领'}</i></div>
        <button class="iap-btn ghost" data-ab="weektog:${s.at}">${on ? '撤回' : '标记已领'}</button></div>`;
    }).join('');
    return `<div class="iap-sec"><div class="iap-sechd"><b>本周阶梯</b><small>誓重 ≥ ${(w.w || 30)} · 本周最高评级 <b>${Number(wk.best) || 0}</b></small></div>
      ${rows}
      <div class="iap-hint">每个档位每周只能领一次（abyss.js 的 week.got）。这里只改领取记录，不会发奖励。</div></div>`;
  }

  function currencyHTML(a) {
    const cells = [['heart', '蚀心', '蚀刻装备'], ['ward', '守心符', '誓重 ≥ 40'], ['tear', '深渊之泪', '誓重 ≥ 80 且评级 ≥ 400']];
    const rows = cells.map(function (c) {
      const v = Math.floor(Number(a[c[0]]) || 0);
      return `<div class="iap-row"><div class="iap-lab"><b>${c[1]}</b><small>${c[2]}</small></div>
        <div class="iap-cur"><i>${F.fmt(v)}</i></div>
        <input class="iap-in" type="text" inputmode="numeric" spellcheck="false" data-ab="cur:${c[0]}" value="${v}" aria-label="${c[1]}">
        <button class="iap-btn" data-ab="set:${c[0]}">设为</button></div>`;
    }).join('');
    return `<div class="iap-sec"><div class="iap-sechd"><b>货币</b><small>角色绑定 · 换角色不通用</small></div>${rows}
      <div class="iap-affadd"><button class="iap-btn" data-ab="fill">三种各补到 999</button></div></div>`;
  }

  /* 蚀刻的具体操作（必定成功 / 不掉次数 / 必定双重 / 取消腐化 / 自选铭文）
     在装备页的编辑器里，见 mod_etch.js。这里只留一张只读的规则速查表。 */

  /* 誓约速查：按分类分组，每条的等级效果都列出来，誓重标在名字后面 */
  function tagsHTML() {
    const list = G.ABYSS_TAGS || [];
    if (!list.length) return `<div class="iap-hint bad">没有读到誓约表（游戏版本低于 2.8.3？）。</div>`;
    const cats = ['horde', 'lord', 'field', 'self'];
    const secs = cats.map(function (c) {
      const arr = list.filter(function (g) { return g.cat === c; });
      if (!arr.length) return '';
      const rows = arr.map(function (g) {
        const lv = g.lv.map(function (o, i) {
          return `<div class="iap-taglv"><span class="iap-tagw">${o.w}</span>
            <span>${NS.esc(o.d || '')}</span><span class="dim">${'Ⅰ Ⅱ Ⅲ'.split(' ')[i] || i + 1}</span></div>`;
        }).join('');
        return `<div class="iap-tag"><div class="iap-tagh"><b>${NS.esc(g.n)}</b>
          <small>${g.lv.length} 级 · 誓重 ${g.lv.map(function (o) { return o.w; }).join(' / ')}</small></div>${lv}</div>`;
      }).join('');
      return `<div class="iap-sec"><div class="iap-sechd"><b style="color:${CAT_COLOR[c]}">${CAT_NAME[c]}</b><small>${arr.length} 条</small></div>${rows}</div>`;
    }).join('');
    return `<div class="iap-note">誓约速查：数字是<b>誓重</b>（等效传奇秘境层数），评级 = 深度 + 誓重。
      越贵的誓约越难，也越值钱。</div>${secs}`;
  }

  function etchHTML() {
    const e = E();
    if (!e.max) return '';
    const rate = (e.rate || []).map(function (r) { return Math.round(r * 100) + '%'; }).join(' / ');
    const cost = (e.cost || []).join(' / ');
    /* 失败表是 [['quiet', 40], …]：名称和说明照游戏的中文，概率从表里读 */
    const FAIL_N = { quiet: '沉寂', taint: '蚀变', backlash: '反噬', gift: '深渊之赐', twin: '双重腐化', rise: '深渊升格' };
    const FAIL_D = {
      quiet: '只是腐化，阶数不变。', taint: '获得一条腐化词缀，阶数不变。',
      backlash: '深渊阶 -1。', gift: '失败反而 +1 阶。',
      twin: '获得两条腐化词缀。', rise: '深渊阶 +1，并获得一条腐化词缀。',
    };
    const failRows = (Array.isArray(e.fail) ? e.fail : []).map(function (p) {
      const k = p[0];
      return `<div class="iap-taglv"><span class="iap-tagw">${NS.esc(FAIL_N[k] || k)}</span>
        <span>${NS.esc(FAIL_D[k] || '')}</span><span class="dim">${p[1]}%</span></div>`;
    }).join('');
    const caff = Object.keys(G.ABYSS_CAFF || {}).map(function (k) {
      const c = G.ABYSS_CAFF[k];
      return `<div class="iap-taglv"><span class="iap-tagw">${NS.esc(c.n)}</span><span>${NS.esc(c.d)}</span></div>`;
    }).join('');
    return `<div class="iap-sec"><div class="iap-sechd"><b>蚀刻</b><small>铁匠 → 蚀刻页签 · 每件最多 ${e.tries} 次尝试</small></div>
      <div class="iap-hint">深渊阶 0 ~ ${e.max}，每阶 ×(1 + ${Math.round((e.step || .06) * 100)}%)，
        满阶 <b>×${Math.round((1 + (e.step || .06) * e.max) * 100) / 100}</b>（乘在强化后面，不改词缀区间）。
        成功率 ${rate}，每次消耗蚀心 ${cost}。</div>
      <div class="iap-hint">失败结果：</div>${failRows}
      <div class="iap-hint">腐化后不能再强化 / 附魔 / 打孔 / 升华 / 灌注 / 蚀刻，但保留现有的一切。</div>
    </div>
    ${caff ? `<div class="iap-sec"><div class="iap-sechd"><b>腐化词缀</b><small>每件最多 1 条，深渊之泪可以 2 条</small></div>${caff}</div>` : ''}`;
  }

  function render() {
    const S = G.S;
    if (!S || !S.cls) return `<div class="iap-empty">还没有进入角色，先选一个英雄再打开调试台。</div>`;
    if (!G.ABYSS_BAL) return `<div class="iap-empty">游戏版本低于 2.8.3，没有深渊誓约。</div>`;
    const a = st();
    /* 第一次真正渲染这一页时往主进程日志写一行：正式包没有 DevTools，
       玩家报「深渊页是空的」时，看这行就知道是数据没读到还是页面没渲染。
       etch 三位是装备页那三个包装的挂载状态（mod_etch.js 负责），111 = 都挂上了。 */
    if (!AB.logged) {
      AB.logged = true;
      try {
        reportErr(`[IAP] 深渊页 ok: tags=${(G.ABYSS_TAGS || []).length} best=${Number(a.best) || 0} ` +
          `heart=${Number(a.heart) || 0} ward=${Number(a.ward) || 0} tear=${Number(a.tear) || 0} ` +
          `etch=${NS.etch && NS.etch.hookCode ? NS.etch.hookCode() : '---'}`);
      } catch (e) { }
    }
    return headHTML(a) + weekHTML(a) + currencyHTML(a) + etchHTML() + tagsHTML();
  }

  function bind(root) {
    root.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-ab]');
      if (!btn) return;
      const act = String(btn.dataset.ab), a = st();
      if (!a) return;
      if (act === 'fill') {
        ['heart', 'ward', 'tear'].forEach(function (k) { a[k] = Math.max(a[k] || 0, 999); });
        NS.apply(false); rerender();
        NS.toast('蚀心 / 守心符 / 深渊之泪 各补到 999');
        return;
      }
      if (act.indexOf('set:') === 0) {
        const k = act.slice(4);
        const box = root.querySelector(`[data-ab="cur:${k}"]`);
        const v = Math.max(0, Math.floor(NS.parseNum(box && box.value, a[k] || 0)));
        a[k] = v;
        NS.apply(false); rerender();
        return;
      }
      if (act.indexOf('weektog:') === 0) {
        const at = Number(act.slice(8));
        if (!a.week || typeof a.week !== 'object') return;
        const got = Array.isArray(a.week.got) ? a.week.got.slice() : [];
        const i = got.indexOf(at);
        if (i >= 0) got.splice(i, 1); else got.push(at);
        a.week.got = got;
        NS.apply(false); rerender();
        return;
      }
    });

    root.addEventListener('change', function (e) {
      const el = e.target;
      if (!el.dataset || !el.dataset.ab) return;
      const act = String(el.dataset.ab), a = st();
      if (!a) return;
      if (act === 'depth') {
        const cur = (a.presets && a.presets[a.pick]) || null;
        if (!cur) return;
        const b = B(), d = b.depth || { min: 150, step: 5, over: 10 };
        const cap = Math.max(Number(b.depth && b.depth.min) || 150, (Number(a.bestDepth) || 0) + (d.over || 10));
        const v = Math.floor(NS.clampNum(NS.parseNum(el.value, cur.depth), d.min || 150, cap));
        /* 和 abyssDepthClean 一样按 step 对齐，否则读档时游戏会自己抹平 */
        cur.depth = v - ((v - (d.min || 150)) % (d.step || 5));
        NS.apply(false); rerender();
        return;
      }
      if (act.indexOf('cur:') === 0) {
        const k = act.slice(4);
        a[k] = Math.max(0, Math.floor(NS.parseNum(el.value, a[k] || 0)));
        NS.apply(false); rerender();
      }
    });
  }

  const rerender = function () { if (NS.panel) NS.panel.refresh(); };

  NS.registerTab({ key: 'abyss', name: '深渊', render: render, bind: bind });
})();
