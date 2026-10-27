// Controls that open a native browser popup (a <select> list, a date picker,
// a colour or file picker). While it is open the page receives no mouse moves;
// when it closes, the cursor reappears somewhere else. That "jump" belongs to
// a person and must not count as a teleport.
const POPUP_INPUTS = new Set(['date', 'datetime-local', 'month', 'week', 'time', 'color', 'file']);

export function opensNativeUi(el) {
  for (; el && el.nodeType === 1; el = el.parentElement) {
    if (el.tagName === 'SELECT') return true;
    if (el.tagName === 'INPUT' && POPUP_INPUTS.has(el.type)) return true;
  }
  return false;
}
