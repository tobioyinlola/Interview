() => {
  const forms = [...document.querySelectorAll('form')];
  const root = forms.find(f => f.querySelector('input[type=file]')) || document.body;
  const shown = el => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const mark = t => /[*\u2731]/.test(t || '');
  const clean = t => (t || '').replace(/[*\u2731]/g, ' ').replace(/\s+/g, ' ').trim();
  const own = el => {
    let t = '';
    if (el.labels && el.labels.length) t = el.labels[0].innerText;
    const by = el.getAttribute('aria-labelledby');
    if (!t && by) t = by.split(' ').map(i => (document.getElementById(i) || {}).innerText || '').join(' ');
    if (!t) t = el.getAttribute('aria-label') || '';
    if (!t) t = el.placeholder || '';
    return t;
  };
  const groupLabel = (el, texts) => {
    const fs = el.closest('fieldset, [role=group], [role=radiogroup]');
    const lg = fs && fs.querySelector('legend');
    if (lg && lg.innerText.trim()) return lg.innerText;
    if (fs && fs.getAttribute('aria-label')) return fs.getAttribute('aria-label');
    let node = el.parentElement;
    for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
      for (const c of node.querySelectorAll('legend, label, h3, h4, [class*=label], [class*=question]')) {
        const t = (c.innerText || '').trim();
        if (t && t.length < 300 && !texts.includes(clean(t)) && !c.querySelector('input')) return t;
      }
    }
    return '';
  };
  const cssAttr = v => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const sel = (el, k) => el.id ? `[id="${cssAttr(el.id)}"]` : `${k}[name="${cssAttr(el.name)}"]`;
  const out = [], seen = new Set();
  for (const el of root.querySelectorAll('input, select, textarea')) {
    const type = (el.type || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'image', 'reset', 'search'].includes(type) || el.disabled) continue;
    if (!el.id && !el.name) continue;                       // a control we could not point at again
    const isFile = type === 'file';
    if (!isFile && !shown(el)) continue;                    // hidden fields and honeypots
    const tag = el.tagName.toLowerCase();
    if (type === 'radio' || type === 'checkbox') {
      const key = el.name || el.id;
      if (seen.has(type + key)) continue;
      seen.add(type + key);
      const group = el.name ? [...document.querySelectorAll(`input[type=${type}][name="${cssAttr(el.name)}"]`)] : [el];
      const texts = group.map(g => clean(own(g)));
      const label = groupLabel(el, texts);
      const many = group.length > 1 || type === 'radio';
      const gsel = many && el.name ? `input[type="${type}"][name="${cssAttr(el.name)}"]` : sel(el, 'input');
      out.push({ ctl: many ? 'group' : 'single', type, key, selector: gsel,
        label: clean(label || texts[0]), required: group.some(g => g.required) || mark(label),
        options: texts, multi: type === 'checkbox', one: clean(own(el)) });
      continue;
    }
    const key = el.id || el.name;
    if (seen.has(key)) continue;
    seen.add(key);
    const raw = own(el) || groupLabel(el, []);
    const combo = el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox';
    const options = tag === 'select'
      ? [...el.options].filter(o => o.value !== '' && !/^select/i.test(o.text.trim())).map(o => o.text.trim())
      : [];
    out.push({ ctl: isFile ? 'file' : tag === 'select' ? 'select' : combo ? 'combo' : 'text', type, key,
      selector: sel(el, tag), label: clean(raw), required: el.required || el.getAttribute('aria-required') === 'true' || mark(raw),
      options, multi: false, one: '' });
  }
  const captcha = !!document.querySelector(
    'iframe[src*=recaptcha], iframe[src*=hcaptcha], iframe[src*=turnstile], .g-recaptcha, .h-captcha, [data-sitekey]');
  return { url: location.href, title: document.title, text: (document.body.innerText || '').slice(0, 4000),
           controls: out, captcha };
}
