const REVIEWER_CODES = /^[A-Za-z0-9_-]{1,64}$/u;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNonnegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function vocabularySet(vocabulary) {
  if (!(Array.isArray(vocabulary) || vocabulary instanceof Set)) return null;
  const values = [...vocabulary];
  if (!values.length || values.some((value) => !isText(value)) || new Set(values).size !== values.length) return null;
  return new Set(values);
}

function eventInterval(event) {
  if (isFiniteNonnegative(event?.startFrame) && isFiniteNonnegative(event?.endFrame)) {
    return { start: event.startFrame, end: event.endFrame, clock: 'frame' };
  }
  if (isFiniteNonnegative(event?.startMs) && isFiniteNonnegative(event?.endMs)) {
    return { start: event.startMs, end: event.endMs, clock: 'ms' };
  }
  return null;
}

function eventMarkers(event) {
  if (event.nonManual === undefined) return [];
  if (!Array.isArray(event.nonManual) || event.nonManual.some((marker) => !isText(marker))) return null;
  const markers = [...new Set(event.nonManual)];
  return markers.sort();
}

function collapseExactDuplicateEvents(events) {
  const collapsed = [];
  for (const event of events) {
    const previous = collapsed.at(-1);
    const interval = eventInterval(event);
    const previousInterval = previous ? eventInterval(previous) : null;
    const markers = eventMarkers(event);
    const previousMarkers = previous ? eventMarkers(previous) : null;
    if (
      previous
      && previous.glossId === event.glossId
      && interval?.clock === previousInterval?.clock
      && interval?.start === previousInterval?.start
      && interval?.end === previousInterval?.end
      && event.channel === previous.channel
      && JSON.stringify(markers) === JSON.stringify(previousMarkers)
    ) {
      previous.confidence = Math.min(previous.confidence, event.confidence);
    } else {
      collapsed.push({ ...event });
    }
  }
  return collapsed;
}

function normalizeGlossEvents(events, vocabulary) {
  const knownGlosses = vocabularySet(vocabulary);
  if (!knownGlosses || !Array.isArray(events) || events.length === 0) return null;
  if (!events.every((event) => isRecord(event) && isText(event.glossId))) return null;
  const normalized = collapseExactDuplicateEvents(events);
  let previousStart = -Infinity;
  let previousClock = null;
  for (let index = 0; index < normalized.length; index += 1) {
    const event = normalized[index];
    const interval = eventInterval(event);
    const markers = eventMarkers(event);
    const confidenceValid = typeof event.confidence === 'number'
      && Number.isFinite(event.confidence)
      && event.confidence >= 0
      && event.confidence <= 1;
    if (
      !knownGlosses.has(event.glossId)
      || !interval
      || interval.end <= interval.start
      || (previousClock !== null && interval.clock !== previousClock)
      || interval.start < previousStart
      || markers === null
      || !confidenceValid
      || (event.channel !== undefined && !['manual', 'nonManual'].includes(event.channel))
      || (event.parallelGroup !== undefined && !isText(event.parallelGroup))
    ) return null;
    previousStart = interval.start;
    previousClock = interval.clock;

    for (const prior of normalized.slice(0, index)) {
      const priorInterval = eventInterval(prior);
      if (interval.start >= priorInterval.end || priorInterval.start >= interval.end) continue;
      const parallel = ['manual', 'nonManual'].includes(event.channel)
        && ['manual', 'nonManual'].includes(prior.channel)
        && isText(event.parallelGroup)
        && event.parallelGroup === prior.parallelGroup
        && event.channel !== prior.channel;
      if (!parallel) return null;
    }
  }
  return normalized;
}

export function isValidGlossTimeline(events, vocabulary) {
  return normalizeGlossEvents(events, vocabulary) !== null;
}

export function hasTwoApprovals(entry) {
  const review = entry?.review;
  if (!isRecord(review) || review.status !== 'approved') return false;
  if (
    !Array.isArray(review.reviewerCodes)
    || review.reviewerCodes.length !== 2
    || review.reviewerCodes.some((code) => !isText(code) || !REVIEWER_CODES.test(code))
    || new Set(review.reviewerCodes).size !== 2
    || !Array.isArray(review.approvals)
    || review.approvals.length !== 2
  ) return false;
  const approvalCodes = [];
  for (const approval of review.approvals) {
    if (
      !isRecord(approval)
      || !isText(approval.reviewerCode)
      || approval.decision !== 'approve'
      || approval.independent !== true
    ) return false;
    approvalCodes.push(approval.reviewerCode);
  }
  if (new Set(approvalCodes).size !== 2 || review.reviewerCodes.some((code) => !approvalCodes.includes(code))) return false;
  if (review.disagreement === true) {
    return isRecord(review.adjudication)
      && isText(review.adjudication.reviewerCode)
      && !review.reviewerCodes.includes(review.adjudication.reviewerCode)
      && isText(review.adjudication.resolution);
  }
  return review.disagreement === false && review.adjudication === null;
}

function requiredMarkersMatch(entry, events) {
  const required = entry.requiredNonManual ?? [];
  if (!Array.isArray(required) || required.some((marker) => !isText(marker))) return false;
  const normalizedRequired = [...new Set(required)].sort();
  const actual = [...new Set(events.flatMap((event) => eventMarkers(event) ?? []))].sort();
  return JSON.stringify(actual) === JSON.stringify(normalizedRequired);
}

function validPhraseEntry(entry) {
  return isRecord(entry)
    && isText(entry.id)
    && Array.isArray(entry.glosses)
    && entry.glosses.length > 0
    && entry.glosses.every(isText)
    && isText(entry.turkishText)
    && (entry.confidence === undefined || (
      typeof entry.confidence === 'number'
      && Number.isFinite(entry.confidence)
      && entry.confidence >= 0
      && entry.confidence <= 1
    ));
}

function exactMatches(entries, events) {
  if (!Array.isArray(entries)) return [];
  const glosses = events.map((event) => event.glossId);
  return entries.filter((entry) => (
    validPhraseEntry(entry)
    && JSON.stringify(entry.glosses) === JSON.stringify(glosses)
    && requiredMarkersMatch(entry, events)
  ));
}

function findReviewedGlossPhrase(events, resources) {
  return exactMatches(resources?.phrases, events);
}

function matchReviewedTidTemplate(events, resources) {
  return exactMatches(resources?.templates, events);
}

function rejected(reason, unsupportedGlosses = [], resources = null, status = 'unsupported') {
  return {
    status,
    text: undefined,
    confidence: undefined,
    reason,
    unsupportedGlosses,
    contentVersion: isText(resources?.contentVersion) ? resources.contentVersion : null,
  };
}

function resolve(matches, events, resources) {
  const approved = matches.filter(hasTwoApprovals);
  if (approved.length === 0) return null;
  const translations = new Set(approved.map((entry) => entry.turkishText.trim()));
  if (translations.size > 1) return { ambiguous: true };
  const entry = approved[0];
  const eventConfidence = Math.min(...events.map((event) => event.confidence));
  return {
    result: {
      status: 'ready',
      text: entry.turkishText.trim(),
      confidence: Math.min(eventConfidence, entry.confidence ?? 1),
      unsupportedGlosses: [],
      contentVersion: isText(resources?.contentVersion) ? resources.contentVersion : null,
    },
  };
}

export function translateTidGlossToTurkish(glossEvents, resources) {
  const vocabulary = vocabularySet(resources?.vocabulary);
  if (!vocabulary) return rejected('invalid_resources', [], resources);
  if (!Array.isArray(glossEvents) || glossEvents.length === 0) {
    return rejected('empty_gloss_sequence', [], resources);
  }
  const unknownGlosses = [...new Set(glossEvents
    .filter((event) => isRecord(event) && isText(event.glossId) && !vocabulary.has(event.glossId))
    .map((event) => event.glossId))];
  if (unknownGlosses.length) return rejected('unknown_gloss', unknownGlosses, resources);
  const normalized = normalizeGlossEvents(glossEvents, vocabulary);
  if (!normalized) return rejected('invalid_timeline', [], resources);

  const exact = resolve(findReviewedGlossPhrase(normalized, resources), normalized, resources);
  if (exact?.ambiguous) return rejected('ambiguous_translation', [], resources, 'ambiguous');
  if (exact?.result) return exact.result;
  const template = resolve(matchReviewedTidTemplate(normalized, resources), normalized, resources);
  if (template?.ambiguous) return rejected('ambiguous_template', [], resources, 'ambiguous');
  if (template?.result) return template.result;
  return rejected('unsupported_gloss_sequence', [], resources);
}

export function resolveCandidateTurkish(candidate, resources) {
  if (!candidate || !Array.isArray(candidate.glosses) || !candidate.glosses.length
      || typeof candidate.confidence !== 'number' || !Number.isFinite(candidate.confidence)) {
    return rejected('invalid_candidate', [], resources);
  }
  const events = candidate.glosses.map((glossId, index) => ({
    glossId, startFrame: index, endFrame: index + 1, confidence: candidate.confidence,
  }));
  const reviewed = translateTidGlossToTurkish(events, resources);
  if (reviewed.status === 'ready') return { ...reviewed, needsConfirmation: true, source: 'reviewed-mapping' };
  return {
    status: 'candidate', text: candidate.glosses.join(' '), confidence: candidate.confidence,
    reason: reviewed.reason, unsupportedGlosses: reviewed.unsupportedGlosses,
    contentVersion: reviewed.contentVersion, needsConfirmation: true, source: candidate.source,
  };
}
