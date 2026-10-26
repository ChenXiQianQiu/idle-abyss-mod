'use strict';
/* ============================================================
   mod_panel.js — 面板外壳
   ------------------------------------------------------------
   负责：DOM 骨架、标签切换、拖动、整体缩放（含文字）、
        键盘接管（F1 开关 / Esc 关闭 / 面板内按键不传给游戏）、
        以及一个 1 秒一次的轻量同步（只刷数字，不重建 DOM）。
   ============================================================ */
(function () {
  const NS = window.IAP;
  const P = (NS.panel = { open: false, tab: 'res', scale: 1, x: 0, y: 0 });
  let root = null, bodyEl = null, tabEl = null, scaleTxt = null;
  let paneRoot = null, curTab = null, lastS = null, lastSlot = 0;

  const PREFS = NS.prefs;
  /* 默认缩放跟着窗口大小走：1080p 上 1.0，2K / 4K 上放大到 1.5，小窗口收一点。
     用户按 ＋/－ 之后以保存的值为准。 */
  const autoScale = Math.round(Math.max(.9, Math.min(1.5, (window.innerWidth || 1280) / 1400)) * 10) / 10;
  P.scale = Math.max(.6, Math.min(2, Number(PREFS.scale) || autoScale));

  function build() {
    root = NS.el('div', 'iap');
    root.id = 'iap-panel';
    root.innerHTML = `
      <div class="iap-hd" data-drag>
        <span class="iap-title">${NS.name}</span>
        <span class="iap-ver">v${NS.version}</span>
        <span class="iap-sp"></span>
        <button class="iap-btn tiny" data-p="scale-" title="缩小界面">－</button>
        <span class="iap-sv" data-sv>100%</span>
        <button class="iap-btn tiny" data-p="scale+" title="放大界面">＋</button>
        <button class="iap-btn tiny close" data-p="close" title="关闭（F1）">×</button>
      </div>
      <div class="iap-tabs" data-tabs></div>
      <div class="iap-body" data-body></div>
      <div class="iap-ft">
        <span class="iap-tip">F1 开关面板 · 拖动标题栏移动 · 改动即时写入存档</span>
        <span class="iap-sp"></span>
        <button class="iap-btn" data-p="save">立即存档</button>
      </div>`;
    document.body.appendChild(root);
    bodyEl = root.querySelector('[data-body]');
    tabEl = root.querySelector('[data-tabs]');
    scaleTxt = root.querySelector('[data-sv]');
    applyScale();
    applyPos();

    tabEl.innerHTML = NS.tabs.map(t => `<button class="iap-tab" data-tab="${t.key}">${t.name}</button>`).join('');
    tabEl.addEventListener('click', function (e) {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      P.tab = b.dataset.tab;
      renderBody();
    });
    root.addEventListener('click', function (e) {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      const act = b.dataset.p;
      if (act === 'close') P.hide();
      else if (act === 'save') { NS.apply(false); NS.toast('已存档'); }
      else if (act === 'scale+' || act === 'scale-') {
        P.scale = Math.max(.6, Math.min(2, Math.round((P.scale + (act === 'scale+' ? .1 : -.1)) * 10) / 10));
        PREFS.scale = P.scale; NS.savePrefs(); applyScale(); applyPos();
      }
    });
    bindDrag(root.querySelector('[data-drag]'));
  }

  function applyScale() {
    if (!root) return;
    root.style.transform = `scale(${P.scale})`;
    scaleTxt.textContent = Math.round(P.scale * 100) + '%';
  }

  function applyPos() {
    if (!root) return;
    const w = 900 * P.scale, h = Math.min(640, window.innerHeight - 24) * P.scale;
    if (!P.x && !P.y) {
      P.x = Math.max(8, Math.round((window.innerWidth - w) / 2));
      P.y = Math.max(8, Math.round((window.innerHeight - h) / 2));
    }
    P.x = Math.max(-w * .5, Math.min(window.innerWidth - 60, P.x));
    P.y = Math.max(0, Math.min(window.innerHeight - 40, P.y));
    root.style.left = P.x + 'px';
    root.style.top = P.y + 'px';
  }

  function bindDrag(handle) {
    let dx = 0, dy = 0, dragging = false;
    handle.addEventListener('mousedown', function (e) {
      if (e.target.closest('button')) return;
      dragging = true;
      dx = e.clientX - P.x; dy = e.clientY - P.y;
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      P.x = e.clientX - dx; P.y = e.clientY - dy;
      applyPos();
    });
    window.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      PREFS.x = P.x; PREFS.y = P.y; NS.savePrefs();
    });
  }

  function renderBody() {
    if (!root) return;
    const tab = NS.tabs.find(t => t.key === P.tab) || NS.tabs[0];
    curTab = tab;
    tabEl.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab.key));
    let html = '';
    try { html = tab.render(); }
    catch (e) {
      html = `<div class="iap-empty bad">渲染失败：${NS.esc(e && e.message)}</div>`;
      console.warn('[IAP] render', e);
      try { reportErr('[IAP] 渲染失败(' + tab.key + '): ' + (e && (e.stack || e.message))); } catch (e2) { }
    }
    bodyEl.innerHTML = '';
    paneRoot = NS.el('div', 'iap-pane');
    paneRoot.innerHTML = html;
    bodyEl.appendChild(paneRoot);
    bodyEl.scrollTop = 0;
    if (tab.bind) { try { tab.bind(paneRoot); } catch (e) { console.warn('[IAP] bind', e); } }
    lastS = NS.G.S; lastSlot = NS.G.slot;
  }

  P.refresh = function () { if (P.open) renderBody(); };
  P.show = function () {
    if (!root) build();
    root.classList.add('on');
    P.open = true;
    renderBody();
  };
  P.hide = function () {
    if (!root) return;
    root.classList.remove('on');
    P.open = false;
  };
  P.toggle = function () { P.open ? P.hide() : P.show(); };

  /* ---------- 键盘 ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'F1') { e.preventDefault(); e.stopPropagation(); P.toggle(); return; }
    if (!P.open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); P.hide(); return; }
    /* 面板开着时，按键不能再触发游戏热键（1/2/3 切页、空格暂停等），
       否则在输入框里打数字会顺手把右边的面板切走。 */
    if (root && root.contains(e.target)) e.stopPropagation();
  }, true);

  /* ---------- 轻量同步：换角色 / 换存档位时重建，其余只刷数字 ---------- */
  setInterval(function () {
    if (!P.open) return;
    const S = NS.G.S;
    if (S !== lastS || NS.G.slot !== lastSlot) { renderBody(); return; }
    if (curTab && curTab.sync && paneRoot) { try { curTab.sync(paneRoot); } catch (e) { } }
  }, 1000);

  window.addEventListener('resize', applyPos);
})();
