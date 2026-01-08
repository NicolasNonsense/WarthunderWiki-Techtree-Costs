// ==UserScript==
// @name         WarthunderWiki-Techtree-Costs
// @namespace    https://wiki.warthunder.com/
// @version      1.0.0
// @description  Replaces BR with RP and SL cost; Sums up Cost per Rank and Total.
// @author       NicolasNonsense (https://github.com/NicolasNonsense)
// @updateURL    https://raw.githubusercontent.com/NicolasNonsense/WarthunderWiki-Techtree-Costs/main/TechTreeCost/WarthunderWiki-Techtree-Costs.user.js
// @downloadURL  https://raw.githubusercontent.com/NicolasNonsense/WarthunderWiki-Techtree-Costs/main/TechTreeCost/WarthunderWiki-Techtree-Costs.user.js
// @match        https://wiki.warthunder.com/ground*
// @match        https://wiki.warthunder.com/aviation*
// @match        https://wiki.warthunder.com/helicopters*
// @match        https://wiki.warthunder.com/ships*
// @match        https://wiki.warthunder.com/boats*
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.listValues
// @grant        GM.xmlHttpRequest
// @grant        GM_addStyle
// @connect      wiki.warthunder.com
// @run-at       document-idle
// ==/UserScript==  

(function () {
  'use strict';

  // ---------- Settings ----------
  const KEY_PREFIX = 'wt_cost_v1:'; // key = KEY_PREFIX + unitId, value = { rp, sl, ts }
  const REQUEST_DELAY_MS = 500; // throttle between page requests
  const SHOW_TOTAL_AT_TOP = true; // Total Sum toggle
  // ---------- Styles ----------
GM_addStyle(`
  div.wt-rp-pill {
    position: absolute;
    right: 10px;
    top: 10px;
    font-size: 11px;
    line-height: 1;
    background: rgba(0,0,0,.65);
    color: #ffd952;
    padding: 2px 6px;
    border-radius: 10px;
    z-index: 3;
    pointer-events: none;
    white-space: nowrap;
  }

  .br.wt-rp-pill {
    display: inline-block;
    background: rgba(0,0,0,.65);
    color: #ffd952;
    padding: 2px 6px;
    border-radius: 10px;
    white-space: nowrap;

    width: auto !important;
    height: auto !important;
    min-width: 0 !important;
    min-height: 0 !important;
    line-height: 1.2 !important;
    transform: none !important;
    writing-mode: horizontal-tb !important;

    z-index: auto;
  }

  .wt-tree_item { position: relative; }

  .wt-rank-sum {
    font-weight: 600;
    margin-left: .5em;
    font-size: .95em;
    color: #ffd952;
    white-space: nowrap;
  }
  .wt-total-sum {
    margin-top: .2em;
    font-size: .95em;
    color: #ffd952;
  }
  .wt-ulist-rp { font-weight: 600; }
`);

  // ---------- Utils ----------
  const delay = ms => new Promise(res => setTimeout(res, ms));
  const fmt = n => (typeof n === 'number' ? n.toLocaleString() : '');

  const getUnitIdFromItem = (el) =>
    el?.getAttribute('data-unit-id') ||
    el?.querySelector('.wt-tree_item-link')?.getAttribute('href')?.split('/').pop() || null;

  const toInt = (txt) => {
    if (!txt) return 0;
    const n = parseInt(String(txt).replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  };

  // ---------- Cache ----------
  async function cacheGet(unitId) {
    return GM.getValue(KEY_PREFIX + unitId, null);
  }
  async function cacheSet(unitId, obj) {
    return GM.setValue(KEY_PREFIX + unitId, obj);
  }

  // ---------- HTTP fetch & parse (unit page) ----------
  async function fetchUnitCosts(unitId) {
    return new Promise((resolve, reject) => {
      GM.xmlHttpRequest({
        method: 'GET',
        url: `https://wiki.warthunder.com/unit/${encodeURIComponent(unitId)}`,
        onload: (res) => {
          try {
            const doc = new DOMParser().parseFromString(res.responseText, 'text/html');
            const items = Array.from(doc.querySelectorAll('.game-unit_card-info_item'));
            let rp = 0, sl = 0;

            for (const it of items) {
              const title = it.querySelector('.game-unit_card-info_title')?.textContent?.trim();
              const valueDiv = it.querySelector('.game-unit_card-info_value div');
              const valTxt = valueDiv?.textContent || '';
              if (title === 'Research') rp = toInt(valTxt);
              if (title === 'Purchase') sl = toInt(valTxt);
            }

            const payload = { rp, sl, ts: Date.now() };
            resolve(payload);
          } catch (e) {
            reject(e);
          }
        },
        onerror: (err) => reject(err),
      });
    });
  }

  // ---------- Throttled queue ----------
  const queue = [];
  let running = false;

  function enqueueFetch(unitId, onDone) {
    queue.push({ unitId, onDone });
    runQueue();
  }

  async function runQueue() {
    if (running) return;
    running = true;
    while (queue.length) {
      const job = queue.shift();
      try {
        const costs = await fetchUnitCosts(job.unitId);
        await cacheSet(job.unitId, costs);
        job.onDone(costs);
      } catch (e) {
        console.warn('[WT] fetch failed for', job.unitId, e);
        job.onDone({ rp: 0, sl: 0, ts: Date.now() }); // fail-soft
      }
      await delay(REQUEST_DELAY_MS);
    }
    running = false;
  }

  // ---------- UI: Tree badges & sums ----------
    //TODO: Fix Positioning done
function ensurePill(itemEl) {
  let br = itemEl.querySelector('span.br');
  if (!br) {
    br = document.createElement('span');
    br.className = 'br';
    itemEl.appendChild(br);
  }

  br.classList.add('wt-rp-pill');

  br.style.width = 'auto';
  br.style.height = 'auto';
  br.style.minWidth = '0';
  br.style.minHeight = '0';
  br.style.lineHeight = '1.2';
  br.style.transform = 'none';
  br.style.writingMode = 'horizontal-tb';

  const cs = getComputedStyle(br);
  if (cs.position === 'static') br.style.position = 'absolute';
  const hasAnchor = (cs.top !== 'auto' || cs.right !== 'auto' || cs.bottom !== 'auto' || cs.left !== 'auto');
  if (!hasAnchor) { br.style.top = '10px'; br.style.right = '10px'; }

    //Lazy fix for Positioning issue
    const dx = 6, dy = 8;
    br.style.setProperty('transform', `translate(${dx}px, ${dy}px)`, 'important');


  return br;
}



  function setItemBadge(itemEl, costs) {
    const pill = ensurePill(itemEl);
    pill.textContent = `RP ${fmt(costs.rp)} | SL ${fmt(costs.sl)}`;
  }

  function collectRanks(treeRoot) {
    const result = [];
    const rows = treeRoot.querySelectorAll('.wt-tree_instance .wt-tree_row, .wt-tree_instance .wt-tree_rank, .wt-tree_instance .wt-tree_r-header');

    let current = null;
    rows.forEach(row => {
      if (row.classList.contains('wt-tree_r-header')) {
        const labelEl = row.querySelector('.wt-tree_r-header_label');
        const label = (labelEl?.textContent || '').trim().replace(/\s+/g,' ');
        current = { label, labelEl, rankRowEls: [], itemEls: [], rpSum: 0, slSum: 0 };
        result.push(current);
      } else if (row.classList.contains('wt-tree_rank') && current) {
        current.rankRowEls.push(row);
      }
    });

      for (const r of result) {
          for (const rankRow of r.rankRowEls) {
              const left = rankRow.querySelector('[style*="grid-column: 1 / 3"] .wt-tree_rank-instance') ||
                    rankRow.querySelector('td[colspan="2"] .wt-tree_rank-instance') ||
                    rankRow; // fallback
              if (!left) continue;

              const items = Array.from(left.querySelectorAll('.wt-tree_item')).filter(el => {
                  const group = el.closest('.wt-tree_group');
                  if (!group) return true;
                  const first = group.querySelector('.wt-tree_item');
                  return first === el;
              });

              r.itemEls.push(...items);
          }
      }


    return result;
  }

  function renderRankSum(r) {
    if (!r?.labelEl) return;
    let span = r.labelEl.querySelector('.wt-rank-sum');
    if (!span) {
      span = document.createElement('span');
      span.className = 'wt-rank-sum';
      r.labelEl.appendChild(span);
    }
    span.textContent = `— RP ${fmt(r.rpSum)} • SL ${fmt(r.slSum)}`;
  }

  function renderTotalSum(treeRoot, ranks) {
    if (!SHOW_TOTAL_AT_TOP) return;
    const headerRow = treeRoot.querySelector('.wt-tree_header');
    if (!headerRow) return;

    let host = headerRow.querySelector('.wt-total-sum');
    if (!host) {
      host = document.createElement('div');
      host.className = 'wt-total-sum';
      headerRow.appendChild(host);
    }
    const rp = ranks.reduce((a, r) => a + (r.rpSum || 0), 0);
    const sl = ranks.reduce((a, r) => a + (r.slSum || 0), 0);
      const rank1sum = treeRoot.querySelector('[style*="grid-column: 1 / 3"] .wt-tree_r-header_label .wt-rank-sum');
      if (rank1sum) {
          const current = (rank1sum.textContent || '').replace(/\s+/g, ' ');
          const totalText = ` — Total Cost: RP ${fmt(rp)} • SL ${fmt(sl)}`;
          rank1sum.textContent = /—\s*Total Cost:/i.test(current)
              ? current.replace(/—\s*Total Cost:.*$/, totalText)
          : (current + totalText);
}

  }

  async function processTree(treeRoot) {
    const ranks = collectRanks(treeRoot);

    const seen = new Map();

    const updateSums = () => {
      for (const r of ranks) {
        let rp = 0, sl = 0;
        for (const el of r.itemEls) {
          const id = getUnitIdFromItem(el);
          const c = id ? seen.get(id) : null;
          if (c) { rp += c.rp || 0; sl += c.sl || 0; }
        }
        r.rpSum = rp; r.slSum = sl;
        renderRankSum(r);
      }
      renderTotalSum(treeRoot, ranks);
    };

    for (const r of ranks) {
      for (const el of r.itemEls) {
        const unitId = getUnitIdFromItem(el);
        if (!unitId) continue;

        const cached = await cacheGet(unitId);
        if (cached && (typeof cached === 'object')) {
          seen.set(unitId, cached);
          setItemBadge(el, cached);
          updateSums();
          continue;
        }

        setItemBadge(el, { rp: 0, sl: 0 });
        enqueueFetch(unitId, (costs) => {
          seen.set(unitId, costs);
          setItemBadge(el, costs);
          updateSums();
        });
      }
    }

    updateSums();
  }

  // ---------- UI: List view (BR-Spalte → RP) ----------
  function processList(listRoot) {
    const tbody = listRoot.querySelector('tbody');
    if (!tbody) return;

    const applyRow = async (tr) => {
      const unitId = tr.getAttribute('data-ulist-id');
      if (!unitId) return;
      const brCell = tr.querySelector('.br');
      if (!brCell) return;

      const cached = await cacheGet(unitId);
      if (cached) {
        brCell.textContent = '';
        const span = document.createElement('span');
        span.className = 'wt-ulist-rp';
        span.textContent = `RP ${fmt(cached.rp)}`;
        brCell.appendChild(span);
      } else {
        brCell.textContent = '…';
        enqueueFetch(unitId, (costs) => {
          brCell.textContent = '';
          const span = document.createElement('span');
          span.className = 'wt-ulist-rp';
          span.textContent = `RP ${fmt(costs.rp)}`;
          brCell.appendChild(span);
        });
      }
    };

    tbody.querySelectorAll('tr.wt-ulist_unit[data-ulist-id]').forEach(applyRow);

    const mo = new MutationObserver((muts) => {
      muts.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1 && node.matches('tr.wt-ulist_unit[data-ulist-id]')) {
            applyRow(node);
          }
        });
      });
    });
    mo.observe(tbody, { childList: true });
  }

  // ---------- Bootstrapping & observers ----------
  function getVisibleTree() {
    const list = document.querySelectorAll('.unit-trees_instances .unit-tree');
    for (const el of list) {
      const st = window.getComputedStyle(el);
      if (st.display !== 'none') return el;
    }
    return null;
  }

  function boot() {
    const tree = getVisibleTree();
    const list = document.querySelector('#wt-unit-list');

    if (tree) processTree(tree);
    if (list && list.style.display !== 'none') processList(list);

  const root = document.querySelector('.unit-trees_instances') || document.body;

let rafId = 0;
let lastRun = 0;
const RUN_EVERY_MS = 300;

const schedule = () => {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    const now = Date.now();
    if (now - lastRun < RUN_EVERY_MS) { rafId = 0; return; }
    lastRun = now;
    rafId = 0;

    const t = getVisibleTree();
    if (t) processTree(t);
    const l = document.querySelector('#wt-unit-list');
    if (l && l.style.display !== 'none') processList(l);
  });
};

const mo = new MutationObserver(schedule);
mo.observe(root, { childList: true, subtree: true, attributes: false, characterData: false });

  }

  const readyInterval = setInterval(() => {
    if (document.querySelector('.unit-trees_instances')) {
      clearInterval(readyInterval);
      boot();
    }
  }, 200);
})();
