import { tokenize } from '../../public/matcher.mjs';

function normalizedTokens(text) {
  if (typeof text !== 'string') throw new TypeError('Reference and hypothesis must be strings.');
  return tokenize(text).map(({ normalized }) => normalized);
}

function editDistance(leftTokens, rightTokens) {
  let shorter = leftTokens;
  let longer = rightTokens;
  if (shorter.length > longer.length) [shorter, longer] = [longer, shorter];

  let previous = Uint32Array.from({ length: shorter.length + 1 }, (_, index) => index);
  let current = new Uint32Array(shorter.length + 1);

  for (let row = 1; row <= longer.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= shorter.length; column += 1) {
      const substitutionCost = shorter[column - 1] === longer[row - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + substitutionCost
      );
    }
    [previous, current] = [current, previous];
  }

  return previous[shorter.length];
}

export function wordErrorRate(reference, hypothesis) {
  const referenceTokens = normalizedTokens(reference);
  const hypothesisTokens = normalizedTokens(hypothesis);
  if (referenceTokens.length === 0) return hypothesisTokens.length === 0 ? 0 : 1;
  return editDistance(referenceTokens, hypothesisTokens) / referenceTokens.length;
}

export function evaluateResults(rows) {
  if (!Array.isArray(rows)) throw new TypeError('Results must be an array.');

  let wordErrors = 0;
  let referenceWords = 0;
  for (const row of rows) {
    const referenceTokens = normalizedTokens(row.reference);
    const hypothesisTokens = normalizedTokens(row.hypothesis);
    wordErrors += editDistance(referenceTokens, hypothesisTokens);
    referenceWords += referenceTokens.length;
  }

  return {
    utterances: rows.length,
    wordErrors,
    referenceWords,
    wer: referenceWords === 0 ? (wordErrors === 0 ? 0 : 1) : wordErrors / referenceWords
  };
}
