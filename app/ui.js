// ui.js — small helpers for building screens. Text is always set with textContent, never as
// page code, so stored merchant names and notes can't run as script (04 §7, IT-014).
// No inline style attributes (the page's security policy blocks them): widths use <progress>.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'value' && 'value' in node) {
      node.value = String(value);
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function button(label, onClick, cls = '') {
  return el('button', { type: 'button', class: cls || null, onclick: onClick }, label);
}

// Shared states (03 §4)
export function loading(text = 'Loading…') {
  return el('div', { class: 'state loading', role: 'status' },
    el('div', { class: 'placeholder' }), el('div', { class: 'placeholder short' }), el('p', {}, text));
}

export function errorState(text, onRetry) {
  return el('div', { class: 'state error', role: 'alert' },
    el('p', { class: 'notice error' }, text), onRetry ? button('Try again', onRetry) : null);
}

export function emptyState(text, actionLabel, onAction) {
  return el('div', { class: 'state empty' },
    el('p', {}, text), actionLabel ? button(actionLabel, onAction, 'primary inline') : null);
}

// Progress bar with its number in text (never colour alone, REQ-030).
export function bar(percentValue, label) {
  const v = Math.max(0, Math.min(100, Number(percentValue) || 0));
  return el('progress', { max: '100', value: String(v), 'aria-label': label || `${v.toFixed(1)}%` });
}

export function toast(text, ms = 3000) {
  document.querySelectorAll('.toast').forEach((x) => x.remove()); // one message at a time
  const t = el('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
  return t;
}

// A modal question; resolves with the chosen button label (or null when dismissed).
export function ask(text, buttons, { detail } = {}) {
  return new Promise((resolve) => {
    const d = el('dialog', { class: 'dialog', 'aria-label': text });
    const done = (v) => { d.close(); d.remove(); resolve(v); };
    d.append(
      el('p', { class: 'dialog-text' }, text),
      detail ? el('p', { class: 'muted' }, detail) : null,
      el('div', { class: 'dialog-buttons' },
        buttons.map((b, i) => button(b, () => done(b), i === 0 ? 'primary' : ''))),
    );
    d.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    document.body.append(d);
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  });
}

// A bottom sheet (phone) / centred sheet (iPad) holding a form; returns a close function.
export function sheet(title, content, { onClose } = {}) {
  const d = el('dialog', { class: 'sheet', 'aria-label': title });
  const close = () => { d.close(); d.remove(); onClose?.(); };
  d.append(el('div', { class: 'sheet-head' }, el('h2', {}, title), button('Close', close, 'link')), content);
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(d);
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  return close;
}

// Undo window (SYS-047): visible for exactly `ms` from the delete; clock injectable for UT-055.
export function undoWindow(deletedAtMs, ms = 10000) {
  return { visible: (nowMs) => nowMs - deletedAtMs < ms };
}

let undoBar = null;
export function showUndo(text, onUndo, ms = 10000) {
  undoBar?.remove();
  const barEl = el('div', { class: 'undo-bar', role: 'status' }, el('span', {}, text));
  const timer = setTimeout(() => barEl.remove(), ms);
  barEl.append(button('Undo', async () => { clearTimeout(timer); barEl.remove(); await onUndo(); }, 'link'));
  document.body.append(barEl);
  undoBar = barEl;
}

// Labelled form field with an inline error line under it (SYS-046 errors).
export function field(label, input, { help, id } = {}) {
  const fid = id || `f-${Math.random().toString(36).slice(2, 8)}`;
  input.id = fid;
  const err = el('p', { class: 'field-error', id: `${fid}-err`, 'aria-live': 'polite' });
  input.setAttribute('aria-describedby', `${fid}-err`);
  const wrap = el('div', { class: 'field' }, el('label', { for: fid }, label), input,
    help ? el('p', { class: 'help' }, help) : null, err);
  wrap.setError = (msg) => { err.textContent = msg || ''; wrap.classList.toggle('has-error', !!msg); };
  return wrap;
}

export function select(options, value, attrs = {}) {
  return el('select', attrs, options.map(([v, label]) =>
    el('option', { value: v ?? '', selected: String(v ?? '') === String(value ?? '') }, label)));
}

export function segmented(options, value, onChange, label) {
  const group = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
  const draw = (current) => {
    group.replaceChildren(...options.map(([v, text]) => el('button', {
      type: 'button', role: 'radio', 'aria-checked': String(v === current), class: v === current ? 'on' : null,
      onclick: () => { draw(v); onChange(v); },
    }, text)));
  };
  draw(value);
  return group;
}
