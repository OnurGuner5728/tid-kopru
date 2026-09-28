import { createLetterCardSegments } from './letter-cards.mjs';
import { analyzeTurkishText, normalizeTurkish } from './turkish-morphology.mjs';
import { translateTurkishToTid } from './tid-transfer.mjs';

const CORE_LEXICON = [
  ['anne', 'noun'], ['ben', 'pronoun'], ['değil', 'adjective'], ['git', 'verb'],
  ['iyi', 'adjective'], ['kahve', 'noun'], ['okul', 'noun'], ['sen', 'pronoun'],
  ['telefon', 'noun'], ['yarın', 'adverb'],
].map(([lemma, partOfSpeech]) => ({ lemma, partOfSpeech }));

const POSE_ALIASES = new Map([
  ['telefon', 'CEP TELEFONU'],
]);

function foldTurkish(value) {
  return normalizeTurkish(value)
    .replaceAll('ç', 'c').replaceAll('ğ', 'g').replaceAll('ı', 'i')
    .replaceAll('ö', 'o').replaceAll('ş', 's').replaceAll('ü', 'u')
    .toUpperCase();
}

function inferPartOfSpeech(lemma) {
  if (['ben', 'sen', 'kendi', 'ne', 'hangi'].includes(lemma)) return 'pronoun';
  if (['iyi', 'kötü', 'akıllı', 'aptal', 'büyük', 'küçük', 'boş', 'zengin'].includes(lemma)) return 'adjective';
  if (lemma.endsWith('mak') || lemma.endsWith('mek')) return 'verb';
  return 'noun';
}

function resourcesLexicon(resources, poseNames) {
  const entries = Array.isArray(resources?.lexicon) ? resources.lexicon : resources?.lexicon?.entries ?? [];
  const merged = new Map();
  for (const entry of [...CORE_LEXICON, ...entries]) {
    if (entry?.lemma && entry?.partOfSpeech) merged.set(`${normalizeTurkish(entry.lemma)}:${entry.partOfSpeech}`, entry);
  }
  for (const poseName of poseNames) {
    if (poseName.includes(' ')) continue;
    const lemma = normalizeTurkish(poseName);
    const normalizedLemma = lemma
      .replaceAll('c', poseName.includes('C') ? 'c' : 'c');
    const partOfSpeech = inferPartOfSpeech(normalizedLemma);
    merged.set(`${normalizedLemma}:${partOfSpeech}`, { lemma: normalizedLemma, partOfSpeech });
  }
  return { entries: [...merged.values()] };
}

function poseMapFor(poseNames) {
  const map = new Map();
  for (const poseName of poseNames) map.set(foldTurkish(poseName), poseName);
  return map;
}

function resolvePose(lemma, poseMap) {
  const alias = POSE_ALIASES.get(normalizeTurkish(lemma));
  return alias && poseMap.has(foldTurkish(alias)) ? poseMap.get(foldTurkish(alias)) : poseMap.get(foldTurkish(lemma));
}

function visibleFallbackSegments(text, token) {
  return createLetterCardSegments(text).map((segment) => ({ ...segment, token }));
}

function summarizeFeatures(tokens) {
  const summary = { tokenFeatures: [] };
  for (const token of tokens) {
    const features = token.features ?? {};
    if (Object.keys(features).length) summary.tokenFeatures.push({ surface: token.surface, lemma: token.lemma, ...features });
    for (const [name, value] of Object.entries(features)) {
      if (summary[name] === undefined || (name === 'predicatePerson' && features.question === true)) summary[name] = value;
    }
  }
  return summary;
}

function addGapSegments(segments, gap, warnings) {
  for (const symbol of Array.from(gap).filter((character) => character.trim())) {
    if (/[.,;:]/u.test(symbol)) continue;
    segments.push({ kind: 'unsupported', label: `Desteklenmeyen simge: ${symbol}`, symbol, source: 'fallback' });
    warnings.push(`“${symbol}” simgesi için işaret veya harf kartı yok.`);
  }
}

export function createTidDisplayPlan(text, resources = {}, {
  translateReviewed = translateTurkishToTid,
} = {}) {
  const sourceText = typeof text === 'string' ? text : '';
  const reviewed = translateReviewed(sourceText, resources);
  if (reviewed?.status === 'ready' && Array.isArray(reviewed.segments) && reviewed.segments.length) {
    return {
      status: 'ready', sourceText, sourceClass: 'reviewed-tid',
      featureSummary: summarizeFeatures(reviewed.analyses?.flatMap((sentence) => sentence.tokens ?? []) ?? []),
      glossText: reviewed.glossText,
      segments: reviewed.segments.map((mediaSegment) => ({ kind: 'reviewed-media', mediaSegment })),
      warnings: [], unsupported: [], playable: true,
    };
  }

  const poseNames = Array.isArray(resources?.poseNames)
    ? resources.poseNames
    : Object.keys(resources?.poses ?? {});
  const poseMap = poseMapFor(poseNames);
  const analysis = analyzeTurkishText(sourceText, resourcesLexicon(resources, poseNames));
  const tokens = analysis.sentences.flatMap((sentence) => sentence.tokens ?? []).sort((a, b) => a.start - b.start);
  const segments = [];
  const warnings = [];
  let cursor = 0;

  for (const token of tokens) {
    addGapSegments(segments, sourceText.slice(cursor, token.start), warnings);
    const candidateAnalyses = token.lemma ? [token] : token.analyses ?? [];
    const commonLemma = candidateAnalyses.length
      && candidateAnalyses.every((candidate) => candidate.lemma === candidateAnalyses[0].lemma)
      ? candidateAnalyses[0].lemma
      : null;
    const poseName = commonLemma ? resolvePose(commonLemma, poseMap) : null;
    if (poseName) {
      segments.push({
        kind: 'dictionary-pose', label: poseName, token: token.surface,
        lemma: commonLemma, features: token.features ?? candidateAnalyses[0]?.features ?? {}, source: 'dictionary',
      });
    } else {
      segments.push(...visibleFallbackSegments(token.surface, token.surface));
      warnings.push(`“${token.surface}” sözlük hareketi yerine harf kartlarıyla gösterilecek.`);
    }
    cursor = token.end;
  }
  addGapSegments(segments, sourceText.slice(cursor), warnings);

  const hasFallback = segments.some((segment) => ['letter-card', 'unsupported'].includes(segment.kind));
  const hasDictionary = segments.some((segment) => segment.kind === 'dictionary-pose');
  const sourceClass = hasFallback || !hasDictionary ? 'fallback-cards' : 'dictionary-sequence';
  const playable = segments.length > 0;
  return {
    status: playable ? 'ready' : 'unsupported',
    sourceText,
    sourceClass,
    featureSummary: summarizeFeatures(tokens.map((token) => {
      if (token.lemma) return token;
      const candidates = token.analyses ?? [];
      return candidates.length ? { ...token, lemma: candidates[0].lemma, features: Object.assign({}, ...candidates.map((candidate) => candidate.features)) } : token;
    })),
    glossText: segments.filter((segment) => segment.kind === 'dictionary-pose').map((segment) => segment.label).join(' '),
    segments,
    warnings,
    unsupported: analysis.unsupported,
    playable,
  };
}

export function tidSourceLabel(sourceClass) {
  return sourceClass === 'reviewed-tid'
    ? 'Onaylı TİD'
    : sourceClass === 'dictionary-sequence'
      ? 'Sözlük dizimi'
      : 'Harf kartları';
}
