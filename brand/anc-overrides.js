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

  // Container types we'll walk up to when killing a paywalled feature —
  // hide the WHOLE button / menu item / tile / panel, not just the badge.
  // Order matters: we stop at the first match, so list narrowest first.
  const PAYWALL_KILL_CONTAINERS = [
    '.ant-dropdown-menu-item',
    '[role="menuitem"]',
    '.nc-menu-item',
    '.nc-create-new-tile',
    '[data-testid^="mini-sidebar-view-create-"]',
    '[data-testid^="mini-sidebar--"]',
    '.nc-toolbar-btn',
    '.ant-tabs-tab',
    'button',
    'li',
  ];

  function findPaywallContainer(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      for (const sel of PAYWALL_KILL_CONTAINERS) {
        if (cur.matches && cur.matches(sel)) return cur;
      }
      cur = cur.parentElement;
    }
    return el;
  }

  function hidePremiumSparkles(root) {
    const svgs = root.querySelectorAll('svg');
    for (const svg of svgs) {
      if (svg.dataset.ancPremiumHidden) continue;
      const path = svg.querySelector('path');
      if (!(path && (path.getAttribute('d') || '').startsWith(SPARKLE_PATH_PREFIX))) continue;

      svg.dataset.ancPremiumHidden = '1';

      // Walk up to find the menu item / button / tile that this badge is
      // marking as paywalled, and hide the whole thing. Falls back to
      // hiding just the SVG + its wrapper if no recognizable container is
      // found (e.g. the bare Coloring toolbar pip — we want to hide the
      // pip but keep the Coloring button visible).
      const container = findPaywallContainer(svg);
      const isMenuItemOrTile =
        container !== svg &&
        (container.matches('.ant-dropdown-menu-item, [role="menuitem"], .nc-menu-item, .nc-create-new-tile, li') ||
         (container.getAttribute && (container.getAttribute('data-testid') || '').includes('create')));
      if (isMenuItemOrTile) {
        container.style.display = 'none';
      } else {
        // Pip-only hide (e.g. on the Coloring toolbar button — the button
        // itself stays usable, just the upsell sparkle is gone).
        svg.style.display = 'none';
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

  // ===========================================================================
  // ANC AI ↔ NocoDB iframe bridge.
  //
  // The services-dashboard parent (services.ancsports.net) hosts the AI
  // assistant + ai-ui-driver. Browser security blocks the parent from
  // reaching into ops.ancsports.net DOM directly, so the parent posts
  // `{ type: 'anc:ai-ui', action: <UiAction> }` to this iframe via
  // window.postMessage. We receive, mirror the action inside the iframe DOM
  // (with an animated cursor + ring-flash for visibility), and post back
  // `{ type: 'anc:ai-ui-result', ok, error?, value? }`.
  //
  // Action shapes match the parent's UiAction union — kept in sync by hand.
  // Trusted origin: only services.ancsports.net / services.anc.com may
  // dispatch actions. Everything else is dropped.
  // ===========================================================================

  const TRUSTED_ORIGINS = new Set([
    'https://services.ancsports.net',
    'https://services.anc.com',
    // local dev hosts — comment out for prod-only if needed
    'http://localhost:3000',
    'http://localhost:3001',
  ]);

  // Floating cursor + ring-flash, mirrors the parent ai-cursor styling.
  const cursorEl = document.createElement('div');
  cursorEl.className = 'anc-ai-cursor';
  cursorEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cursorEl);

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .anc-ai-cursor {
      position: fixed; top: -100px; left: -100px;
      width: 22px; height: 22px; border-radius: 50%;
      background: rgba(10, 82, 239, 0.75);
      border: 2px solid #fff;
      box-shadow: 0 0 0 4px rgba(10, 82, 239, 0.2), 0 4px 14px rgba(10, 82, 239, 0.35);
      pointer-events: none; z-index: 2147483647; opacity: 0;
      transform: translate(-50%, -50%);
      transition: left 320ms cubic-bezier(0.4, 0, 0.2, 1),
                  top 320ms cubic-bezier(0.4, 0, 0.2, 1),
                  opacity 200ms ease-out;
    }
    .anc-ai-cursor.click {
      animation: anc-ai-cursor-pulse 420ms ease-out;
    }
    @keyframes anc-ai-cursor-pulse {
      0%   { box-shadow: 0 0 0 4px rgba(10, 82, 239, 0.2), 0 4px 14px rgba(10, 82, 239, 0.35); }
      50%  { box-shadow: 0 0 0 18px rgba(10, 82, 239, 0), 0 4px 14px rgba(10, 82, 239, 0.35); }
      100% { box-shadow: 0 0 0 4px rgba(10, 82, 239, 0.2), 0 4px 14px rgba(10, 82, 239, 0.35); }
    }
    .anc-ai-ring-flash {
      position: fixed; border: 2px solid #0A52EF; border-radius: 12px;
      pointer-events: none; z-index: 2147483646;
      animation: anc-ai-ring-pulse 1.8s ease-out forwards;
    }
    @keyframes anc-ai-ring-pulse {
      0%   { box-shadow: 0 0 0 0 rgba(10, 82, 239, 0.55); opacity: 1; }
      60%  { box-shadow: 0 0 0 14px rgba(10, 82, 239, 0); opacity: 0.85; }
      100% { opacity: 0; transform: scale(1.04); }
    }
    .anc-ai-ring-label {
      position: absolute; top: -26px; left: 50%; transform: translateX(-50%);
      background: #0A52EF; color: #fff; font-size: 11px; font-weight: 600;
      padding: 3px 8px; border-radius: 6px; white-space: nowrap;
    }
  `;
  document.head.appendChild(styleEl);

  function moveCursor(el) {
    return new Promise((resolve) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      cursorEl.style.opacity = '1';
      cursorEl.style.left = x + 'px';
      cursorEl.style.top = y + 'px';
      setTimeout(resolve, 340);
    });
  }
  function flashCursor() {
    cursorEl.classList.add('click');
    setTimeout(() => cursorEl.classList.remove('click'), 420);
  }
  function ringFlash(el, label) {
    const r = el.getBoundingClientRect();
    const ring = document.createElement('div');
    ring.className = 'anc-ai-ring-flash';
    ring.style.left = (r.left - 6) + 'px';
    ring.style.top = (r.top - 6) + 'px';
    ring.style.width = (r.width + 12) + 'px';
    ring.style.height = (r.height + 12) + 'px';
    if (label) {
      const lab = document.createElement('div');
      lab.className = 'anc-ai-ring-label';
      lab.textContent = label;
      ring.appendChild(lab);
    }
    document.body.appendChild(ring);
    setTimeout(() => ring.remove(), 1900);
  }

  // Resolve element by CSS selector, [data-ai-target=...], visible text on
  // a button/link/menu-item, or a NocoDB column header by title.
  function findElement(selector) {
    if (!selector) return null;
    try {
      const direct = document.querySelector(selector);
      if (direct) return direct;
    } catch (e) {}
    // [data-ai-target=…] convenience
    try {
      const aiTarget = document.querySelector(`[data-ai-target="${CSS.escape(selector)}"]`);
      if (aiTarget) return aiTarget;
    } catch (e) {}
    const lower = selector.trim().toLowerCase();
    // Visible text on interactive elements
    const els = document.querySelectorAll(
      'button, a, [role="button"], [role="menuitem"], .ant-dropdown-menu-item, .nc-menu-item, label, [data-testid]'
    );
    for (const el of els) {
      const t = (el.innerText || el.textContent || '').trim().toLowerCase();
      if (t === lower) return el;
    }
    for (const el of els) {
      const t = (el.innerText || el.textContent || '').trim().toLowerCase();
      if (t && t.includes(lower)) return el;
    }
    return null;
  }

  // Native input setter — bypasses React/Vue's controlled-input shadowing
  // so the framework actually sees the new value.
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    const protoSetter = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'value')?.set;
    if (setter && setter !== protoSetter) {
      setter.call(el, value);
    } else if (protoSetter) {
      protoSetter.call(el, value);
    } else {
      el.value = value;
    }
  }
  async function typeIntoField(el, value) {
    el.focus();
    setNativeValue(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    setNativeValue(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
  }

  async function handleAction(action) {
    if (!action || !action.type) throw new Error('missing action.type');
    switch (action.type) {
      case 'navigate': {
        if (typeof action.path !== 'string') throw new Error('navigate.path required');
        // NocoDB uses hash routing in OSS — preserve the leading "/"
        const path = action.path.startsWith('#') ? action.path : '#' + (action.path.startsWith('/') ? action.path : '/' + action.path);
        location.hash = path;
        return { value: location.hash };
      }
      case 'click': {
        const el = findElement(action.selector);
        if (!el) throw new Error('click target not found: ' + action.selector);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise((r) => setTimeout(r, 150));
        await moveCursor(el);
        flashCursor();
        el.click();
        return { value: 'clicked' };
      }
      case 'fill': {
        const el = findElement(action.selector);
        if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
          throw new Error('fill target is not an input/textarea: ' + action.selector);
        }
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise((r) => setTimeout(r, 150));
        await moveCursor(el);
        flashCursor();
        await typeIntoField(el, action.value ?? '');
        return { value: el.value };
      }
      case 'highlight': {
        const el = findElement(action.selector);
        if (!el) throw new Error('highlight target not found: ' + action.selector);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise((r) => setTimeout(r, 200));
        ringFlash(el, action.label);
        return { value: 'highlighted' };
      }
      case 'wait': {
        await new Promise((r) => setTimeout(r, Math.max(0, Number(action.ms) || 0)));
        return { value: 'waited' };
      }
      default:
        throw new Error('unknown action type: ' + action.type);
    }
  }

  window.addEventListener('message', async (ev) => {
    if (!ev.data || typeof ev.data !== 'object') return;
    if (ev.data.type !== 'anc:ai-ui') return;
    if (!TRUSTED_ORIGINS.has(ev.origin)) {
      console.warn('[anc-bridge] dropped message from untrusted origin:', ev.origin);
      return;
    }
    const requestId = ev.data.requestId;
    try {
      const result = await handleAction(ev.data.action);
      ev.source?.postMessage({ type: 'anc:ai-ui-result', requestId, ok: true, ...result }, ev.origin);
    } catch (err) {
      ev.source?.postMessage({
        type: 'anc:ai-ui-result',
        requestId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }, ev.origin);
    }
  });

  // Heartbeat — lets the parent know the bridge is loaded and ready.
  // Parent listens for 'anc:ai-ui-ready' before it sends actions, otherwise
  // an action firing before this script boots silently dies.
  function announce() {
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({ type: 'anc:ai-ui-ready', url: location.href }, '*');
      } catch (e) {}
    }
  }
  announce();
  // Re-announce on hash changes (NocoDB SPA route changes) so the parent
  // knows the iframe is still alive after navigation.
  window.addEventListener('hashchange', announce);

  // ===========================================================================
  // "Download as PDF" — inject into NocoDB's per-document Download submenu.
  //
  // NocoDB OSS only ships markdown export. Rendering the same doc to PDF is
  // an obvious user expectation — Joe / Alexis / Nick send PDFs to clients,
  // not markdown. The PDF is generated by anc-services via the in-cluster
  // Browserless container; this script's only job is to add the menu entry
  // and trigger the download when clicked.
  //
  // Strategy: NocoDB's "Download as" submenu opens as an ant-design dropdown
  // overlay. When the overlay appears in the DOM (mutation observer), if it
  // contains "Download as Markdown" entries we know it's the right menu and
  // we append our own "Download as PDF" item. Idempotent — checked via a
  // dataset flag so we don't double-inject.
  //
  // The current docId is read from the URL hash (NocoDB SPA routes the
  // doc ID into the hash). The base id we read from the same hash.
  // ===========================================================================

  function currentDocContext() {
    // NocoDB hash route shape (OSS):
    //   #/<workspaceId>/<baseId>/<docId>?...
    // baseId starts with 'p', docId with 'doc'.
    const hash = (location.hash || '').replace(/^#\/?/, '');
    const parts = hash.split('?')[0].split('/').filter(Boolean);
    let baseId = '';
    let docId = '';
    for (const p of parts) {
      if (p.startsWith('p') && !baseId) baseId = p;
      if (p.startsWith('doc') && !docId) docId = p;
    }
    return { baseId, docId };
  }

  function buildPdfUrl(baseId, docId) {
    // services-dashboard hosts the PDF route; same parent both URLs share
    // the .ancsports.net suffix so this works in any embed configuration.
    return `https://services.ancsports.net/api/ops/document/${encodeURIComponent(docId)}/pdf?baseId=${encodeURIComponent(baseId)}`;
  }

  function injectPdfMenuItem(overlay) {
    if (!overlay || overlay.dataset.ancPdfInjected) return;
    // Detect: this is a "Download as" submenu when at least one item text
    // matches the markdown / csv / etc. labels.
    const items = overlay.querySelectorAll('.ant-dropdown-menu-item, [role="menuitem"]');
    if (items.length === 0) return;
    let isDownloadMenu = false;
    for (const it of items) {
      const t = (it.innerText || '').trim().toLowerCase();
      if (/download.*markdown|download.*as markdown|markdown$|\.md$/i.test(t)) {
        isDownloadMenu = true;
        break;
      }
    }
    if (!isDownloadMenu) return;

    overlay.dataset.ancPdfInjected = '1';

    // Clone an existing menu item for visual consistency, swap text + handler.
    const template = items[0];
    const ourItem = template.cloneNode(true);
    // Replace the visible text — find the deepest text-only descendant and
    // overwrite. Safer than messing with the SVG icon next to it.
    const setText = (node, text) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent.trim()) { node.textContent = text; return true; }
        return false;
      }
      for (const child of node.childNodes) {
        if (setText(child, text)) return true;
      }
      return false;
    };
    if (!setText(ourItem, 'Download as PDF')) {
      // Fallback: append a span if no text node found.
      const span = document.createElement('span');
      span.textContent = 'Download as PDF';
      ourItem.appendChild(span);
    }

    ourItem.setAttribute('data-anc-pdf-item', '1');
    ourItem.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const ctx = currentDocContext();
      if (!ctx.baseId || !ctx.docId) {
        alert('Could not determine the current document — open the doc and try again.');
        return;
      }
      // Hide the menu by simulating click outside.
      document.body.click();
      // Trigger download.
      const url = buildPdfUrl(ctx.baseId, ctx.docId);
      const a = document.createElement('a');
      a.href = url;
      a.download = '';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

    // Insert immediately after the markdown item (or at the end).
    let insertAfter = null;
    for (const it of items) {
      const t = (it.innerText || '').trim().toLowerCase();
      if (/markdown/.test(t)) { insertAfter = it; break; }
    }
    if (insertAfter && insertAfter.parentNode) {
      insertAfter.parentNode.insertBefore(ourItem, insertAfter.nextSibling);
    } else {
      template.parentNode?.appendChild(ourItem);
    }
  }

  // Watch for ant-dropdown overlays appearing anywhere in the DOM.
  const overlayObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node;
        // The overlay may BE the dropdown, or contain it.
        if (el.matches?.('.ant-dropdown, .ant-dropdown-menu')) injectPdfMenuItem(el);
        el.querySelectorAll?.('.ant-dropdown, .ant-dropdown-menu').forEach(injectPdfMenuItem);
      }
    }
  });
  overlayObserver.observe(document.body, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
