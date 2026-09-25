const CONTROL_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const LETTER_OR_NUMBER = /^[\p{L}\p{N}]$/u;
const APOSTROPHE = /^[\u0027\u2019]$/u;

export function splitTurkishGraphemes(text) {
  const normalized = String(text ?? '').normalize('NFC');
  const graphemes = typeof Intl?.Segmenter === 'function'
    ? [...new Intl.Segmenter('tr', { granularity: 'grapheme' }).segment(normalized)].map(({ segment }) => segment)
    : Array.from(normalized);
  return graphemes.filter((grapheme) => grapheme.trim() && !CONTROL_CHARACTER.test(grapheme));
}

export function createLetterCardSegments(token) {
  return splitTurkishGraphemes(token).map((grapheme) => {
    if (LETTER_OR_NUMBER.test(grapheme) || APOSTROPHE.test(grapheme)) {
      return { kind: 'letter-card', label: grapheme.toLocaleUpperCase('tr-TR'), source: 'fallback' };
    }
    return { kind: 'unsupported', label: `Desteklenmeyen simge: ${grapheme}`, source: 'fallback' };
  });
}

export function renderLetterCards(container, segments) {
  const document = container?.ownerDocument ?? globalThis.document;
  if (!container?.replaceChildren || !document?.createElement) throw new TypeError('letter_card_container_required');
  const nodes = segments.map((segment) => {
    const card = document.createElement('span');
    card.className = 'letter-card';
    card.dataset.kind = segment.kind;
    card.textContent = segment.label;
    return card;
  });
  container.replaceChildren(...nodes);
  return nodes.length;
}
