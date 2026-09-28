import assert from 'node:assert/strict';
import test from 'node:test';

import { createNvidiaCandidateProvider } from '../public/nvidia-candidate.mjs';

const blob = new Blob(['video'], { type: 'video/webm' });
const okPayload = { choices: [{ message: { content: JSON.stringify({ candidateText: 'Merhaba', glosses: ['MERHABA'], warnings: ['deneysel'] }) } }] };

function response(status, body = okPayload) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

test('provider sends inline video to an OpenAI-compatible endpoint and caps confidence', async () => {
  let request;
  const provider = createNvidiaCandidateProvider({
    fetcher: async (url, init) => { request = { url, init }; return response(200); },
    endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
    model: 'google/gemma-4-31b-it',
  });
  const result = await provider.recognizeVideo({ blob, apiKey: 'fresh-key' });
  const body = JSON.parse(request.init.body);
  assert.match(body.messages[0].content[1].video_url.url, /^data:video\/webm;base64,/u);
  assert.equal(request.init.headers.Authorization, 'Bearer fresh-key');
  assert.equal(result.source, 'cloud-candidate');
  assert.equal(result.needsConfirmation, true);
  assert.ok(result.confidence < 0.6);
  assert.equal(result.text, 'Merhaba');
});

test('provider accepts the codec-qualified WebM MIME type produced by MediaRecorder', async () => {
  let request;
  const provider = createNvidiaCandidateProvider({ fetcher: async (_url, init) => { request = init; return response(200); } });
  const recordedBlob = new Blob(['video'], { type: 'video/webm;codecs=vp8' });

  await provider.recognizeVideo({ blob: recordedBlob, apiKey: 'fresh-key' });

  const body = JSON.parse(request.body);
  assert.match(body.messages[0].content[1].video_url.url, /^data:video\/webm;base64,/u);
});

test('proxy mode does not require or transmit a browser API key', async () => {
  let headers;
  const provider = createNvidiaCandidateProvider({ fetcher: async (_url, init) => { headers = init.headers; return response(200); }, proxyUrl: '/api/nvidia' });
  await provider.recognizeVideo({ blob });
  assert.equal(headers.Authorization, undefined);
});

test('provider maps authentication, rate, network, timeout, malformed JSON, prose, and abort failures', async () => {
  const cases = [
    [async () => response(401), 'cloud_auth_failed'],
    [async () => response(429), 'cloud_rate_limited'],
    [async () => { throw new TypeError('CORS'); }, 'cloud_network_failed'],
    [async () => response(200, { nope: true }), 'cloud_response_invalid'],
    [async () => response(200, { choices: [{ message: { content: 'Merhaba olabilir.' } }] }), 'cloud_response_invalid'],
  ];
  for (const [fetcher, code] of cases) {
    const provider = createNvidiaCandidateProvider({ fetcher, timeoutMs: 10 });
    await assert.rejects(provider.recognizeVideo({ blob, apiKey: 'x' }), { code });
  }

  const timeoutProvider = createNvidiaCandidateProvider({ fetcher: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))), timeoutMs: 2 });
  await assert.rejects(timeoutProvider.recognizeVideo({ blob, apiKey: 'x' }), { code: 'cloud_timeout' });

  const controller = new AbortController();
  controller.abort();
  const abortedProvider = createNvidiaCandidateProvider({ fetcher: async () => response(200) });
  await assert.rejects(abortedProvider.recognizeVideo({ blob, apiKey: 'x', signal: controller.signal }), { name: 'AbortError' });
});
