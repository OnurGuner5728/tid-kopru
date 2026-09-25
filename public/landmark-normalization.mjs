function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function pointArray(landmarks) {
  return Array.isArray(landmarks) && landmarks.length
    ? landmarks.filter((point) => point && [point.x, point.y, point.z ?? 0].every(Number.isFinite))
    : [];
}

function rounded(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizePoints(rawPoints, anchorIndex = 0, scaleIndex = null) {
  const points = pointArray(rawPoints);
  if (!points.length) return null;
  const anchor = points[Math.min(anchorIndex, points.length - 1)];
  let scale = 0;
  if (scaleIndex !== null && points[scaleIndex]) {
    const target = points[scaleIndex];
    scale = Math.hypot(target.x - anchor.x, target.y - anchor.y, (target.z ?? 0) - (anchor.z ?? 0));
  }
  if (!(scale > 0)) {
    for (const point of points) scale = Math.max(scale, Math.hypot(point.x - anchor.x, point.y - anchor.y, (point.z ?? 0) - (anchor.z ?? 0)));
  }
  if (!(scale > 0)) scale = 1;
  return points.flatMap((point) => [
    rounded((point.x - anchor.x) / scale),
    rounded((point.y - anchor.y) / scale),
    rounded(((point.z ?? 0) - (anchor.z ?? 0)) / scale),
  ]);
}

function handednessName(value) {
  const name = value?.[0]?.categoryName ?? value?.[0]?.displayName ?? value?.categoryName;
  return typeof name === 'string' ? name.toLocaleLowerCase('en-US') : null;
}

export function normalizeLandmarkFrame(result) {
  if (!result || typeof result !== 'object' || !Number.isFinite(result.timestampMs)) throw codedError('invalid_landmark_frame');
  const handsProvided = Array.isArray(result.handLandmarks);
  const handLandmarks = result.handLandmarks ?? [];
  const handednesses = result.handednesses ?? [];
  const hands = { left: null, right: null };

  for (let index = 0; index < handLandmarks.length; index += 1) {
    const normalized = normalizePoints(handLandmarks[index], 0, 9);
    if (!normalized) continue;
    let side = handednessName(handednesses[index]);
    if (!['left', 'right'].includes(side)) side = hands.left === null ? 'left' : 'right';
    if (hands[side] === null) hands[side] = normalized;
  }

  const poseRaw = Array.isArray(result.poseLandmarks?.[0]) ? result.poseLandmarks[0] : result.poseLandmarks;
  const faceRaw = Array.isArray(result.faceLandmarks?.[0]) ? result.faceLandmarks[0] : result.faceLandmarks;
  const pose = normalizePoints(poseRaw, 0, 11);
  const face = normalizePoints(faceRaw, 1, 33);
  if (!handsProvided && !hands.left && !hands.right && !pose && !face) throw codedError('empty_landmark_frame');

  return {
    timestampMs: result.timestampMs,
    handMask: { left: Boolean(hands.left), right: Boolean(hands.right) },
    hands,
    pose,
    face,
  };
}
