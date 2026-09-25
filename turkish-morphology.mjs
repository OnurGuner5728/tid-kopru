import morphologyRules from './assets/tid/morphology-rules.json' with { type: 'json' };

const WORD_PATTERN = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;
const TURKISH_VOWELS = new Set(Array.from('aeıioöuü'));

export function normalizeTurkish(text) {
  return String(text).normalize('NFC').toLocaleLowerCase('tr-TR').normalize('NFC');
}

export function tokenizeTurkish(text, rules = morphologyRules) {
  if (typeof text !== 'string' || !text.length) return [];
  const boundaries = new Set(rules?.sentenceTerminators ?? ['.', '!', '?', '…']);
  const tokens = [];
  let previousEnd = 0;
  let sentenceIndex = 0;

  for (const match of text.matchAll(WORD_PATTERN)) {
    const start = match.index;
    const surface = match[0];
    const between = text.slice(previousEnd, start);
    if (tokens.length && Array.from(between).some((character) => boundaries.has(character))) {
      sentenceIndex += 1;
    }
    tokens.push({
      surface,
      normalized: normalizeTurkish(surface),
      start,
      end: start + surface.length,
      sentenceIndex,
    });
    previousEnd = start + surface.length;
  }
  return tokens;
}

function entriesFromLexicon(lexicon) {
  let entries;
  if (Array.isArray(lexicon)) {
    entries = lexicon;
  } else if (Array.isArray(lexicon?.entries)) {
    entries = lexicon.entries;
  } else if (lexicon && typeof lexicon === 'object') {
    entries = Object.entries(lexicon).map(([lemma, entry]) => ({ lemma, ...entry }));
  } else {
    entries = [];
  }

  return entries.filter((entry) => (
    entry
    && typeof entry.lemma === 'string'
    && typeof entry.partOfSpeech === 'string'
  )).map((entry) => ({
    lemma: normalizeTurkish(entry.lemma),
    partOfSpeech: entry.partOfSpeech,
  }));
}

function partOfSpeechMatches(pattern, partOfSpeech) {
  const allowed = pattern.partOfSpeech;
  return Array.isArray(allowed) && (allowed.includes('*') || allowed.includes(partOfSpeech));
}

function stemEndingMatches(stem, requirement) {
  if (!requirement) return true;
  const lastCharacter = Array.from(stem).at(-1);
  const endsInVowel = TURKISH_VOWELS.has(lastCharacter);
  return requirement === 'vowel' ? endsInVowel : requirement === 'consonant' && !endsInVowel;
}

function vowelHarmonyMatches(stem, suffix, rules) {
  const suffixVowel = Array.from(suffix).find((character) => TURKISH_VOWELS.has(character));
  if (!suffixVowel) return true;
  const stemVowel = Array.from(stem).reverse().find((character) => TURKISH_VOWELS.has(character));
  const allowedVowels = rules?.vowelHarmony?.[suffixVowel];
  return !Array.isArray(allowedVowels) || allowedVowels.includes(stemVowel);
}

function addUniqueAnalysis(analyses, seen, analysis) {
  const key = JSON.stringify([analysis.lemma, analysis.partOfSpeech, analysis.features]);
  if (seen.has(key)) return;
  seen.add(key);
  analyses.push(analysis);
}

function findAnalyses(normalized, entries, rules) {
  const analyses = [];
  const seen = new Set();

  for (const entry of entries) {
    if (entry.lemma === normalized) {
      addUniqueAnalysis(analyses, seen, {
        lemma: entry.lemma,
        partOfSpeech: entry.partOfSpeech,
        features: {},
      });
    }
  }

  const questionFeatures = rules?.questionForms?.[normalized];
  if (questionFeatures) {
    addUniqueAnalysis(analyses, seen, {
      lemma: 'mi',
      partOfSpeech: 'question_particle',
      features: { ...questionFeatures },
    });
  }

  for (const entry of entries) {
    for (const pattern of rules?.suffixPatterns ?? []) {
      if (!partOfSpeechMatches(pattern, entry.partOfSpeech)) continue;
      if (!stemEndingMatches(entry.lemma, pattern.stemEnding)) continue;
      for (const rawSuffix of pattern.suffixes ?? []) {
        const suffix = normalizeTurkish(rawSuffix);
        if (normalized.length <= entry.lemma.length || !normalized.endsWith(suffix)) continue;
        if (normalized.slice(0, -suffix.length) !== entry.lemma) continue;
        if (!vowelHarmonyMatches(entry.lemma, suffix, rules)) continue;
        addUniqueAnalysis(analyses, seen, {
          lemma: entry.lemma,
          partOfSpeech: entry.partOfSpeech,
          features: { ...pattern.features },
        });
      }
    }
  }
  return analyses;
}

export function resolveBoundedAnalyses(tokens, lexicon, rules = morphologyRules) {
  const entries = entriesFromLexicon(lexicon);
  const resolvedTokens = [];
  const unsupported = [];

  for (const token of Array.isArray(tokens) ? tokens : []) {
    const normalized = token.normalized ?? normalizeTurkish(token.surface ?? '');
    const analyses = findAnalyses(normalized, entries, rules);
    const base = {
      surface: token.surface,
      start: token.start,
      end: token.end,
      sentenceIndex: token.sentenceIndex,
    };

    if (analyses.length === 1) {
      resolvedTokens.push({ ...base, ...analyses[0] });
      continue;
    }

    const reason = analyses.length > 1
      ? 'ambiguous_analysis'
      : entries.some((entry) => normalized.length > entry.lemma.length && normalized.startsWith(entry.lemma))
        ? 'unsupported_inflection'
        : 'unknown_lexeme';
    const unresolved = {
      ...base,
      lemma: null,
      partOfSpeech: null,
      features: {},
      reason,
      ...(analyses.length > 1 ? { analyses } : {}),
    };
    resolvedTokens.push(unresolved);
    unsupported.push({
      surface: token.surface,
      start: token.start,
      end: token.end,
      reason,
      ...(analyses.length > 1 ? { analyses } : {}),
    });
  }

  return { tokens: resolvedTokens, unsupported };
}

export function analyzeTurkishText(text, lexicon) {
  const tokens = tokenizeTurkish(text);
  const bySentence = new Map();
  for (const token of tokens) {
    if (!bySentence.has(token.sentenceIndex)) bySentence.set(token.sentenceIndex, []);
    bySentence.get(token.sentenceIndex).push(token);
  }

  const sentences = [];
  const unsupported = [];
  for (const [index, sentenceTokens] of bySentence) {
    const result = resolveBoundedAnalyses(sentenceTokens, lexicon, morphologyRules);
    sentences.push({ index, tokens: result.tokens });
    unsupported.push(...result.unsupported);
  }
  return { sentences, unsupported };
}
