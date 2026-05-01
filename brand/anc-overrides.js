/* ANC NocoDB white-label runtime patcher.
 *
 * NocoDB OSS minified JS contains conditional renders for EE-gated UI.
 * This script:
 *   1. Removes any element/tab/setting-row whose text contains
 *      "Enterprise", "Free Plan", "Teams" (tab), "Audits" (tab), upgrade prompts.
 *   2. Removes any element next to a "+" upgrade-indicator SVG.
 *   3. Replaces NocoDB <img> logos with the ANC logo at runtime.
 *
 * Loaded via <script defer> injected into every nc-gui index.html.
 * Idempotent — safe to call repeatedly via MutationObserver.
 */
(function () {
  'use strict';

  // Text-match kill list — exact (case-insensitive) match on element's own
  // text content. Long paragraphs are skipped (>60 chars) to avoid eating
  // legitimate content.
  const KILL_TEXTS = [
    /^\s*\+?\s*enterprise\s*$/i,
    /^\s*free\s*plan\s*$/i,
    /^\s*free\s*$/i,
    /^\s*upgrade\s*$/i,
    /^\s*upgrade\s+plan\s*$/i,
    /^\s*upgrade\s+now\s*$/i,
    /^\s*sign\s*up\s*for\s*free\s*$/i,
    /^\s*teams\s*$/i,           // Teams tab — EE-gated
    /^\s*audits\s*$/i,          // Audits tab — EE-gated
    /enterprise\s+only/i,
    /upgrade\s+to\s+enterprise/i,
    /this\s+feature\s+is\s+only\s+available/i,
  ];

  const ANC_LOGO_URL = '/anc-logo.png';

  // Container selectors — when an element matches the kill list, walk up to
  // one of these container types and remove the whole container, so e.g.
  // killing a tab text removes the entire tab including its icon + badge.
  const CONTAINER_SELECTORS = [
    '[role="tab"]',
    '.ant-tabs-tab',
    '.ant-list-item',
    '.ant-form-item',
    '.nc-settings-row',
    'li',
    'tr',
    'button',
  ];

  function findContainer(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      for (const sel of CONTAINER_SELECTORS) {
        if (cur.matches && cur.matches(sel)) return cur;
      }
      cur = cur.parentElement;
    }
    return el; // fallback to the original element
  }

  function ownText(el) {
    return Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim();
  }

  function shouldKill(el) {
    const t = ownText(el);
    if (!t || t.length > 60) return false;
    return KILL_TEXTS.some((rx) => rx.test(t));
  }

  function scrub(root) {
    root = root || document.body;
    if (!root || !root.querySelectorAll) return;

    // 1. Text-match kill — find elements with own-text in the kill list,
    //    walk up to a sensible container, remove the container.
    const candidates = root.querySelectorAll(
      'span, div, button, a, p, em, strong, label, li, [role="tab"], .ant-tag, .nc-tag'
    );
    const removed = new Set();
    for (const el of candidates) {
      if (!el.isConnected) continue;
      if (shouldKill(el)) {
        const container = findContainer(el);
        if (!removed.has(container) && container.isConnected) {
          removed.add(container);
          container.remove();
        }
      }
    }

    // 2. Image swap — replace NocoDB-branded <img> with the ANC logo.
    const imgs = root.querySelectorAll('img');
    for (const img of imgs) {
      if (img.dataset.ancReplaced) continue;
      const src = (img.getAttribute('src') || '').toLowerCase();
      const alt = (img.getAttribute('alt') || '').toLowerCase();
      if (src.includes('nocodb') || src.includes('full-logo') || alt === 'nocodb') {
        img.src = ANC_LOGO_URL;
        img.dataset.ancReplaced = '1';
      }
    }
  }

  function init() {
    // Initial pass — and re-run after a tick to catch async-rendered children.
    scrub(document.body);
    setTimeout(() => scrub(document.body), 200);
    setTimeout(() => scrub(document.body), 800);
    setTimeout(() => scrub(document.body), 2000);

    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              scrub(node.parentElement || node);
            }
          }
        } else if (m.type === 'characterData' && m.target.parentElement) {
          scrub(m.target.parentElement);
        }
      }
    });
    obs.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
