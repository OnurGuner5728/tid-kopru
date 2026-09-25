const TURKISH_ASCII = new Map([
  ['Ç', 'C'], ['Ğ', 'G'], ['İ', 'I'], ['Ö', 'O'], ['Ş', 'S'], ['Ü', 'U'], ['I', 'I']
]);

export function normalizeWord(value) {
  return value
    .trim()
    .toLocaleUpperCase('tr-TR')
    .replace(/[ÇĞİÖŞÜI]/g, (letter) => TURKISH_ASCII.get(letter))
    .replace(/[^A-Z0-9]/g, '');
}

export function tokenize(text) {
  return text
    .trim()
    .split(/\s+/u)
    .map((token) => ({ source: token, normalized: normalizeWord(token) }))
    .filter((token) => token.normalized);
}

export function createDictionaryIndex(dictionary) {
  const index = new Map();
  for (const key of Object.keys(dictionary)) {
    const normalized = normalizeWord(key);
    if (!index.has(normalized)) index.set(normalized, key);
  }
  return index;
}

export function matchText(text, dictionary) {
  const index = createDictionaryIndex(dictionary);
  const matched = [];
  const missing = [];
  const tokens = tokenize(text);

  for (const token of tokens) {
    const dictionaryKey = index.get(token.normalized);
    if (dictionaryKey) {
      matched.push({ ...token, dictionaryKey });
    } else {
      missing.push(token);
    }
  }

  return { matched, missing, tokens };
}
