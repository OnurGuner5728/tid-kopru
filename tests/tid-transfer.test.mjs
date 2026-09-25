import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadTidTranslationResources, translateTidGlossToTurkish, translateTurkishToTid } from '../public/tid-transfer.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const reviewerCodes = ['synthetic-reviewer-a', 'synthetic-reviewer-b'];

const lexicon = {
  entries: [
    { lemma: 'sen', partOfSpeech: 'pronoun' },
    { lemma: 'iyi', partOfSpeech: 'adjective' },
    { lemma: 'ev', partOfSpeech: 'noun' },
    { lemma: 'gel', partOfSpeech: 'verb' },
  ],
};

function makeEntry({ id, sourceText, glossText = 'IYI SEN', glosses = ['IYI', 'SEN'], textOnly = false, status = 'approved', playable = !textOnly }) {
  const media = textOnly
    ? [{ kind: 'text_only', glossRef: `${id}-gloss` }]
    : [{
        kind: 'video',
        assetId: `${id}-clip`,
        startMs: 100,
        endMs: 900,
        glossStart: 0,
        glossEnd: glosses.length,
        nonManual: [{ startMs: 100, endMs: 900, face: 'neutral', head: 'neutral' }],
      }];
  const approvals = status === 'approved'
    ? reviewerCodes.map((reviewerCode) => ({ reviewerCode, decision: 'approve', independent: true }))
    : [];
  const entry = {
    id,
    source: { text: sourceText, locale: 'tr-TR' },
    translation: { glossText, glosses },
    review: {
      status,
      reviewerCodes: status === 'approved' ? [...reviewerCodes] : [],
      approvals,
      disagreement: false,
      adjudication: null,
    },
    media,
    scope: ['test-only'],
    playable,
  };
  const mediaManifest = textOnly ? {} : {
    [`${id}-clip`]: {
      path: `/assets/tid/${id}-clip.mp4`,
      sha256: 'a'.repeat(64),
      licenseId: 'TEST-ONLY',
      redistributionAllowed: true,
      durationMs: 1000,
    },
  };
  return { entry, mediaManifest };
}

function resourcesFor(entries, templates = []) {
  const mediaManifest = Object.assign({}, ...entries.map(({ mediaManifest: assets }) => assets));
  const contentEntries = entries.map(({ entry }) => entry);
  const resolvedTemplates = templates.map((template) => ({
    ...template,
    entry: contentEntries.find((entry) => entry.id === template.entryId),
  }));
  return {
    contentVersion: 'test-content-v1',
    lexicon,
    entries: contentEntries,
    templates: resolvedTemplates,
    mediaManifest,
  };
}

function makeTemplate(entryId, tokenSpecifications) {
  return { id: `template-${entryId}`, entryId, tokens: tokenSpecifications };
}

test('an exact approved sentence returns its licensed timed segments', () => {
  const entry = makeEntry({ id: 'approved-sen-iyi', sourceText: 'Sen iyisin' });
  const result = translateTurkishToTid('Sen iyisin', resourcesFor([entry]));

  assert.equal(result.status, 'ready');
  assert.equal(result.sourceClass, 'reviewed-tid');
  assert.equal(result.sourceText, 'Sen iyisin');
  assert.deepEqual(result.segments.map(({ assetId }) => assetId), ['approved-sen-iyi-clip']);
  assert.deepEqual(result.segments[0], {
    kind: 'video',
    assetId: 'approved-sen-iyi-clip',
    startMs: 100,
    endMs: 900,
    glossStart: 0,
    glossEnd: 2,
    nonManual: [{ startMs: 100, endMs: 900, face: 'neutral', head: 'neutral' }],
  });
});

test('a reviewed predicate template matches the second person form sen iyisin', () => {
  const entry = makeEntry({ id: 'predicate-2sg', sourceText: 'TEST TEMPLATE: second person predicate' });
  const templates = [makeTemplate(entry.entry.id, [
    { lemma: 'sen', partOfSpeech: 'pronoun', features: {} },
    { lemma: 'iyi', partOfSpeech: 'adjective', features: { predicatePerson: '2sg' } },
  ])];
  const result = translateTurkishToTid('Sen iyisin', resourcesFor([entry], templates));

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.analyses[0].tokens[1].features, { predicatePerson: '2sg' });
  assert.equal(result.glossText, 'IYI SEN');
});

test('a reviewed possessive template transfers the first person feature', () => {
  const entry = makeEntry({
    id: 'possessive-1sg',
    sourceText: 'TEST TEMPLATE: first person possession',
    glossText: 'EV BENİM',
    glosses: ['EV', 'BENIM'],
  });
  const templates = [makeTemplate(entry.entry.id, [
    { lemma: 'ev', partOfSpeech: 'noun', features: { possessivePerson: '1sg' } },
  ])];
  const result = translateTurkishToTid('evim', resourcesFor([entry], templates));

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.analyses[0].tokens[0].features, { possessivePerson: '1sg' });
  assert.equal(result.glossText, 'EV BENİM');
});

test('gloss order comes from the reviewed TİD expression instead of Turkish token order', () => {
  const entry = makeEntry({
    id: 'reordered-sentence',
    sourceText: 'Sen iyisin',
    glossText: 'IYI SEN',
    glosses: ['IYI', 'SEN'],
  });
  const result = translateTurkishToTid('sen iyisin', resourcesFor([entry]));

  assert.equal(result.status, 'ready');
  assert.equal(result.glossText, 'IYI SEN');
});

test('an unreviewed corpus candidate can never produce a sign sequence', () => {
  const candidate = makeEntry({ id: 'candidate', sourceText: 'Sen iyisin', status: 'candidate', playable: true });
  const result = translateTurkishToTid('Sen iyisin', resourcesFor([candidate]));

  assert.equal(result.status, 'unsupported');
  assert.deepEqual(result.segments, []);
  assert.ok(result.unsupported.some(({ reason }) => reason === 'unreviewed_content'));
});

test('an approval without the required adjudication field fails closed', () => {
  const entry = makeEntry({ id: 'missing-adjudication', sourceText: 'Sen iyisin' });
  delete entry.entry.review.adjudication;
  const result = translateTurkishToTid('Sen iyisin', resourcesFor([entry]));

  assert.equal(result.status, 'unsupported');
  assert.deepEqual(result.segments, []);
});

test('an approved written gloss without valid media is text-only', () => {
  const entry = makeEntry({ id: 'text-only', sourceText: 'Sen iyisin', textOnly: true });
  const result = translateTurkishToTid('Sen iyisin', resourcesFor([entry]));

  assert.equal(result.status, 'text-only');
  assert.equal(result.glossText, 'IYI SEN');
  assert.deepEqual(result.segments, []);
});

test('ambiguous morphology is rejected without choosing or playing a reading', () => {
  const result = translateTurkishToTid('evin', resourcesFor([]));

  assert.equal(result.status, 'unsupported');
  assert.ok(result.unsupported.some(({ reason }) => reason === 'ambiguous_analysis'));
  assert.deepEqual(result.segments, []);
});

test('an unsupported token rejects a mixed sentence instead of playing a partial translation', () => {
  const entry = makeEntry({ id: 'template-only', sourceText: 'TEST TEMPLATE: second person predicate' });
  const templates = [makeTemplate(entry.entry.id, [
    { lemma: 'sen', partOfSpeech: 'pronoun', features: {} },
    { lemma: 'iyi', partOfSpeech: 'adjective', features: { predicatePerson: '2sg' } },
  ])];
  const result = translateTurkishToTid('Sen iyisin. bilinmeyen sözcük', resourcesFor([entry], templates));

  assert.equal(result.status, 'unsupported');
  assert.ok(result.unsupported.some(({ reason }) => reason === 'unknown_lexeme'));
  assert.deepEqual(result.segments, []);
});

test('an invalid media path falls back to the approved gloss without animation', () => {
  const entry = makeEntry({ id: 'bad-path', sourceText: 'Sen iyisin' });
  entry.mediaManifest[`${entry.entry.id}-clip`].path = 'https://outside.example/clip.mp4';
  const result = translateTurkishToTid('Sen iyisin', resourcesFor([entry]));

  assert.equal(result.status, 'text-only');
  assert.deepEqual(result.segments, []);
});

test('a predicate template with the wrong person feature does not match', () => {
  const entry = makeEntry({ id: 'predicate-1sg', sourceText: 'TEST TEMPLATE: first person predicate' });
  const templates = [makeTemplate(entry.entry.id, [
    { lemma: 'sen', partOfSpeech: 'pronoun', features: {} },
    { lemma: 'iyi', partOfSpeech: 'adjective', features: { predicatePerson: '1sg' } },
  ])];
  const result = translateTurkishToTid('Sen iyisin', resourcesFor([entry], templates));

  assert.equal(result.status, 'unsupported');
  assert.deepEqual(result.segments, []);
});

test('multiple matching templates are rejected instead of selecting the first', () => {
  const first = makeEntry({ id: 'first-template', sourceText: 'TEST TEMPLATE ONE' });
  const second = makeEntry({ id: 'second-template', sourceText: 'TEST TEMPLATE TWO' });
  const pattern = [
    { lemma: 'sen', partOfSpeech: 'pronoun', features: {} },
    { lemma: 'iyi', partOfSpeech: 'adjective', features: { predicatePerson: '2sg' } },
  ];
  const result = translateTurkishToTid('Sen iyisin', resourcesFor([
    first,
    second,
  ], [makeTemplate(first.entry.id, pattern), makeTemplate(second.entry.id, pattern)]));

  assert.equal(result.status, 'unsupported');
  assert.deepEqual(result.segments, []);
});

test('malformed direct resources fail closed instead of throwing', () => {
  const result = translateTurkishToTid('Sen iyisin', {
    contentVersion: 'malformed-v1',
    lexicon,
    entries: { unexpected: true },
    templates: [],
    mediaManifest: {},
  });

  assert.equal(result.status, 'unsupported');
  assert.deepEqual(result.segments, []);
});

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function withContentHash(manifest) {
  return { ...manifest, contentHash: await sha256(JSON.stringify(manifest)) };
}

function response(text) {
  return { ok: true, text: async () => text };
}

test('the packaged manifest loads only same-origin versioned reviewed content', async () => {
  const manifestText = await readFile(join(repositoryRoot, 'public/assets/tid/content-manifest.json'), 'utf8');
  const reviewedText = await readFile(join(repositoryRoot, 'public/assets/tid/reviewed-content.json'), 'utf8');
  const reverseText = await readFile(join(repositoryRoot, 'public/assets/tid/gloss-to-turkish.json'), 'utf8');
  const files = new Map([
    ['/assets/tid/content-manifest.json', manifestText],
    ['/assets/tid/reviewed-content.json', reviewedText],
    ['/assets/tid/gloss-to-turkish.json', reverseText],
  ]);
  const fetcher = async (url) => {
    const path = new URL(url).pathname;
    return files.has(path) ? response(files.get(path)) : { ok: false, text: async () => '' };
  };
  const resources = await loadTidTranslationResources({ fetcher, origin: 'https://tid.example' });

  assert.equal(resources.contentVersion, 'pilot-content-0');
  assert.deepEqual(resources.entries, []);
  assert.deepEqual(resources.templates, []);
  assert.deepEqual(resources.mediaManifest, {});
  assert.deepEqual(resources.glossToTurkish.vocabulary, []);
  assert.equal(translateTidGlossToTurkish([{ glossId: 'HELLO', startFrame: 0, endFrame: 1, confidence: 0.9 }], resources.glossToTurkish).status, 'unsupported');
});

test('the content loader resolves every asset inside a project-site base path', async () => {
  const baseUrl = 'https://tid.example/tid-kopru/';
  const manifestText = await readFile(join(repositoryRoot, 'public/assets/tid/content-manifest.json'), 'utf8');
  const reviewedText = await readFile(join(repositoryRoot, 'public/assets/tid/reviewed-content.json'), 'utf8');
  const reverseText = await readFile(join(repositoryRoot, 'public/assets/tid/gloss-to-turkish.json'), 'utf8');
  const expected = new Map([
    ['/tid-kopru/assets/tid/content-manifest.json', manifestText],
    ['/tid-kopru/assets/tid/reviewed-content.json', reviewedText],
    ['/tid-kopru/assets/tid/gloss-to-turkish.json', reverseText],
  ]);
  const requested = [];
  const fetcher = async (url) => {
    const path = new URL(url).pathname;
    requested.push(path);
    return expected.has(path) ? response(expected.get(path)) : { ok: false, text: async () => '' };
  };

  const resources = await loadTidTranslationResources({
    fetcher,
    origin: 'https://tid.example',
    publicBaseUrl: baseUrl,
  });

  assert.deepEqual(requested, [...expected.keys()]);
  assert.equal(resources.publicBaseUrl, baseUrl);
});

test('the content loader rejects a gloss-to-Turkish hash mismatch', async () => {
  const reviewedContent = { schemaVersion: 1, contentVersion: 'test-content-v1', entries: [] };
  const reverseContent = { schemaVersion: 1, contentVersion: 'test-content-v1', vocabulary: [], phrases: [], templates: [] };
  const manifest = await withContentHash({
    schemaVersion: 1,
    contentVersion: 'test-content-v1',
    reviewedContent: { path: '/assets/tid/reviewed-content.json', sha256: await sha256(JSON.stringify(reviewedContent)) },
    glossToTurkish: { path: '/assets/tid/gloss-to-turkish.json', sha256: '0'.repeat(64) },
    lexicon: [], templates: [], mediaAssets: {},
  });
  const fetcher = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith('content-manifest.json')) return response(JSON.stringify(manifest));
    if (path.endsWith('reviewed-content.json')) return response(JSON.stringify(reviewedContent));
    return response(JSON.stringify(reverseContent));
  };
  await assert.rejects(
    loadTidTranslationResources({ fetcher, origin: 'https://tid.example' }),
    (error) => error.code === 'gloss_to_turkish_hash_mismatch',
  );
});

test('the content loader rejects a mismatched reviewed content hash', async () => {
  const reviewedText = JSON.stringify({ schemaVersion: 1, contentVersion: 'test-content-v1', entries: [] });
  const manifest = await withContentHash({
    schemaVersion: 1,
    contentVersion: 'test-content-v1',
    reviewedContent: { path: '/assets/tid/reviewed-content.json', sha256: '0'.repeat(64) },
    lexicon: [],
    templates: [],
    mediaAssets: {},
  });
  const fetcher = async (url) => new URL(url).pathname.endsWith('content-manifest.json')
    ? response(JSON.stringify(manifest))
    : response(reviewedText);

  await assert.rejects(
    loadTidTranslationResources({ fetcher, origin: 'https://tid.example' }),
    (error) => error.code === 'content_hash_mismatch',
  );
});

test('the content manifest hash binds templates and lexicon fields', async () => {
  const reviewedContent = { schemaVersion: 1, contentVersion: 'test-content-v1', entries: [] };
  const reviewedText = JSON.stringify(reviewedContent);
  const manifest = {
    schemaVersion: 1,
    contentVersion: 'test-content-v1',
    reviewedContent: {
      path: '/assets/tid/reviewed-content.json',
      sha256: await sha256(JSON.stringify(reviewedContent)),
    },
    lexicon: [],
    templates: [],
    mediaAssets: {},
    contentHash: '0'.repeat(64),
  };
  const fetcher = async (url) => new URL(url).pathname.endsWith('content-manifest.json')
    ? response(JSON.stringify(manifest))
    : response(reviewedText);

  await assert.rejects(
    loadTidTranslationResources({ fetcher, origin: 'https://tid.example' }),
    (error) => error.code === 'content_manifest_hash_mismatch',
  );
});

test('the content loader rejects a cross-origin content URL before fetching it', async () => {
  const manifest = await withContentHash({
    schemaVersion: 1,
    contentVersion: 'test-content-v1',
    reviewedContent: { path: 'https://outside.example/reviewed-content.json', sha256: 'a'.repeat(64) },
    lexicon: [],
    templates: [],
    mediaAssets: {},
  });
  const requested = [];
  const fetcher = async (url) => {
    requested.push(url);
    return response(JSON.stringify(manifest));
  };

  await assert.rejects(
    loadTidTranslationResources({ fetcher, origin: 'https://tid.example' }),
    (error) => error.code === 'unsafe_content_path',
  );
  assert.equal(requested.length, 1);
});

test('the content loader refuses an approved bundle entry without two valid approvals', async () => {
  const entry = makeEntry({ id: 'incomplete-review', sourceText: 'Sen iyisin' });
  entry.entry.review.approvals.pop();
  const bundle = { schemaVersion: 1, contentVersion: 'test-content-v1', entries: [entry.entry] };
  const reviewedText = JSON.stringify(bundle);
  const manifest = await withContentHash({
    schemaVersion: 1,
    contentVersion: 'test-content-v1',
    reviewedContent: {
      path: '/assets/tid/reviewed-content.json',
      sha256: await sha256(JSON.stringify(bundle)),
    },
    lexicon: [],
    templates: [],
    mediaAssets: entry.mediaManifest,
  });
  const fetcher = async (url) => new URL(url).pathname.endsWith('content-manifest.json')
    ? response(JSON.stringify(manifest))
    : response(reviewedText);

  await assert.rejects(
    loadTidTranslationResources({ fetcher, origin: 'https://tid.example' }),
    (error) => error.code === 'invalid_reviewed_content',
  );
});
