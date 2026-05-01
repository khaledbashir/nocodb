/* ANC NocoDB white-label runtime patcher.
 *
 * NocoDB OSS minified JS contains conditional renders for EE-gated UI.
 * This script:
 *   1. Removes any element/tab/setting-row whose text matches a paywall /
 *      vendor-brand kill list (Enterprise, Free Plan, NocoDB, etc.).
 *   2. Closes any modal/popover whose visible text contains "Enterprise
 *      Feature" / "Enter your license" / similar paywall prompts.
 *   3. Hides the green-pip "premium feature" sparkle SVG that NocoDB
 *      stamps onto toolbar buttons (Coloring, Scripts, etc.).
 *   4. Replaces NocoDB <img> logos with the ANC logo at runtime.
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
    /^\s*try\s+nocodb\s+cloud\s*$/i,  // bottom-left upsell button
    /^\s*nocodb\s+cloud\s*$/i,
    /^\s*get\s+started\s+for\s+free\s*$/i,
    /enterprise\s+only/i,
    /upgrade\s+to\s+enterprise/i,
    /this\s+feature\s+is\s+only\s+available/i,
    // Vendor-name strip — any element whose entire own-text is "NocoDB" or
    // "by NocoDB" or "Scripts by NocoDB". Also kills the workflow tile
    // headlines that read "Scripts by NocoDB" / "Ready to use scripts by
    // NocoDB". Kept short-anchored so we don't wipe data containing the
    // string mid-sentence.
    /^\s*nocodb\s*$/i,
    /^\s*by\s+nocodb\s*$/i,
    /^\s*scripts\s+by\s+nocodb\s*$/i,
    /ready\s+to\s+use\s+scripts\s+by\s+nocodb/i,
    /^\s*enterprise\s+feature\s*$/i,
    /^\s*enter\s+license\s*$/i,
    /^\s*enter\s+your\s+license\s+key.*/i,
  ];

  // Substring-match kill list — fires when the element's own-text CONTAINS
  // the phrase (not just equals). Used for paywall body copy that varies.
  const KILL_SUBSTRINGS = [
    /enterprise\s+license/i,
    /enter\s+your\s+license\s+key/i,
    /unlock\s+this\s+feature/i,
    /available\s+with\s+an\s+enterprise/i,
    /scripts\s+by\s+nocodb/i,
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
    if (!t || t.length > 80) return false;
    if (KILL_TEXTS.some((rx) => rx.test(t))) return true;
    // For substring matches we look at the element's full innerText too,
    // so bodies of multi-word paywall copy ("Scripts is available with an
    // Enterprise license") get caught even when split across child spans.
    const full = (el.innerText || '').trim();
    if (full && full.length < 200 && KILL_SUBSTRINGS.some((rx) => rx.test(full))) return true;
    return false;
  }

  // Find the closest modal/dialog/popover ancestor — used to nuke the whole
  // popup when any of its inner text matches a paywall string.
  const MODAL_SELECTORS = [
    '.ant-modal',
    '.ant-modal-root',
    '.ant-modal-wrap',
    '.ant-popover',
    '.ant-drawer',
    '[role="dialog"]',
    '.nc-modal',
  ];
  function findModal(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      for (const sel of MODAL_SELECTORS) {
        if (cur.matches && cur.matches(sel)) return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  // The "premium feature" sparkle is rendered as an inline SVG with this
  // exact 4-point starburst path (NocoDB stamps it onto Coloring, Scripts,
  // and other EE-gated toolbar buttons). The path is stable across builds
  // because it's hand-crafted geometry, not minifier output.
  const SPARKLE_PATH_PREFIX = 'M8 0 C8.6 5 11 7.4 16 8';

  function hidePremiumSparkles(root) {
    const svgs = root.querySelectorAll('svg');
    for (const svg of svgs) {
      if (svg.dataset.ancPremiumHidden) continue;
      const path = svg.querySelector('path');
      if (path && (path.getAttribute('d') || '').startsWith(SPARKLE_PATH_PREFIX)) {
        // Hide the SVG and any pure-wrapper parent (a <div> with only this
        // SVG inside) so the layout collapses cleanly.
        svg.style.display = 'none';
        svg.dataset.ancPremiumHidden = '1';
        const parent = svg.parentElement;
        if (parent && parent.children.length === 1 && parent.tagName === 'DIV') {
          parent.style.display = 'none';
        }
      }
    }
  }

  // Hide the Help (?) icon in the mini-sidebar. Its trigger has no stable
  // class — the only reliable signal is the NcTooltip wrapper's title
  // ("Help"). NcTooltip renders the title into the wrapper's title attr or
  // an aria-label; check both.
  function hideHelpIcon(root) {
    const candidates = root.querySelectorAll(
      '[title="Help"], [aria-label="Help"], [aria-describedby*="help" i]'
    );
    for (const el of candidates) {
      if (el.dataset.ancHelpHidden) continue;
      const wrapper = el.closest('.nc-mini-sidebar-btn-full-width') || el;
      wrapper.style.display = 'none';
      el.dataset.ancHelpHidden = '1';
    }
  }

  function scrub(root) {
    root = root || document.body;
    if (!root || !root.querySelectorAll) return;

    // 1. Text-match kill — find elements with own-text in the kill list,
    //    walk up to a sensible container, remove the container.
    const candidates = root.querySelectorAll(
      'span, div, button, a, p, em, strong, label, li, h1, h2, h3, h4, [role="tab"], .ant-tag, .nc-tag'
    );
    const removed = new Set();
    for (const el of candidates) {
      if (!el.isConnected) continue;
      if (shouldKill(el)) {
        // Paywall popups: nuke the whole modal, not just the line.
        const modal = findModal(el);
        if (modal && !removed.has(modal) && modal.isConnected) {
          removed.add(modal);
          modal.remove();
          // Also kill the page-level mask backdrop that ant-design renders
          // alongside modals — otherwise the page stays dimmed and unclickable.
          document.querySelectorAll('.ant-modal-mask, .ant-modal-wrap').forEach((m) => {
            if (m.isConnected) m.remove();
          });
          continue;
        }
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

    // 3. Hide premium-feature sparkle pips (Coloring button, Scripts tile,
    //    and other EE-gated UI that renders the green starburst SVG).
    hidePremiumSparkles(root);

    // 3b. Hide the mini-sidebar Help (?) icon — the dashboard owns help.
    hideHelpIcon(root);

    // 4. Force the document title — NocoDB sets it to "NocoDB" on every
    //    route change. Replace any "NocoDB" prefix/suffix with "ANC Operations".
    if (document.title && /nocodb/i.test(document.title)) {
      document.title = document.title.replace(/nocodb/gi, 'ANC Operations').trim();
      if (!document.title) document.title = 'ANC Operations';
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

  // Detect iframe-embed mode: ?embed=1 OR cross-origin parent frame.
  // Sets html.anc-embed so the embed-mode CSS rules in anc-overrides.css
  // hide NocoDB's chrome (mini-sidebar, top bar, home sidebar, etc.).
  function applyEmbedClass() {
    try {
      const isEmbed =
        new URLSearchParams(location.search).has('embed') ||
        (window.self !== window.top);
      if (isEmbed) document.documentElement.classList.add('anc-embed');
    } catch (e) {
      // cross-origin parent throws — strongest signal we're embedded
      document.documentElement.classList.add('anc-embed');
    }
  }
  applyEmbedClass();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
