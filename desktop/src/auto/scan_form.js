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
    // hidden fields and honeypots are skipped; but a radio or checkbox drawn as a styled circle has its
    // real input hidden, and is shown by its label or its box
    const styled = (type === 'radio' || type === 'checkbox') &&
      ((el.labels && el.labels[0] && shown(el.labels[0])) || (el.parentElement && shown(el.parentElement)));
    if (!isFile && !styled && !shown(el)) continue;
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
  // Yes/No and other choices drawn as a row of buttons (no radio inputs behind them): any box that
  // holds two or more short buttons and no input, with a question above them.
  const NOT_CHOICE = /^(upload|submit|next|continue|back|apply|add|remove|delete|replace|cancel|save|close|autofill)/i;
  let bi = 0;
  const claimed = [];
  for (const box of root.querySelectorAll('div, fieldset, section, ul, [role=group], [role=radiogroup]')) {
    if (box.querySelector('input:not([type=hidden]), select, textarea')) continue;
    if (claimed.some(c => c.contains(box) || box.contains(c))) continue;
    const btns = [...box.querySelectorAll(':scope > button, :scope > * > button')].filter(b => (b.getAttribute('type') || 'button') !== 'submit'
      && shown(b) && (b.innerText || '').trim().length > 0 && (b.innerText || '').trim().length <= 40 && !NOT_CHOICE.test((b.innerText || '').trim()));
    if (btns.length < 2 || btns.length > 12) continue;
    const texts = btns.map(b => clean(b.innerText));
    const found = box.querySelector('label, legend, [class*=question], [class*=title]');
    const label = (found && !texts.includes(clean(found.innerText)) && found.innerText) || groupLabel(btns[0], texts);
    if (!clean(label)) continue;
    const key = 'buttons-' + (bi++);
    box.setAttribute('data-im-key', key);
    claimed.push(box);
    out.push({ ctl: 'buttons', type: 'buttons', key, selector: `[data-im-key="${key}"] button`,
      label: clean(label), required: mark(label), options: texts, multi: false, one: '' });
  }
  // A human check only counts when a person would have to do something: a visible checkbox or
  // picture puzzle. Invisible reCAPTCHA (Ashby, many others: the small badge in the corner, and a
  // hidden challenge frame) and score-only checks ask nothing of anyone, so the form goes on.
  const CHECK = /recaptcha|hcaptcha|turnstile|challenges\.cloudflare\.com|arkoselabs|funcaptcha/i;
  const onScreen = el => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width >= 30 && r.height >= 30 && r.bottom > -50 && r.top > -2000 && r.left > -2000;
  };
  const silent = el => /[?&#]size=invisible\b/i.test(el.getAttribute('src') || '')
    || el.closest('[data-size=invisible], [data-badge], .grecaptcha-badge') !== null;
  const frames = [...document.querySelectorAll('iframe')]
    .filter(f => CHECK.test(f.getAttribute('src') || '') || CHECK.test(f.getAttribute('title') || ''));
  const widgets = [...document.querySelectorAll('.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]')]
    .filter(w => !silent(w) && !w.querySelector('iframe'));
  const captcha = frames.some(f => !silent(f) && onScreen(f)) || widgets.some(w => {
    const s = getComputedStyle(w);
    return s.display !== 'none' && s.visibility !== 'hidden';
  });
  return { url: location.href, title: document.title, text: (document.body.innerText || '').slice(0, 4000),
           controls: out, captcha };
}
