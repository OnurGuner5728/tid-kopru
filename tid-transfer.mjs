import { analyzeTurkishText, normalizeTurkish } from './turkish-morphology.mjs';
import { hasTwoApprovals } from './tid-to-turkish.mjs';
export { hasTwoApprovals, isValidGlossTimeline, translateTidGlossToTurkish } from './tid-to-turkish.mjs';

const CONTENT_SCHEMA_VERSION = 1;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SAME_ORIGIN_ASSET_PATH = /^\/assets\/tid\/[A-Za-z0-9._/-]+$/u;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isSafeSameOriginPath(path, origin) {
  if (typeof path !== 'string' || !SAME_ORIGIN_ASSET_PATH.test(path)) return false;
  if (path.split('/').some((part, index) => index > 0 && ['', '.', '..'].includes(part))) return false;
  try {
    return new URL(path, origin).origin === origin;
  } catch {
    return false;
  }
}

function normalizeSentence(text) {
  return normalizeTurkish(text).trim().replace(/\s+/gu, ' ');
}

function isApprovedReview(review) {
  if (!isRecord(review) || review.status !== 'approved') return false;
  const reviewers = review.reviewerCodes;
  const approvals = review.approvals;
  if (!Array.isArray(reviewers) || reviewers.length !== 2 || !reviewers.every(isText)) return false;
  if (new Set(reviewers).size !== 2 || !Array.isArray(approvals) || approvals.length !== 2) return false;
  const approvalCodes = [];
  for (const approval of approvals) {
    if (
      !isRecord(approval)
      || !isText(approval.reviewerCode)
      || approval.decision !== 'approve'
      || approval.independent !== true
    ) return false;
    approvalCodes.push(approval.reviewerCode);
  }
  if (new Set(approvalCodes).size !== 2 || reviewers.some((code) => !approvalCodes.includes(code))) return false;
  if (review.disagreement === true) {
    return isRecord(review.adjudication)
      && isText(review.adjudication.reviewerCode)
      && !reviewers.includes(review.adjudication.reviewerCode)
      && isText(review.adjudication.resolution);
  }
  return review.disagreement === false && review.adjudication === null;
}

function hasValidGloss(entry) {
  return isRecord(entry?.translation)
    && isText(entry.translation.glossText)
    && Array.isArray(entry.translation.glosses)
    && entry.translation.glosses.length > 0
    && entry.translation.glosses.every(isText);
}

function isValidMediaAsset(asset, origin) {
  return isRecord(asset)
    && isSafeSameOriginPath(asset.path, origin)
    && isText(asset.licenseId)
    && asset.redistributionAllowed === true
    && typeof asset.sha256 === 'string'
    && SHA256_PATTERN.test(asset.sha256)
    && isInteger(asset.durationMs)
    && asset.durationMs > 0;
}

function isValidNonManualTimeline(timeline, startMs, endMs) {
  return Array.isArray(timeline)
    && timeline.length > 0
    && timeline.every((interval) => (
      isRecord(interval)
      && isInteger(interval.startMs)
      && isInteger(interval.endMs)
      && interval.startMs >= startMs
      && interval.endMs <= endMs
      && interval.endMs > interval.startMs
      && isText(interval.face)
      && isText(interval.head)
    ));
}

function resolveSegments(entry, mediaManifest, origin) {
  if (entry.playable !== true || !Array.isArray(entry.media) || entry.media.length === 0) return null;
  const glossCount = entry.translation.glosses.length;
  const segments = [];
  for (const segment of entry.media) {
    if (!isRecord(segment) || !['video', 'avatar'].includes(segment.kind)) return null;
    if (segment.kind === 'avatar' && !isText(segment.animationId)) return null;
    const asset = mediaManifest?.[segment.assetId];
    if (!isValidMediaAsset(asset, origin)) return null;
    if (
      !isInteger(segment.startMs)
      || !isInteger(segment.endMs)
      || segment.endMs <= segment.startMs
      || segment.endMs > asset.durationMs
      || !isInteger(segment.glossStart)
      || !isInteger(segment.glossEnd)
      || segment.glossEnd <= segment.glossStart
      || segment.glossEnd > glossCount
      || !isValidNonManualTimeline(segment.nonManual, segment.startMs, segment.endMs)
    ) return null;
    segments.push({
      kind: segment.kind,
      assetId: segment.assetId,
      startMs: segment.startMs,
      endMs: segment.endMs,
      glossStart: segment.glossStart,
      glossEnd: segment.glossEnd,
      nonManual: segment.nonManual.map((interval) => ({ ...interval })),
    });
  }
  return segments;
}

function unsupportedResult(text, analysis, resources, reason = 'no_approved_translation') {
  const unsupported = analysis?.unsupported?.length
    ? analysis.unsupported
    : [{ surface: text, reason }];
  return {
    status: 'unsupported',
    sourceText: text,
    analyses: analysis?.sentences ?? [],
    glossText: '',
    segments: [],
    unsupported,
    contentVersion: resources?.contentVersion ?? null,
  };
}

function findExactApprovedSentence(text, resources) {
  const normalized = normalizeSentence(text);
  const entries = Array.isArray(resources?.entries) ? resources.entries : [];
  const matches = entries.filter((entry) => (
    isRecord(entry?.source) && normalizeSentence(entry.source.text ?? '') === normalized
  ));
  return matches.length === 1 ? matches[0] : null;
}

function sameFeatures(actual, expected) {
  if (!isRecord(actual) || !isRecord(expected)) return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index] && actual[key] === expected[key]);
}

function matchApprovedTemplate(sentences, templates) {
  if (!Array.isArray(sentences) || sentences.length !== 1 || !Array.isArray(templates)) return null;
  const tokens = sentences[0]?.tokens;
  if (!Array.isArray(tokens)) return null;
  const matches = [];
  for (const template of templates) {
    if (!isRecord(template) || !isRecord(template.entry) || !Array.isArray(template.tokens)) continue;
    if (template.tokens.length !== tokens.length) continue;
    const matchesTokens = template.tokens.every((expected, index) => (
      isRecord(expected)
      && tokens[index].lemma === expected.lemma
      && tokens[index].partOfSpeech === expected.partOfSpeech
      && sameFeatures(tokens[index].features, expected.features ?? {})
    ));
    if (matchesTokens) matches.push(template.entry);
  }
  return matches.length === 1 ? matches[0] : null;
}

function resolveApprovedMedia(entry, manifest, analysis, resources, sourceText) {
  const result = {
    sourceText,
    analyses: analysis?.sentences ?? [],
    glossText: entry?.translation?.glossText ?? '',
    unsupported: [],
    contentVersion: resources?.contentVersion ?? null,
  };
  if (!isApprovedReview(entry?.review) || !isText(result.glossText) || !hasValidGloss(entry)) {
    return unsupportedResult(sourceText, analysis, resources, 'unreviewed_content');
  }

  const segments = resolveSegments(entry, manifest, resources?.origin ?? 'https://tid-kopru.invalid');
  if (segments) {
    return { ...result, status: 'ready', segments };
  }
  return { ...result, status: 'text-only', segments: [] };
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function isValidAssetPathShape(path) {
  return typeof path === 'string'
    && SAME_ORIGIN_ASSET_PATH.test(path)
    && !path.split('/').some((part, index) => index > 0 && ['', '.', '..'].includes(part));
}

async function fetchJson(path, fetcher, origin) {
  if (!isValidAssetPathShape(path) || !isSafeSameOriginPath(path, origin)) fail('unsafe_content_path');
  let response;
  try {
    response = await fetcher(new URL(path, origin).href, { credentials: 'same-origin' });
  } catch {
    fail('content_asset_unavailable');
  }
  if (!response?.ok) fail('content_asset_unavailable');
  let raw;
  try {
    raw = await response.text();
  } catch {
    fail('content_asset_unavailable');
  }
  try {
    return { raw, data: JSON.parse(raw) };
  } catch {
    fail('invalid_content_json');
  }
}

async function hashCanonicalJson(value) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder !== 'function') fail('crypto_unavailable');
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validateLoadedBundle(bundle, manifest) {
  if (
    !isRecord(bundle)
    || bundle.schemaVersion !== CONTENT_SCHEMA_VERSION
    || bundle.contentVersion !== manifest.contentVersion
    || !Array.isArray(bundle.entries)
  ) fail('invalid_reviewed_content');

  const ids = new Set();
  for (const entry of bundle.entries) {
    if (!isRecord(entry) || !isText(entry.id) || ids.has(entry.id)) fail('invalid_reviewed_content');
    ids.add(entry.id);
    if (!isApprovedReview(entry.review) || !isRecord(entry.source) || !isText(entry.source.text) || entry.source.locale !== 'tr-TR' || !hasValidGloss(entry)) {
      fail('invalid_reviewed_content');
    }
    if (!Array.isArray(entry.media) || entry.media.length === 0) fail('invalid_reviewed_content');
    if (entry.playable === true && !resolveSegments(entry, manifest.mediaAssets, 'https://tid-kopru.invalid')) {
      fail('invalid_playable_entry');
    }
  }
  return bundle.entries;
}

function validateLexicon(lexicon) {
  if (!Array.isArray(lexicon)) fail('invalid_lexicon');
  for (const entry of lexicon) {
    if (!isRecord(entry) || !isText(entry.lemma) || !isText(entry.partOfSpeech)) fail('invalid_lexicon');
  }
}

function validateTemplates(templates, entries) {
  if (!Array.isArray(templates)) fail('invalid_templates');
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const templateIds = new Set();
  return templates.map((template) => {
    if (
      !isRecord(template)
      || !isText(template.id)
      || templateIds.has(template.id)
      || !isText(template.entryId)
      || !entriesById.has(template.entryId)
      || !Array.isArray(template.tokens)
      || template.tokens.length === 0
      || !template.tokens.every((token) => isRecord(token) && isText(token.lemma) && isText(token.partOfSpeech) && isRecord(token.features ?? {}))
    ) fail('invalid_template');
    templateIds.add(template.id);
    return { ...template, entry: entriesById.get(template.entryId) };
  });
}

function validateAssetManifest(mediaAssets) {
  if (!isRecord(mediaAssets)) fail('invalid_media_manifest');
  for (const [assetId, asset] of Object.entries(mediaAssets)) {
    if (!isText(assetId) || !isRecord(asset) || !isValidAssetPathShape(asset.path) || !isText(asset.licenseId) || asset.redistributionAllowed !== true || !SHA256_PATTERN.test(asset.sha256 ?? '') || !isInteger(asset.durationMs) || asset.durationMs === 0) {
      fail('invalid_media_manifest');
    }
  }
}

function validateGlossToTurkishBundle(bundle, manifest) {
  if (!isRecord(bundle) || bundle.schemaVersion !== CONTENT_SCHEMA_VERSION
      || bundle.contentVersion !== manifest.contentVersion
      || !Array.isArray(bundle.vocabulary) || !Array.isArray(bundle.phrases) || !Array.isArray(bundle.templates)) {
    fail('invalid_gloss_to_turkish_content');
  }
  if (bundle.vocabulary.some((gloss) => !isText(gloss))
      || new Set(bundle.vocabulary).size !== bundle.vocabulary.length) fail('invalid_gloss_to_turkish_content');
  for (const phrase of [...bundle.phrases, ...bundle.templates]) {
    if (!isRecord(phrase) || !isText(phrase.id) || !Array.isArray(phrase.glosses)
        || phrase.glosses.length === 0 || !phrase.glosses.every(isText)
        || !phrase.glosses.every((gloss) => bundle.vocabulary.includes(gloss))
        || !isText(phrase.turkishText) || !hasTwoApprovals(phrase)) fail('invalid_gloss_to_turkish_content');
  }
  return bundle;
}

export async function loadTidTranslationResources({
  fetcher = globalThis.fetch?.bind(globalThis),
  origin = globalThis.location?.origin,
  manifestPath = '/assets/tid/content-manifest.json',
} = {}) {
  if (typeof fetcher !== 'function' || !isText(origin)) fail('content_loader_unavailable');
  let pageOrigin;
  try {
    pageOrigin = new URL(origin).origin;
  } catch {
    fail('content_loader_unavailable');
  }

  const { data: manifest } = await fetchJson(manifestPath, fetcher, pageOrigin);
  if (
    !isRecord(manifest)
    || manifest.schemaVersion !== CONTENT_SCHEMA_VERSION
    || !isText(manifest.contentVersion)
    || !SHA256_PATTERN.test(manifest.contentHash ?? '')
    || !isRecord(manifest.reviewedContent)
    || !isText(manifest.reviewedContent.path)
    || !SHA256_PATTERN.test(manifest.reviewedContent.sha256 ?? '')
  ) fail('invalid_content_manifest');
  if (manifest.glossToTurkish !== undefined && (!isRecord(manifest.glossToTurkish)
      || !isText(manifest.glossToTurkish.path)
      || !SHA256_PATTERN.test(manifest.glossToTurkish.sha256 ?? ''))) fail('invalid_content_manifest');
  const { contentHash, ...hashableManifest } = manifest;
  if (await hashCanonicalJson(hashableManifest) !== contentHash) fail('content_manifest_hash_mismatch');
  validateAssetManifest(manifest.mediaAssets);
  validateLexicon(manifest.lexicon);

  const { data: reviewedContent } = await fetchJson(manifest.reviewedContent.path, fetcher, pageOrigin);
  const reviewedContentHash = await hashCanonicalJson(reviewedContent);
  if (reviewedContentHash !== manifest.reviewedContent.sha256) fail('content_hash_mismatch');
  const entries = validateLoadedBundle(reviewedContent, manifest);
  const templates = validateTemplates(manifest.templates, entries);
  let glossToTurkish = null;
  let glossToTurkishHash = null;
  if (manifest.glossToTurkish) {
    const { data: bundle } = await fetchJson(manifest.glossToTurkish.path, fetcher, pageOrigin);
    glossToTurkishHash = await hashCanonicalJson(bundle);
    if (glossToTurkishHash !== manifest.glossToTurkish.sha256) fail('gloss_to_turkish_hash_mismatch');
    glossToTurkish = validateGlossToTurkishBundle(bundle, manifest);
  }

  return {
    contentVersion: manifest.contentVersion,
    contentHash,
    reviewedContentHash,
    glossToTurkishHash,
    origin: pageOrigin,
    lexicon: { entries: manifest.lexicon },
    entries,
    templates,
    mediaManifest: manifest.mediaAssets,
    glossToTurkish,
  };
}

export function translateTurkishToTid(text, resources) {
  if (typeof text !== 'string' || !text.trim()) {
    return unsupportedResult(typeof text === 'string' ? text : '', null, resources, 'empty_input');
  }

  const exactEntry = findExactApprovedSentence(text, resources);
  if (exactEntry) {
    const exactAnalysis = analyzeTurkishText(text, resources?.lexicon);
    if (!isApprovedReview(exactEntry.review)) {
      return unsupportedResult(text, exactAnalysis, resources, 'unreviewed_content');
    }
    return resolveApprovedMedia(exactEntry, resources?.mediaManifest, exactAnalysis, resources, text);
  }
  const analysis = analyzeTurkishText(text, resources?.lexicon);
  if (analysis.unsupported.length) return unsupportedResult(text, analysis, resources);

  const templateEntry = matchApprovedTemplate(analysis.sentences, resources?.templates ?? []);
  if (!templateEntry) return unsupportedResult(text, analysis, resources);
  return resolveApprovedMedia(templateEntry, resources?.mediaManifest, analysis, resources, text);
}
