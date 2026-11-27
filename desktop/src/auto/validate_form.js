() => {
  const shown = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = el => ((el.labels && el.labels[0] && el.labels[0].innerText) ||
    el.getAttribute('aria-label') || el.placeholder || el.name || el.id || '').replace(/[*]/g, '').trim();
  const out = [];
  for (const el of document.querySelectorAll('input, select, textarea')) {
    const t = (el.type || '').toLowerCase();
    if (['hidden','submit','button','image','reset','search','file'].includes(t) || el.disabled) continue;
    if (!shown(el)) continue;
    const need = el.required || el.getAttribute('aria-required') === 'true';
    if (!need) continue;
    if (t === 'checkbox') { if (!el.checked) out.push(label(el)); }
    else if (t === 'radio') {
      const g = document.querySelectorAll('input[type=radio][name="' + el.name + '"]');
      if (![...g].some(x => x.checked)) out.push(label(el));
    } else if (!(el.value || '').trim()) out.push(label(el));
  }
  return [...new Set(out)].filter(Boolean);
}
