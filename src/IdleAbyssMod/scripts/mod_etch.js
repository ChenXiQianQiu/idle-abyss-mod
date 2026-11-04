'use strict';
/* ============================================================
   mod_etch.js — 深渊蚀刻控制（装备页内的区块，游戏 2.8.3）
   ------------------------------------------------------------
   为什么放在装备页而不是单独一页：蚀刻是「针对某一件装备」的操作，
   开关（必定成功 / 不掉次数 / 必定双重腐化）和自选词缀也都是为它服务的。
   单独一页得再做一个装备选择器，等于把装备页的列表抄一遍；放在编辑器里
   选中哪件就操作哪件，跟品质、词缀、镶嵌在同一个位置。

   能力（全部靠包装游戏的顶层函数，开关关掉时原样转发）：
     · 蚀刻必定成功        abyssEtch 调用期间临时把 ABYSS_ETCH.rate[lv] 设成 1
     · 蚀刻不消耗次数      调用后把 it.abyss.n 还原成调用前的值
     · 腐化必定双重        abyssCorrupt 的结果表换成 [['twin', 1]]
     · 自定义腐化词缀      abyssRollCaff 返回自选的，不够时让原函数补随机
     · 回满蚀刻次数        it.abyss.n = 0
     · 取消腐化            cor = 0、清 caff；pre 有快照时恢复阶数与次数
     · 自定义 5 阶铭文     满阶时把待选列表的第一条换成自选（也可直接装上）
     · 立即腐化            直接 abyssCorrupt(it, [['twin',1]])，不花资源、不占次数

   三个被包装的函数都是顶层 function 声明 → 挂在 window 上，内部裸名调用，
   覆盖即生效。abyssRollInsc / abyssPool / abyssCanon 是 const 箭头函数，
   覆盖不了，只能调用，所以「自选铭文」是在 abyssEtch 返回后改 opt。
   ============================================================ */
(function () {
  const NS = window.IAPM, G = NS.G;

  const ET = (NS.etch = {
    ok: !!NS.prefs.abEtchOk,
    notries: !!NS.prefs.abEtchNoTries,
    twin: !!NS.prefs.abEtchTwin,
    caff: Array.isArray(NS.prefs.abEtchCaff) ? NS.prefs.abEtchCaff.filter(function (k) { return typeof k === 'string'; }) : [],
    insc: typeof NS.prefs.abEtchInsc === 'string' ? NS.prefs.abEtchInsc : '',
    hooked: {},
  });
  const orig = {};
  const T = function () { return G.ABYSS_ETCH || {}; };
  const maxLv = function () { return Number(T().max) || 5; };
  const tries = function () { return Number(T().tries) || 6; };
  const heartOf = function () { const S = G.S; return (S && S.abyss) || {}; };

  function savePrefs() {
    NS.prefs.abEtchOk = ET.ok;
    NS.prefs.abEtchNoTries = ET.notries;
    NS.prefs.abEtchTwin = ET.twin;
    NS.prefs.abEtchCaff = ET.caff.slice();
    NS.prefs.abEtchInsc = ET.insc;
    NS.savePrefs();
  }
  const rerender = function () { if (NS.panel) NS.panel.refresh(); };
  const toast = function (m, bad) { NS.toast(m, bad); };
  /* 改完存档字段后的三件套（和游戏内部一致）：重算属性 → 存档 → 刷新界面 */
  function persist() {
    try { if (typeof refreshStats === 'function') refreshStats(); } catch (e) { }
    try { if (typeof save === 'function') save(); } catch (e) { }
    try { if (typeof markAll === 'function') markAll(); } catch (e) { }
  }

  /* ---------- 包装游戏函数 ---------- */
  function hook() {
    /* 必定成功 + 不掉次数 + 自选铭文，都在 abyssEtch 这一层处理 */
    if (typeof abyssEtch === 'function' && !orig.etch) {
      orig.etch = abyssEtch;
      window.abyssEtch = function (it, useWard) {
        const E = G.ABYSS_ETCH;
        const before = it && it.abyss && Number.isFinite(it.abyss.n) ? it.abyss.n : null;
        const lv = it && it.abyss ? (Number(it.abyss.lv) || 0) : 0;
        let saved = null;
        if (ET.ok && E && Array.isArray(E.rate) && Number.isFinite(E.rate[lv])) { saved = E.rate[lv]; E.rate[lv] = 1; }
        let r;
        try { r = orig.etch.apply(this, arguments); }
        finally { if (saved != null) E.rate[lv] = saved; }
        if (!r || !it || !it.abyss) return r;

        let dirty = false;
        /* 不消耗次数：内部会整块重建 it.abyss，所以用调用前记下的数字 */
        if (ET.notries && before != null) { it.abyss.n = before; dirty = true; }
        /* 自选 5 阶铭文：满阶时游戏给了 3 条待选，把自选那条换到第一位（其余保留） */
        if (r.kind === 'ok' && ET.insc && it.abyss.lv >= maxLv() && Array.isArray(it.abyss.opt)) {
          try {
            const pool = typeof abyssPool === 'function' ? abyssPool(it) : [];
            if (pool.indexOf(ET.insc) >= 0 && it.abyss.opt.indexOf(ET.insc) !== 0) {
              it.abyss.opt = [ET.insc].concat(it.abyss.opt.filter(function (k) { return k !== ET.insc; }).slice(0, 2));
              dirty = true;
            }
          } catch (e) { }
        }
        if (dirty) {
          try { if (typeof abyssCanon === 'function') it.abyss = abyssCanon(it.abyss, it); } catch (e) { }
          try { save(); } catch (e) { }
        }
        return r;
      };
      ET.hooked.etch = true;
    }
    /* 必定双重腐化：换结果表，原函数的 n=2 / 加孔 / 阶数变化照走 */
    if (typeof abyssCorrupt === 'function' && !orig.corrupt) {
      orig.corrupt = abyssCorrupt;
      window.abyssCorrupt = function (it, table) {
        if (ET.twin) table = [['twin', 1]];
        return orig.corrupt.call(this, it, table);
      };
      ET.hooked.corrupt = true;
    }
    /* 自选腐化词缀：只替换「取哪几条」 */
    if (typeof abyssRollCaff === 'function' && !orig.caff) {
      orig.caff = abyssRollCaff;
      window.abyssRollCaff = function (n) {
        const want = ET.caff.filter(function (k) { return k && G.ABYSS_CAFF && G.ABYSS_CAFF[k]; });
        if (!want.length) return orig.caff.call(this, n);
        const out = want.slice(0, n);
        if (out.length < n) {
          orig.caff.call(this, n).forEach(function (k) { if (out.length < n && out.indexOf(k) < 0) out.push(k); });
        }
        return out;
      };
      ET.hooked.caff = true;
    }
  }
  hook();
  if (!ET.hooked.etch || !ET.hooked.corrupt || !ET.hooked.caff) setTimeout(hook, 1000);
  /* 给诊断日志用：'111' 表示三个包装都挂上了 */
  ET.hookCode = function () { return (ET.hooked.etch ? 1 : 0) + '' + (ET.hooked.corrupt ? 1 : 0) + '' + (ET.hooked.caff ? 1 : 0); };
  /* 启动 1.2 秒后往主进程日志写一行（正式包没有 DevTools，只能靠这行确认钩子活着） */
  setTimeout(function () {
    try { reportErr('[IAPM] 蚀刻钩子 ' + ET.hookCode() + (ET.hookCode() === '111' ? ' 全部挂上' : ' 有缺失')); } catch (e) { }
  }, 1200);

  /* ---------- 操作 ---------- */
  const etchable = function (it) { try { return typeof abyssEtchable === 'function' && abyssEtchable(it); } catch (e) { return false; } };
  const isCor = function (it) { return NS.abyssCor(it); };
  const pool = function (it) { try { return typeof abyssPool === 'function' ? abyssPool(it) : []; } catch (e) { return []; } };

  /* 回满次数：n = 0，不动阶数与腐化。没蚀刻过的装备没有「已用次数」，直接返回 false */
  function resetTries(it) {
    if (!it || !etchable(it)) return false;
    const a = NS.abyssOf(it);
    if (!a) return false;
    if (!(Number(a.n) > 0)) return false;
    it.abyss = (typeof abyssCanon === 'function' ? abyssCanon(Object.assign({}, a, { n: 0 }), it) : Object.assign({}, a, { n: 0 }));
    persist();
    return true;
  }

  /* 取消腐化：cor = 0、清 caff。游戏没有真正写入 pre（只在注释里），
     所以有 pre 就用它恢复阶数，没有就保留当前阶数 —— 腐化时掉过阶的装备
     需要自己再蚀刻回来。腐化词缀「多孔」加出来的孔保留，避免孔里的宝石丢失。 */
  function uncorrupt(it) {
    const a = NS.abyssOf(it);
    if (!a || !a.cor) return false;
    const pre = (a.pre && typeof a.pre === 'object') ? a.pre : null;
    const next = Object.assign({}, a, { cor: 0 });
    delete next.caff;
    if (pre) {
      if (Number.isInteger(pre.lv)) next.lv = Math.max(0, Math.min(maxLv(), pre.lv));
      if (Number.isInteger(pre.n)) next.n = Math.max(0, pre.n);
    }
    it.abyss = (typeof abyssCanon === 'function' ? abyssCanon(next, it) : next);
    persist();
    return true;
  }

  /* 立即腐化：走游戏的 abyssCorrupt，绑定 / 加孔 / 阶数变化都由它处理 */
  function corrupt(it) {
    if (!etchable(it)) return false;
    if (isCor(it)) return false;
    if (typeof abyssCorrupt !== 'function') return false;
    if (!it.abyss) it.abyss = (typeof abyssCanon === 'function' ? abyssCanon({ lv: 0, n: 0, cor: 0 }, it) : { lv: 0, n: 0, cor: 0 });
    abyssCorrupt(it, [['twin', 1]]);
    persist();
    return true;
  }

  /* 直接装铭文：满阶、未腐化、部位池里有这一条 */
  function setInsc(it, key) {
    const a = NS.abyssOf(it);
    if (!a || !key) return false;
    if (isCor(it)) return false;
    if ((Number(a.lv) || 0) < maxLv()) return false;
    if (pool(it).indexOf(key) < 0) return false;
    it.abyss = (typeof abyssCanon === 'function'
      ? abyssCanon(Object.assign({}, a, { insc: key, opt: null, re: null }), it)
      : Object.assign({}, a, { insc: key }));
    persist();
    return true;
  }

  /* ---------- 装备页里的区块 ---------- */
  function chip(key, on, name, note) {
    return `<div class="iap-row"><div class="iap-lab"><b>${name}</b><small>${note}</small></div>
      <button class="iap-chip${on ? ' on' : ''}" data-etch="tog:${key}">${on ? '已开启' : '已关闭'}</button></div>`;
  }
  function caffSel(idx) {
    const C = G.ABYSS_CAFF || {}, cur = ET.caff[idx] || '';
    const used = ET.caff.filter(function (k, i) { return i !== idx && k; });
    const opts = ['<option value="">（随机）</option>'].concat(Object.keys(C).map(function (k) {
      return `<option value="${k}"${k === cur ? ' selected' : ''}>${NS.esc(C[k].n)}${used.indexOf(k) >= 0 ? ' · 已选' : ''}</option>`;
    })).join('');
    return `<select class="iap-in sm" data-etch="caff:${idx}" aria-label="腐化词缀 ${idx + 1}">${opts}</select>`;
  }
  function inscSel(it) {
    const I = G.ABYSS_INSC || {}, keys = pool(it);
    if (!keys.length) return '<span class="iap-hint">这个部位没有铭文</span>';
    const opts = ['<option value="">（游戏随机 3 选 1）</option>'].concat(keys.map(function (k) {
      return `<option value="${k}"${k === ET.insc ? ' selected' : ''}>${NS.esc(I[k] ? I[k].n : k)}</option>`;
    })).join('');
    return `<select class="iap-in" data-etch="insc" aria-label="5 阶铭文">${opts}</select>`;
  }

  /* 返回装备编辑器底部的一块；不可蚀刻的装备返回空串 */
  ET.block = function (it) {
    if (!it || !etchable(it)) return '';
    const a = NS.abyssOf(it), cor = isCor(it);
    const lv = a ? (Number(a.lv) || 0) : 0, n = a ? (Number(a.n) || 0) : 0;
    const full = lv >= maxLv();
    const inscName = a && a.insc && G.ABYSS_INSC && G.ABYSS_INSC[a.insc] ? G.ABYSS_INSC[a.insc].n : '';
    const state = [
      '深渊阶 <b>' + lv + '</b> / ' + maxLv(),
      '已用 <b>' + n + '</b> / ' + tries() + ' 次',
      cor ? '<b class="bad">已腐化</b>' : '未腐化',
      inscName ? '铭文 <b>' + NS.esc(inscName) + '</b>' : '',
    ].filter(Boolean).join(' · ');
    const caffNames = (a && a.caff || []).map(function (k) { return (G.ABYSS_CAFF[k] || {}).n || k; });
    return `<div class="iap-sec"><div class="iap-sechd"><b>深渊蚀刻</b><small>${state}</small></div>
      ${cor ? `<div class="iap-hint bad">腐化后游戏里不能再强化 / 附魔 / 打孔 / 升华 / 灌注 / 蚀刻，只能换宝石。
        下面是调试台的操作，属于绕过限制。${caffNames.length ? '腐化词缀：' + NS.esc(caffNames.join('、')) : ''}</div>` : ''}
      <div class="iap-affadd">
        <button class="iap-btn" data-etch="etch">蚀刻一次</button>
        <button class="iap-btn" data-etch="reset">回满次数</button>
        <button class="iap-btn${cor ? ' ghost' : ' pri'}" data-etch="corrupt"${cor ? ' disabled' : ''}>立即腐化（双重）</button>
        <button class="iap-btn${cor ? ' pri' : ' ghost'}" data-etch="uncor"${cor ? '' : ' disabled'}>取消腐化</button>
      </div>
      <div class="iap-row"><div class="iap-lab"><b>5 阶铭文</b><small>${full ? '已满阶' : '要先蚀刻到 ' + maxLv() + ' 阶'}；选了就优先出现在待选列表</small></div>
        <div class="iap-cds">${inscSel(it)}
          <button class="iap-btn" data-etch="takeinsc"${full && !cor ? '' : ' disabled'}>直接装上</button></div></div>
      <div class="iap-row"><div class="iap-lab"><b>腐化词缀</b><small>留空 = 随机；最多 2 条，只选 1 条时另一条随机补</small></div>
        <div class="iap-cds">${caffSel(0)}${caffSel(1)}</div></div>
      ${chip('ok', ET.ok, '蚀刻必定成功', '成功率按 100% 算，只在点蚀刻的那一次生效')}
      ${chip('notries', ET.notries, '蚀刻不消耗次数', '次数用完也能继续，每件最多 ' + maxLv() + ' 阶')}
      ${chip('twin', ET.twin, '腐化必定双重', '蚀刻失败 / 深渊之泪固定出 2 条词缀')}
      <div class="iap-hint">开关是全局的，记在 localStorage，换装备 / 重启游戏都保留。</div>
    </div>`;
  };

  /* 装备页的 bind 里调一次：事件都挂在 paneRoot 上，重绘时自然重建 */
  ET.bind = function (root, getItem) {
    root.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-etch]');
      if (!btn) return;
      const act = String(btn.dataset.etch), it = getItem && getItem();
      if (!it) return;
      if (act.indexOf('tog:') === 0) {
        const k = act.slice(4);
        if (!['ok', 'notries', 'twin'].includes(k)) return;
        ET[k] = !ET[k]; savePrefs(); rerender();
        toast(({ ok: '蚀刻必定成功', notries: '蚀刻不消耗次数', twin: '腐化必定双重' })[k] + (ET[k] ? ' 已开启' : ' 已关闭'));
        return;
      }
      if (act === 'etch') {
        if (isCor(it)) { toast('已腐化，先取消腐化', true); return; }
        const a0 = NS.abyssOf(it) || {};
        const lv0 = Number(a0.lv) || 0, n0 = Number(a0.n) || 0;
        if (lv0 >= maxLv()) { toast('已经 ' + maxLv() + ' 阶了', true); return; }
        if (a0.opt && a0.opt.length) { toast('还有待选铭文没选（先去游戏里选一条）', true); return; }
        if (n0 >= tries()) { toast('次数用完了，点「回满次数」或开「不消耗次数」', true); return; }
        const cost = Number((T().cost || [])[lv0]) || 0;
        if (Number((heartOf() || {}).heart) < cost) { toast('蚀心不够：这一阶要 ' + cost, true); return; }
        if (typeof abyssEtch !== 'function') return;
        const r = abyssEtch(it, false);
        if (!r) { toast('蚀刻失败：条件不满足', true); return; }
        rerender();
        if (r.kind === 'ok') toast('蚀刻成功 → ' + NS.abyssLv(it) + ' 阶');
        else toast('腐化：' + ((NS.abyssOf(it).caff || []).map(function (k) { return (G.ABYSS_CAFF[k] || {}).n || k; }).join('、')), true);
        return;
      }
      if (act === 'reset') {
        if (resetTries(it)) { rerender(); toast('已回满蚀刻次数（' + tries() + ' 次全回来）'); }
        else toast('这件没有已用次数（' + tries() + ' 次本来就是满的）', true);
        return;
      }
      if (act === 'corrupt') {
        const a1 = NS.abyssOf(it);
        if (a1 && a1.opt && a1.opt.length) { toast('还有待选铭文没选（先去游戏里选一条），否则会一起带进腐化', true); return; }
        if (corrupt(it)) { rerender(); toast('已腐化（双重）：' + ((NS.abyssOf(it).caff || []).map(function (k) { return (G.ABYSS_CAFF[k] || {}).n || k; }).join(' + '))); }
        else toast('腐化失败：这件不能蚀刻或已经腐化', true);
        return;
      }
      if (act === 'uncor') {
        if (uncorrupt(it)) { rerender(); toast('已取消腐化，可以继续强化与蚀刻'); }
        else toast('这件没有腐化', true);
        return;
      }
      if (act === 'takeinsc') {
        const sel = root.querySelector('[data-etch="insc"]');
        const k = sel ? sel.value : '';
        if (!k) { toast('先选一条铭文', true); return; }
        if (setInsc(it, k)) { rerender(); toast('铭文已装上：' + ((G.ABYSS_INSC[k] || {}).n || k)); }
        else toast('装不上：要先满阶且未腐化', true);
        return;
      }
    });

    root.addEventListener('change', function (e) {
      const el = e.target;
      if (!el.dataset || !el.dataset.etch) return;
      const act = String(el.dataset.etch);
      if (act === 'insc') { ET.insc = el.value || ''; savePrefs(); return; }
      if (act.indexOf('caff:') === 0) {
        const i = Number(act.slice(5)) || 0;
        while (ET.caff.length <= i) ET.caff.push('');
        ET.caff[i] = el.value || '';
        savePrefs();
        return;
      }
    });
  };
})();
