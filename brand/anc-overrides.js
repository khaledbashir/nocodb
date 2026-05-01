/* ANC NocoDB white-label runtime patcher.
 *
 * NocoDB OSS minified JS contains conditional renders for EE-gated UI
 * (FREE PLAN badge, +Enterprise pills, +New Workspace upsell, NOCODB logo).
 * CSS hide-by-class is unreliable since Tailwind class names rotate.
 *
 * This script runs on every page load + watches DOM mutations and:
 *   1. Removes any element whose direct text == "Enterprise" or "+ Enterprise"
 *      or "Free Plan" or matches the upsell pill signatures.
 *   2. Replaces the NOCODB top-left wordmark <img> with the ANC logo.
 *   3. Hides the +New Workspace button at the bottom of the workspaces sidebar.
 *
 * Loaded via <script> tag injected into every nc-gui index.html by the
 * overlay Dockerfile. Idempotent (safe to call repeatedly via MutationObserver).
 */
(function () {
  'use strict';

  const KILL_TEXTS = [
    /^\s*\+?\s*enterprise\s*$/i,
    /^\s*free\s*plan\s*$/i,
    /^\s*free\s*$/i,
    /^\s*upgrade\s*$/i,
    /^\s*sign\s*up\s*for\s*free\s*$/i,
    /enterprise\s+only/i,
    /upgrade\s+to\s+enterprise/i,
  ];

  const ANC_LOGO_URL = '/anc-logo.png';

  function textMatches(el) {
    if (!el || !el.textContent) return false;
    const t = el.textContent.trim();
    if (t.length > 60) return false; // skip paragraphs, only short labels/pills
    return KILL_TEXTS.some((rx) => rx.test(t));
  }

  function killElement(el) {
    // Walk up to a "tag-sized" container before removing — the actual pill is
    // usually a <span> or <div> with a few classes, parent might be a button.
    let target = el;
    while (
      target &&
      target.parentElement &&
      target.parentElement !== document.body &&
      target.parentElement.children.length === 1 &&
      target.parentElement.textContent.trim() === el.textContent.trim()
    ) {
      target = target.parentElement;
    }
    target.remove();
  }

  function scrub(root) {
    root = root || document.body;
    if (!root || !root.querySelectorAll) return;

    // Hide elements whose direct text is in the kill list.
    const candidates = root.querySelectorAll('span, div, button, a, p, em, strong, label, .ant-tag, .nc-tag');
    for (const el of candidates) {
      // Direct text node only — don't false-positive on parents containing matching children
      const ownText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent.trim())
        .join(' ')
        .trim();
      if (ownText && KILL_TEXTS.some((rx) => rx.test(ownText))) {
        killElement(el);
      }
    }

    // Replace any <img> whose src or alt mentions nocodb with the ANC logo.
    const imgs = root.querySelectorAll('img');
    for (const img of imgs) {
      const src = (img.getAttribute('src') || '').toLowerCase();
      const alt = (img.getAttribute('alt') || '').toLowerCase();
      if (src.includes('nocodb') || src.includes('full-logo') || alt === 'nocodb') {
        if (img.src !== ANC_LOGO_URL && !img.dataset.ancReplaced) {
          img.src = ANC_LOGO_URL;
          img.dataset.ancReplaced = '1';
        }
      }
    }
  }

  function init() {
    scrub(document.body);
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              scrub(node);
            }
          }
        } else if (m.type === 'characterData') {
          // text content changed inside an existing element
          scrub(m.target.parentElement || document.body);
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
