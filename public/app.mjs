import { SignAvatar } from './avatar.mjs';
import { loadTidTranslationResources } from './tid-transfer.mjs';
import { createTidMediaPlayer } from './tid-media-player.mjs';
import { createTidOutputController } from './tid-output-ui.mjs';
import { SignRecognitionClient } from './sign-recognition.mjs';
import { downloadCameraModel } from './onnx-runtime-loader.mjs';
import { translateTidGlossToTurkish } from './tid-transfer.mjs';
import { TRANSLATION_MODES, createPrivacyModeController } from './privacy-mode.mjs';
import { createCloudSession } from './cloud-session.mjs';
import { createLandmarkRuntime, verifyRuntimeManifestFiles } from './landmark-runtime.mjs';
import { createPersonalSignStore } from './personal-sign-store.mjs';
import { createPersonalTrainer } from './personal-training.mjs';
import { createPersonalRecognitionBackend } from './personal-sign-recognizer.mjs';
import { createHybridRecognizer } from './hybrid-recognition.mjs';
import { createNvidiaCandidateProvider } from './nvidia-candidate.mjs';
import { createTidDisplayPlan } from './tid-display-plan.mjs';
import { renderLetterCards } from './letter-cards.mjs';
import { createAppStateMachine } from './app-state.mjs';

const elements = {
  networkDot: document.querySelector('#network-dot'),
  networkLabel: document.querySelector('#network-label'),
  avatarRetry: document.querySelector('#avatar-retry'),
  pwaStatus: document.querySelector('#pwa-status'),
  speechSupport: document.querySelector('#speech-support'),
  heardText: document.querySelector('#heard-text'),
  heardCount: document.querySelector('#heard-count'),
  listeningState: document.querySelector('#listening-state'),
  micButton: document.querySelector('#mic-button'),
  clearHeard: document.querySelector('#clear-heard'),
  fullscreenButton: document.querySelector('#fullscreen-button'),
  fullscreenDialog: document.querySelector('#fullscreen-dialog'),
  fullscreenText: document.querySelector('#fullscreen-text'),
  dialogClose: document.querySelector('#dialog-close'),
  replyText: document.querySelector('#reply-text'),
  speakButton: document.querySelector('#speak-button'),
  stopSpeech: document.querySelector('#stop-speech'),
  ttsStatus: document.querySelector('#tts-status'),
  confirmTurkish: document.querySelector('#confirm-turkish'),
  tidSource: document.querySelector('#tid-source'),
  tidStatus: document.querySelector('#tid-status'),
  tidGloss: document.querySelector('#tid-gloss'),
  playTid: document.querySelector('#play-tid'),
  stopTid: document.querySelector('#stop-tid'),
  retryTid: document.querySelector('#retry-tid'),
  tidProgress: document.querySelector('#tid-progress'),
  tidVideo: document.querySelector('#tid-video'),
  avatarStage: document.querySelector('#avatar-stage'),
  avatarLoader: document.querySelector('#avatar-loader'),
  avatarStatus: document.querySelector('#avatar-status'),
  cameraPreview: document.querySelector('#camera-preview'),
  cameraStatus: document.querySelector('#camera-status'),
  cameraProgress: document.querySelector('#camera-progress'),
  cameraDownload: document.querySelector('#camera-model-download'),
  cameraStart: document.querySelector('#camera-start'),
  cameraFinish: document.querySelector('#camera-finish'),
  cameraStop: document.querySelector('#camera-stop'),
  cameraCandidateText: document.querySelector('#camera-candidate-text'),
  cameraCandidateSource: document.querySelector('#camera-candidate-source'),
  cameraEdit: document.querySelector('#camera-edit'),
  cameraConfirm: document.querySelector('#camera-confirm'),
  modeInputs: [...document.querySelectorAll('[name="translation-mode"]')],
  cloudConsent: document.querySelector('#cloud-consent'),
  cloudDisclosure: document.querySelector('#cloud-disclosure'),
  cloudApiKey: document.querySelector('#cloud-api-key'),
  cloudProxyUrl: document.querySelector('#cloud-proxy-url'),
  cloudKeySet: document.querySelector('#cloud-key-set'),
  cloudKeyClear: document.querySelector('#cloud-key-clear'),
  cloudKeyStatus: document.querySelector('#cloud-key-status'),
  teachingLabel: document.querySelector('#teaching-label'),
  teachingRecord: document.querySelector('#teaching-record'),
  teachingDelete: document.querySelector('#teaching-delete'),
  teachingClear: document.querySelector('#teaching-clear'),
  teachingStatus: document.querySelector('#teaching-status'),
  letterCardStage: document.querySelector('#letter-card-stage'),
  playbackSpeed: document.querySelector('#playback-speed'),
  repeatTid: document.querySelector('#repeat-tid'),
  stepTid: document.querySelector('#step-tid'),
};

let recognition;
let speechErrorMessage = '';
let listening = false;
let recognitionBase = '';
let avatar;
let translationResources;
let translationPlayer;
let tidOutput;
let pwaStatusMessage = '';
let cameraManifest = null;
let cameraClient = null;
let cameraInstalled = false;
let cameraCandidateReady = false;
let privacyController;
const cloudSession = createCloudSession();
const personalStore = createPersonalSignStore();
let landmarkRuntime;
let personalTrainer;
let personalBackend;
let runtimeReady = false;
let activeCameraStream = null;
let capturedFrames = [];
let mediaRecorder = null;
let recordedChunks = [];
let cloudClip = null;
const appState = createAppStateMachine({ onChange: (state) => document.body.dataset.appState = state });

function initializePrivacyModes() {
  privacyController = createPrivacyModeController({
    onChange: ({ mode, cloudConsent }) => {
      elements.modeInputs.forEach((input) => { input.checked = input.value === mode; });
      elements.cloudConsent.disabled = mode === TRANSLATION_MODES.LOCAL;
      elements.cloudConsent.checked = cloudConsent;
      elements.cloudDisclosure.innerHTML = cloudConsent
        ? '<strong>Bulut:</strong> Bu oturum için açık. Yalnızca ayrıca gönderdiğiniz kısa klip kullanılır.'
        : '<strong>Bulut:</strong> Kapalı. Hiçbir kamera klibi gönderilmez.';
    },
  });
  elements.modeInputs.forEach((input) => input.addEventListener('change', () => {
    if (input.checked) privacyController.setMode(input.value);
  }));
  elements.cloudConsent.addEventListener('change', () => {
    if (elements.cloudConsent.checked) privacyController.grantCloudConsent();
    else privacyController.revokeCloudConsent();
  });
  elements.cloudKeySet.addEventListener('click', () => {
    try {
      cloudSession.setKey(elements.cloudApiKey.value);
      elements.cloudApiKey.value = '';
      elements.cloudKeyStatus.textContent = 'Oturum anahtarı hazır. Sayfadan ayrılınca otomatik silinir.';
    } catch {
      elements.cloudKeyStatus.textContent = 'Geçerli, yeni bir oturum anahtarı girin.';
    }
  });
  elements.cloudKeyClear.addEventListener('click', () => {
    cloudSession.clearKey();
    elements.cloudApiKey.value = '';
    elements.cloudKeyStatus.textContent = 'Bulut anahtarı temizlendi.';
  });
  privacyController.registerDisposer(() => {
    try { recognition?.abort?.(); } catch { /* recognition may already be closed */ }
    globalThis.speechSynthesis?.cancel?.();
    void cameraClient?.dispose();
    cameraClient = null;
    cameraInstalled = false;
    landmarkRuntime?.stopCapture();
    void landmarkRuntime?.dispose();
    stopStream();
    cloudSession.dispose();
  });
}

function updateNetworkStatus() {
  const online = navigator.onLine;
  elements.networkDot.classList.toggle('online', online);
  elements.networkLabel.textContent = online ? 'Çevrimiçi' : 'Çevrimdışı kullanım';
  renderPwaStatus();
}

function updateCharacterCount() {
  elements.heardCount.textContent = `${elements.heardText.value.length} / 800`;
}

function setListeningState(active, label) {
  listening = active;
  tidOutput?.setSpeechActive(active);
  elements.micButton.classList.toggle('listening', active);
  elements.micButton.querySelector('span').textContent = active ? 'Dinlemeyi durdur' : 'Dinlemeyi başlat';
  elements.listeningState.classList.toggle('active', active);
  elements.listeningState.textContent = label;
}

function initializeSpeechRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    elements.speechSupport.textContent = 'Bu tarayıcı konuşma tanımayı desteklemiyor. Metni elle yazabilirsiniz.';
    elements.speechSupport.classList.add('warning');
    elements.micButton.disabled = true;
    return;
  }

  elements.speechSupport.textContent = 'Mikrofon işlemesi tarayıcınıza bağlıdır ve internet gerektirebilir.';
  recognition = new Recognition();
  recognition.lang = 'tr-TR';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.addEventListener('start', () => {
    speechErrorMessage = '';
    setListeningState(true, 'Dinleniyor…');
  });
  recognition.addEventListener('result', (event) => {
    let finalText = '';
    let interimText = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const transcript = event.results[index][0].transcript;
      if (event.results[index].isFinal) finalText += transcript;
      else interimText += transcript;
    }
    if (finalText) recognitionBase = [recognitionBase, finalText.trim()].filter(Boolean).join(' ');
    elements.heardText.value = [recognitionBase, interimText.trim()].filter(Boolean).join(' ');
    elements.heardText.dispatchEvent(new Event('input', { bubbles: true }));
  });
  recognition.addEventListener('end', () => setListeningState(false, speechErrorMessage || 'Hazır'));
  recognition.addEventListener('error', (event) => {
    const messages = {
      'not-allowed': 'Mikrofon izni verilmedi. İzin verin veya metni elle yazın.',
      'service-not-allowed': 'Tarayıcı konuşma hizmetine izin vermedi. Metni elle yazabilirsiniz.',
      'no-speech': 'Konuşma algılanmadı. Tekrar deneyin veya metni elle yazın.',
      network: 'Konuşma hizmetine ulaşılamadı. Metni elle yazabilirsiniz.'
    };
    speechErrorMessage = messages[event.error] ?? 'Konuşma tanınamadı.';
    setListeningState(false, speechErrorMessage);
  });

  elements.micButton.addEventListener('click', () => {
    if (listening) {
      recognition.stop();
      return;
    }
    recognitionBase = elements.heardText.value.trim();
    try {
      recognition.start();
    } catch {
      setListeningState(false, 'Mikrofon yeniden hazırlanıyor.');
    }
  });
}

function initializeTextActions() {
  elements.heardText.addEventListener('input', updateCharacterCount);
  elements.clearHeard.addEventListener('click', () => {
    elements.heardText.value = '';
    recognitionBase = '';
    elements.heardText.dispatchEvent(new Event('input', { bubbles: true }));
    elements.heardText.focus();
  });
  elements.fullscreenButton.addEventListener('click', () => {
    const text = elements.heardText.value.trim();
    if (!text) {
      elements.listeningState.textContent = 'Önce gösterilecek metni yazın.';
      elements.heardText.focus();
      return;
    }
    elements.fullscreenText.textContent = text;
    elements.fullscreenDialog.showModal();
  });
  elements.dialogClose.addEventListener('click', () => elements.fullscreenDialog.close());
  elements.fullscreenDialog.addEventListener('click', (event) => {
    if (event.target === elements.fullscreenDialog) elements.fullscreenDialog.close();
  });
  document.querySelectorAll('[data-reply]').forEach((button) => {
    button.addEventListener('click', () => {
      elements.replyText.value = button.dataset.reply;
      elements.replyText.focus();
    });
  });
}

function initializeTextToSpeech() {
  if (!('speechSynthesis' in window)) {
    elements.speakButton.disabled = true;
    elements.stopSpeech.disabled = true;
    elements.ttsStatus.textContent = 'Bu tarayıcı ses sentezini desteklemiyor.';
    return;
  }

  elements.speakButton.addEventListener('click', () => {
    const text = elements.replyText.value.trim();
    if (!text) {
      elements.ttsStatus.textContent = 'Önce seslendirilecek yanıtı yazın.';
      elements.replyText.focus();
      return;
    }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'tr-TR';
    const turkishVoice = speechSynthesis.getVoices().find((voice) => voice.lang.toLocaleLowerCase('tr-TR').startsWith('tr'));
    if (turkishVoice) utterance.voice = turkishVoice;
    utterance.addEventListener('start', () => {
      elements.ttsStatus.textContent = 'Yanıt seslendiriliyor…';
      elements.speakButton.disabled = true;
    });
    utterance.addEventListener('end', () => {
      elements.ttsStatus.textContent = 'Seslendirme tamamlandı.';
      elements.speakButton.disabled = false;
    });
    utterance.addEventListener('error', () => {
      elements.ttsStatus.textContent = 'Yanıt seslendirilemedi.';
      elements.speakButton.disabled = false;
    });
    speechSynthesis.speak(utterance);
  });
  elements.stopSpeech.addEventListener('click', () => {
    speechSynthesis.cancel();
    elements.speakButton.disabled = false;
    elements.ttsStatus.textContent = 'Seslendirme durduruldu.';
  });
}

async function loadAvatar() {
  elements.avatarLoader.hidden = false;
  elements.avatarRetry.hidden = true;
  elements.avatarRetry.disabled = true;
  elements.avatarStatus.textContent = 'Avatar hazırlanıyor…';

  try {
    if (!avatar) {
      avatar = new SignAvatar(elements.avatarStage, (message) => {
        elements.avatarStatus.textContent = message.includes('kayıtlı işaret hazır') ? 'Avatar hazır' : message;
      });
    }
    await avatar.initialize();
    if (translationResources) translationResources.poseNames = Object.keys(avatar.poses);
    populateTeachingLabels();
    elements.avatarLoader.hidden = true;
    elements.avatarStatus.textContent = 'Sözlük gösterici hazır';
  } catch (error) {
    elements.avatarLoader.hidden = true;
    elements.avatarStatus.textContent = navigator.onLine
      ? 'Avatar yüklenemedi. İnternet bağlantısını kontrol edip yeniden deneyin.'
      : 'Avatar henüz indirilmedi. İlk yükleme için internet gerekir.';
    elements.avatarRetry.hidden = false;
    elements.avatarRetry.disabled = false;
    console.error(error);
  }
}

async function loadTranslationResources({ retryCurrentText = false } = {}) {
  tidOutput?.setLoading('Onaylı TİD içerik listesi yükleniyor…');
  try {
    translationResources = await loadTidTranslationResources();
    if (avatar?.poses) translationResources.poseNames = Object.keys(avatar.poses);
    refreshCameraControls();
    tidOutput?.setIdle();
    if (retryCurrentText && elements.heardText.value.trim()) await tidOutput?.confirm();
  } catch {
    translationResources = null;
    refreshCameraControls();
    tidOutput?.setError('Onaylı TİD içerik listesi yüklenemedi. Bağlantıyı kontrol edip yeniden deneyin; Türkçe metniniz düzenlenebilir durumda.');
  }
}

function refreshCameraControls() {
  const busy = ['requesting-permission', 'capturing', 'processing'].includes(appState.getState());
  elements.cameraStart.disabled = !runtimeReady || busy;
  elements.cameraFinish.disabled = appState.getState() !== 'capturing';
  elements.cameraStop.disabled = !['requesting-permission', 'capturing', 'processing'].includes(appState.getState());
  elements.cameraDownload.disabled = cameraManifest?.available !== true || cameraInstalled;
}

function sourceLabel(source) {
  return ({ personal: 'Kişisel cihaz içi eşleşme', 'verified-onnx': 'Doğrulanmış yerel model adayı', 'cloud-candidate': 'NVIDIA bulut adayı', 'reviewed-mapping': 'Uzman onaylı gloss eşlemesi' })[source] ?? 'Aday bulunamadı';
}

function renderCameraCandidate(result) {
  cameraCandidateReady = false;
  elements.cameraCandidateText.value = '';
  elements.cameraCandidateText.disabled = true;
  elements.cameraEdit.disabled = true;
  elements.cameraConfirm.disabled = true;
  elements.cameraCandidateSource.textContent = sourceLabel(result?.source);
  if (!result?.text || result.reason === 'anlaşılamadı') {
    appState.transition('idle');
    elements.cameraStatus.textContent = 'Güvenilir bir eşleşme bulunamadı. Bir işareti üç kez öğretebilir veya adayı elle yazabilirsiniz.';
    refreshCameraControls();
    return;
  }
  elements.cameraCandidateText.value = result.text;
  elements.cameraEdit.disabled = false;
  elements.cameraConfirm.disabled = false;
  cameraCandidateReady = true;
  appState.transition('candidate');
  elements.cameraStatus.textContent = `${sourceLabel(result.source)} hazır. Sonucu kontrol edin; yalnızca onayınızla yanıt alanına aktarılır.`;
  refreshCameraControls();
}

function stopStream(stream = activeCameraStream) {
  for (const track of stream?.getTracks?.() ?? []) track.stop();
  if (stream === activeCameraStream) activeCameraStream = null;
  elements.cameraPreview.srcObject = null;
  elements.cameraPreview.hidden = true;
}

function finishRecorder() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return Promise.resolve(cloudClip);
  return new Promise((resolve) => {
    mediaRecorder.addEventListener('stop', () => {
      cloudClip = recordedChunks.length ? new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'video/webm' }) : null;
      resolve(cloudClip);
    }, { once: true });
    mediaRecorder.stop();
  });
}

async function cloudCandidateBackend() {
  const proxyUrl = elements.cloudProxyUrl.value.trim() || null;
  const provider = createNvidiaCandidateProvider({ proxyUrl });
  return {
    recognize: async ({ blob }, { signal } = {}) => {
      if (!blob) throw new Error('cloud_clip_missing');
      if (proxyUrl) return provider.recognizeVideo({ blob, signal });
      return cloudSession.withKey((apiKey) => provider.recognizeVideo({ blob, apiKey, signal }));
    },
  };
}

async function recognizeCapturedUtterance() {
  const privacy = privacyController.getState();
  const cloudBackend = privacy.mode === TRANSLATION_MODES.CLOUD_ASSISTED && privacy.cloudConsent
    ? await cloudCandidateBackend()
    : null;
  const recognizer = createHybridRecognizer({
    personalBackend,
    cloudBackend,
    translateGlosses: (events) => translateTidGlossToTurkish(events, translationResources?.glossToTurkish),
  });
  return recognizer.recognize({ frames: capturedFrames, blob: cloudClip }, privacy);
}

function populateTeachingLabels() {
  const names = Object.keys(avatar?.poses ?? {}).sort((left, right) => left.localeCompare(right, 'tr'));
  elements.teachingLabel.replaceChildren(new Option('İşaret seçin', ''), ...names.map((name) => new Option(name, name)));
  elements.teachingStatus.textContent = `${names.length} sözlük işareti öğretmeye hazır. Her işareti en az üç kez kaydedin.`;
}

async function initializeCameraTools() {
  elements.cameraEdit.addEventListener('click', () => {
    if (!cameraCandidateReady) return;
    elements.cameraCandidateText.disabled = false;
    elements.cameraCandidateText.focus();
  });
  elements.cameraConfirm.addEventListener('click', () => {
    const text = elements.cameraCandidateText.value.trim();
    if (!cameraCandidateReady || !text) return;
    elements.replyText.value = text;
    elements.replyText.dispatchEvent(new Event('input', { bubbles: true }));
    elements.replyText.focus();
    elements.cameraStatus.textContent = 'Onayladığınız aday yanıt alanına aktarıldı.';
  });

  elements.cameraDownload.addEventListener('click', async () => {
    if (!cameraManifest?.available || cameraInstalled) return;
    elements.cameraDownload.disabled = true;
    try {
      await downloadCameraModel(cameraManifest, { origin: location.origin, onProgress: ({ percent }) => { elements.cameraProgress.textContent = `${percent}% doğrulandı`; } });
      cameraInstalled = true;
      elements.cameraStatus.textContent = 'İsteğe bağlı yerel cümle modeli doğrulandı.';
    } catch {
      elements.cameraStatus.textContent = 'İsteğe bağlı model indirilemedi; kişisel cihaz içi tanıma kullanılabilir.';
    }
    refreshCameraControls();
  });

  elements.cameraStart.addEventListener('click', async () => {
    if (!runtimeReady || appState.getState() === 'capturing') return;
    appState.transition('requesting-permission');
    refreshCameraControls();
    elements.cameraStatus.textContent = 'Kamera izni bekleniyor…';
    try {
      activeCameraStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } } });
      elements.cameraPreview.srcObject = activeCameraStream;
      elements.cameraPreview.hidden = false;
      await elements.cameraPreview.play();
      capturedFrames = [];
      cloudClip = null;
      recordedChunks = [];
      const privacy = privacyController.getState();
      if (privacy.mode === TRANSLATION_MODES.CLOUD_ASSISTED && privacy.cloudConsent && typeof MediaRecorder === 'function') {
        mediaRecorder = new MediaRecorder(activeCameraStream, { mimeType: MediaRecorder.isTypeSupported?.('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8' : 'video/webm' });
        mediaRecorder.addEventListener('dataavailable', ({ data }) => { if (data?.size) recordedChunks.push(data); });
        mediaRecorder.start(250);
      }
      await landmarkRuntime.startCapture(elements.cameraPreview, (frame, error) => {
        if (frame) capturedFrames.push(frame);
        if (error) elements.cameraProgress.textContent = 'Bir kamera karesi işlenemedi; kayıt sürüyor.';
      });
      appState.transition('capturing');
      elements.cameraStatus.textContent = 'İşaretinizi yapın, sonra “İşareti bitir” düğmesine basın.';
    } catch {
      stopStream();
      appState.transition('error');
      elements.cameraStatus.textContent = 'Kamera açılamadı veya izin verilmedi.';
    }
    refreshCameraControls();
  });

  elements.cameraFinish.addEventListener('click', async () => {
    if (appState.getState() !== 'capturing') return;
    appState.transition('processing');
    refreshCameraControls();
    elements.cameraStatus.textContent = 'İşaret dizisi değerlendiriliyor…';
    landmarkRuntime.stopCapture();
    await finishRecorder();
    stopStream();
    try { renderCameraCandidate(await recognizeCapturedUtterance()); }
    catch { renderCameraCandidate({ reason: 'anlaşılamadı', source: 'none' }); }
  });

  elements.cameraStop.addEventListener('click', async () => {
    landmarkRuntime?.stopCapture();
    if (mediaRecorder?.state !== 'inactive') mediaRecorder?.stop();
    recordedChunks = [];
    cloudClip = null;
    stopStream();
    appState.transition('idle');
    elements.cameraStatus.textContent = 'Kamera durduruldu; kayıt ve aday silindi.';
    refreshCameraControls();
  });

  elements.teachingLabel.addEventListener('change', async () => {
    const label = elements.teachingLabel.value;
    elements.teachingRecord.disabled = !label || !runtimeReady;
    elements.teachingDelete.disabled = !label;
    if (label && personalTrainer) {
      const progress = await personalTrainer.getProgress(label);
      elements.teachingStatus.textContent = `${label}: ${progress.sampleCount} / ${progress.minSamples} örnek${progress.ready ? ' · tanımaya hazır' : ''}`;
    }
  });
  elements.teachingRecord.addEventListener('click', async () => {
    const label = elements.teachingLabel.value;
    if (!label || !runtimeReady) return;
    elements.teachingRecord.disabled = true;
    elements.teachingStatus.textContent = 'Kamera izni bekleniyor; işareti doğal hızınızda yapın…';
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user' } });
      elements.cameraPreview.srcObject = stream;
      elements.cameraPreview.hidden = false;
      await elements.cameraPreview.play();
      const result = await personalTrainer.recordSample(label, { video: elements.cameraPreview, durationMs: 1800 });
      elements.teachingStatus.textContent = `${label}: ${result.sampleCount} / ${result.minSamples} örnek · kalite ${result.quality}${result.ready ? ' · tanımaya hazır' : ''}`;
    } catch {
      elements.teachingStatus.textContent = 'Örnek kaydedilemedi. Ellerin kadrajda olduğundan ve kamera izninden emin olun.';
    } finally {
      stopStream(stream);
      elements.teachingRecord.disabled = false;
    }
  });
  elements.teachingDelete.addEventListener('click', async () => {
    const label = elements.teachingLabel.value;
    if (!label) return;
    await personalTrainer.deleteLabel(label);
    elements.teachingStatus.textContent = `${label} için kişisel örnekler silindi.`;
  });
  elements.teachingClear.addEventListener('click', async () => {
    await personalTrainer.clear();
    elements.teachingStatus.textContent = 'Tüm kişisel işaret örnekleri bu cihazdan silindi.';
  });

  try {
    const [runtimeResponse, modelResponse] = await Promise.all([
      fetch(new URL('./assets/runtime/runtime-manifest.json', location.href), { credentials: 'same-origin' }),
      fetch(new URL('./assets/tid/sentence-model-manifest.json', location.href), { credentials: 'same-origin' }),
    ]);
    if (!runtimeResponse.ok) throw new Error('runtime_manifest_unavailable');
    const runtimeManifest = await runtimeResponse.json();
    cameraManifest = modelResponse.ok ? await modelResponse.json() : null;
    await verifyRuntimeManifestFiles(runtimeManifest, {
      baseUrl: new URL('./', location.href).href,
      onProgress: ({ percent, path }) => { elements.cameraProgress.textContent = `${percent}% doğrulandı · ${path.split('/').at(-1)}`; },
    });
    landmarkRuntime = createLandmarkRuntime({ manifest: runtimeManifest, baseUrl: new URL('./', location.href).href });
    await landmarkRuntime.initialize();
    personalTrainer = createPersonalTrainer({ runtime: landmarkRuntime, store: personalStore, minSamples: 3 });
    personalBackend = createPersonalRecognitionBackend({ store: personalStore });
    runtimeReady = true;
    elements.cameraStatus.textContent = 'Kişisel cihaz içi kamera tanıma hazır. Önce bir işareti üç kez öğretin.';
    populateTeachingLabels();
  } catch {
    appState.transition('error');
    elements.cameraStatus.textContent = 'Yerel kamera çalışma zamanı hazırlanamadı. Sayfayı yenileyip yeniden deneyin.';
  }
  refreshCameraControls();
}

function initializeTidOutput() {
  const avatarPlayer = {
    playValidatedAnimation: (...args) => {
      if (!avatar?.ready) throw Object.assign(new Error('avatar_unavailable'), { code: 'avatar_unavailable' });
      return avatar.playValidatedAnimation(...args);
    },
    stop: () => avatar?.stop(),
    applyIdlePose: () => avatar?.applyIdlePose(),
    playWord: (label) => avatar?.playWord(label),
  };
  translationPlayer = createTidMediaPlayer({
    avatar: avatarPlayer,
    videoElement: elements.tidVideo,
    resolveAsset: async (assetId) => {
      const asset = translationResources?.mediaManifest?.[assetId];
      if (!asset) return null;
      const response = await fetch(new URL(asset.path.replace(/^\/+/, ''), translationResources.publicBaseUrl), { credentials: 'same-origin' });
      if (!response.ok) return null;
      return {
        ...asset,
        bytes: await response.arrayBuffer(),
        mediaType: response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '',
      };
    },
  });
  tidOutput = createTidOutputController({
    input: elements.heardText,
    confirmButton: elements.confirmTurkish,
    playButton: elements.playTid,
    stopButton: elements.stopTid,
    retryButton: elements.retryTid,
    repeatButton: elements.repeatTid,
    stepButton: elements.stepTid,
    sourceText: elements.tidSource,
    status: elements.tidStatus,
    gloss: elements.tidGloss,
    progress: elements.tidProgress,
    player: translationPlayer,
    translateText: (text) => {
      if (!translationResources) throw new Error('translation_resources_unavailable');
      return createTidDisplayPlan(text, translationResources);
    },
    onMediaSegment: (segment, progress) => {
      if (progress.result) {
        elements.tidVideo.hidden = true;
        elements.avatarStage.hidden = false;
        elements.letterCardStage.hidden = true;
        elements.avatarStatus.textContent = progress.result.status === 'completed'
          ? 'Gösterim tamamlandı'
          : progress.result.status === 'error' ? 'Gösterim hazırlanamadı' : 'Gösterim durdu';
      } else {
        const showCards = ['letter-card', 'unsupported'].includes(segment.kind);
        const showVideo = segment.kind === 'video';
        elements.tidVideo.hidden = !showVideo;
        elements.avatarStage.hidden = showVideo || showCards;
        elements.letterCardStage.hidden = !showCards;
        if (showCards) renderLetterCards(elements.letterCardStage, [segment]);
        elements.avatarStatus.textContent = showVideo ? 'Onaylı video oynatılıyor' : showCards ? 'Harf kartı gösteriliyor' : 'Sözlük pozu oynatılıyor';
      }
    },
    onRetry: () => loadTranslationResources({ retryCurrentText: true }),
  });
  elements.playbackSpeed.addEventListener('change', () => {
    const rate = Number(elements.playbackSpeed.value);
    if (Number.isFinite(rate)) {
      elements.tidVideo.playbackRate = rate;
      avatar?.setPlaybackRate?.(rate);
    }
  });
}

function renderPwaStatus() {
  const offlineMessage = navigator.onLine
    ? ''
      : 'Çevrimdışı kullanımda daha önce indirilmiş onaylı TİD içeriği kullanılabilir. Mikrofon tanıma internet gerektirebilir.';
  const message = [pwaStatusMessage, offlineMessage].filter(Boolean).join(' ');
  elements.pwaStatus.textContent = message;
  elements.pwaStatus.hidden = !message;
}

function setPwaStatus(message) {
  pwaStatusMessage = message;
  renderPwaStatus();
}

function waitForServiceWorkerControl(timeoutMs = 5000) {
  if (navigator.serviceWorker.controller) return Promise.resolve(true);

  return new Promise((resolve) => {
    let timeoutId;
    const finish = (controlled) => {
      window.clearTimeout(timeoutId);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      resolve(controlled);
    };
    const onControllerChange = () => {
      if (navigator.serviceWorker.controller) finish(true);
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    if (navigator.serviceWorker.controller) {
      finish(true);
      return;
    }
    timeoutId = window.setTimeout(() => finish(Boolean(navigator.serviceWorker.controller)), timeoutMs);
  });
}

function initializePwa() {
  updateNetworkStatus();
  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);
  if (!('serviceWorker' in navigator)) {
    setPwaStatus('Bu tarayıcı çevrimdışı uygulama kurulumunu desteklemiyor. Metinle kullanım devam eder.');
    loadAvatar();
    return;
  }

  return navigator.serviceWorker.register('./service-worker.js')
    .then(async () => {
      const controlled = await waitForServiceWorkerControl();
      setPwaStatus(controlled
            ? 'Uygulama çevrimdışı açılış için hazır. Kurulum HTTPS bağlantısında yapılır; onaylı TİD medya dosyaları varsa ilk oynatımda indirilir.'
            : 'Çevrimdışı önbellek kurulumu zaman aldı. Onaylı içerik çevrimdışı olmayabilir; yeniden denemek için sayfayı yenileyin.');
    })
    .catch(() => {
      setPwaStatus('Çevrimdışı açılış ayarı yapılamadı. Kurulum için HTTPS gerekir; metinle kullanım devam eder.');
    })
    .finally(loadAvatar);
}

initializeTidOutput();
initializePrivacyModes();
void loadTranslationResources();
elements.avatarRetry.addEventListener('click', loadAvatar);

Promise.resolve(initializePwa()).finally(() => { void initializeCameraTools(); });
initializeSpeechRecognition();
initializeTextActions();
initializeTextToSpeech();
updateCharacterCount();




