// Runs inside the employer's page, in an isolated JavaScript world (see driver.js).
// It only reads the form and finds controls; typing, clicking and uploading come from outside.
(() => {
  if (globalThis.__im) return;
  const shown = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  // a selector list that may use :has-text('...') (Playwright's, as the server engine's rules do)
  const parts = (sel) => sel.split(/,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean);
  const find = (sel) => {
    const out = [];
    for (const p of parts(sel)) {
      const m = p.match(/^(.*?):has-text\((['"])(.*)\2\)\s*$/);
      try {
        if (m) {
          const base = m[1] || '*', want = m[3].toLowerCase();
          for (const el of document.querySelectorAll(base)) {
            if ((el.innerText || el.value || '').toLowerCase().includes(want)) out.push(el);
          }
        } else out.push(...document.querySelectorAll(p));
      } catch (e) { /* a selector this page cannot take */ }
    }
    return [...new Set(out)];
  };
  globalThis.__im = {
    count: (sel) => find(sel).length,
    visible: (sel) => { const a = find(sel); return a.length > 0 && shown(a[a.length - 1]); },
    // scroll a control into view and say where its centre is (for a real click)
    locate: (sel, which, text) => {
      let a = find(sel);
      if (text) { const re = new RegExp('^\\s*' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$'); a = a.filter((e) => re.test(e.innerText || '')); }
      const el = which === 'last' ? a[a.length - 1] : a[which === 'first' || which == null ? 0 : which];
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, tag: el.tagName.toLowerCase(), type: (el.type || '') };
    },
    jsClick: (sel, which) => { const a = find(sel); const el = a[which || 0]; if (!el) return false; el.click(); return true; },
    focus: (sel) => { const el = find(sel)[0]; if (!el) return false; el.focus(); if (el.select) el.select(); return true; },
    clear: (sel) => { const el = find(sel)[0]; if (!el) return false; el.focus(); if (el.select) el.select();
      if ('value' in el && el.value) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } return true; },
    value: (sel) => { const el = find(sel)[0]; return el ? String(el.value || '') : null; },
    setDate: (sel, v) => { const el = find(sel)[0]; if (!el) return false; el.focus();
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; },
    select: (sel, label) => { const el = find(sel)[0]; if (!el || el.tagName !== 'SELECT') return false;
      const o = [...el.options].find((x) => x.text.trim() === label); if (!o) return false;
      el.value = o.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; },
    checked: (sel, i) => { const a = find(sel); const el = a[i || 0]; return el ? !!el.checked : null; },
    state: () => ({ url: location.href, text: (document.body.innerText || '').slice(0, 3000),
      bad: document.querySelectorAll('[aria-invalid=true]').length, len: (document.body.innerText || '').length }),
    optionTexts: (sel) => find(sel).map((e) => (e.innerText || '').trim()).filter(Boolean),
    html: () => document.documentElement.outerHTML.slice(0, 200000),
  };
})()
