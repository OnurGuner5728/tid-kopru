import { SignAvatar } from './avatar.mjs';
import { loadTidTranslationResources } from './tid-transfer.mjs';
import { createTidMediaPlayer } from './tid-media-player.mjs';
import { createTidOutputController } from './tid-output-ui.mjs';
import { SignRecognitionClient } from './sign-recognition.mjs';
import { downloadCameraModel } from './onnx-runtime-loader.mjs';
import { translateTidGlossToTurkish } from './tid-transfer.mjs';
import { TRANSLATION_MODES, createPrivacyModeController, stopMediaStream } from './privacy-mode.mjs';
import { createCloudSession } from './cloud-session.mjs';
import { createLandmarkRuntime, verifyRuntimeManifestFiles } from './landmark-runtime.mjs';
import { createPersonalSignStore } from './personal-sign-store.mjs';
import { createPersonalTrainer } from './personal-training.mjs';
import { createPersonalRecognitionBackend, personalPhraseLabel, personalPhraseText } from './personal-sign-recognizer.mjs';
import { createHybridRecognizer } from './hybrid-recognition.mjs';
import { createNvidiaCandidateProvider } from './nvidia-candidate.mjs';
import { createTidDisplayPlan } from './tid-display-plan.mjs';
import { renderLetterCards } from './letter-cards.mjs';
import { createAppStateMachine } from './app-state.mjs';
import { createMediaCaptureRegistry } from './media-capture-registry.mjs';
import { requestCameraWithTimeout, cameraStartMessage } from './camera-permission.mjs';

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
  teachingCustomText: document.querySelector('#teaching-custom-text'),
  teachingRecord: document.querySelector('#teaching-record'),
  teachingDelete: document.querySelector('#teaching-delete'),
  teachingClear: document.querySelector('#teaching-clear'),
  teachingStatus: document.querySelector('#teaching-status'),
  teachingStorageStatus: document.querySelector('#teaching-storage-status'),
  letterCardStage: document.querySelector('#letter-card-stage'),
  playbackSpeed: document.querySelector('#playback-speed'),
  repeatTid: document.querySelector('#repeat-tid'),
  stepTid: document.querySelector('#step-tid'),
};

let recognition;
let speechErrorMessage = '';
let listening = false;
let recognitionBase = '';
let cancelSpeechStartup = () => {};
let avatar;
let translationResources;
let translationPlayer;
let tidOutput;
let pwaStatusMessage = '';
let cameraManifest = null;
let cameraClient = null;
let cameraInstalled = false;
let cameraCandidateReady = false;
let speakApprovedText = () => false;
let privacyController;
const cloudSession = createCloudSession();
const personalStore = createPersonalSignStore();
const captureRegistry = createMediaCaptureRegistry();
let landmarkRuntime;
let personalTrainer;
let personalBackend;
let runtimeReady = false;
let privacyDisposed = false;
let activeCameraStream = null;
let activeTeachingStream = null;
let teachingCapturePending = false;
let cameraClientCapturing = false;
let activeRecognitionController = null;
let capturedFrames = [];
let mediaRecorder = null;
let mediaRecorderDataHandler = null;
let recordedChunks = [];
let cloudClip = null;
let discardRecorderOutput = false;
const appState = createAppStateMachine({ onChange: (state) => document.body.dataset.appState = state });

function initializePrivacyModes() {
  privacyController = createPrivacyModeController({
    onChange: ({ mode, cloudConsent }) => {
      elements.modeInputs.forEach((input) => { input.checked = input.value === mode; });
      elements.cloudConsent.disabled = mode === TRANSLATION_MODES.LOCAL;
      elements.cloudConsent.checked = cloudConsent;
      elements.cloudDisclosure.innerHTML = cloudConsent
        ? '<strong>Bulut:</strong> Bu oturum için açık. Kısa klip yalnızca yerel güven düşükse gönderilir.'
        : '<strong>Bulut:</strong> Kapalı. Hiçbir kamera klibi gönderilmez.';
    },
    onDispose: () => {
      privacyDisposed = true;
      runtimeReady = false;
      elements.modeInputs.forEach((input) => { input.disabled = true; });
      elements.cloudConsent.disabled = true;
      elements.micButton.disabled = true;
      elements.teachingRecord.disabled = true;
      elements.cameraStart.disabled = true;
      elements.cameraFinish.disabled = true;
      elements.cameraStop.disabled = true;
      elements.cameraDownload.disabled = true;
      elements.cameraStatus.textContent = 'Gizlilik için kamera ve mikrofon kapatıldı. Yeniden kullanmak için sayfayı yenileyin.';
      elements.pwaStatus.textContent = 'Bu sayfa gizlilik nedeniyle medya kaynaklarını kapattı. Kullanıma devam etmek için sayfayı yenileyin.';
      elements.pwaStatus.hidden = false;
      if (appState.getState() !== 'idle') appState.transition('idle');
    },
    onSuspend: () => {
      cancelSpeechStartup();
      try { recognition?.abort?.(); } catch { /* speech may already be closed */ }
      listening = false;
      setListeningState(false, 'Sekme arka plana geçti; mikrofon kapatıldı. Yeniden başlatabilirsiniz.');
      activeRecognitionController?.abort('page_hidden');
      activeRecognitionController = null;
      landmarkRuntime?.stopCapture();
      captureRegistry.cancel('camera');
      captureRegistry.cancel('teaching');
      stopMediaStream(activeCameraStream);
      stopMediaStream(activeTeachingStream);
      activeCameraStream = null;
      activeTeachingStream = null;
      teachingCapturePending = false;
      discardMediaRecording();
      capturedFrames = [];
      recordedChunks = [];
      cloudClip = null;
      cloudSession.clearKey();
      elements.cameraPreview.pause?.();
      elements.cameraPreview.srcObject = null;
      elements.cameraPreview.hidden = true;
      if (appState.getState() !== 'idle') appState.transition('idle');
      elements.cameraStatus.textContent = 'Sekme arka plana geçtiği için kamera kapatıldı. Geri döndüğünüzde yeniden açabilirsiniz.';
      elements.cloudKeyStatus.textContent = 'Sekme arka plana geçtiği için bulut anahtarı temizlendi.';
      refreshCameraControls();
      refreshTeachingControls();
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
    cancelSpeechStartup();
    try { recognition?.abort?.(); } catch { /* recognition may already be closed */ }
    globalThis.speechSynthesis?.cancel?.();
    activeRecognitionController?.abort('page_hidden');
    activeRecognitionController = null;
    void cameraClient?.abortCapture('page_hidden');
    void cameraClient?.dispose();
    cameraClient = null;
    cameraInstalled = false;
    cameraClientCapturing = false;
    landmarkRuntime?.stopCapture();
    void landmarkRuntime?.dispose();
    captureRegistry.dispose();
    discardMediaRecording();
    cloudClip = null;
    recordedChunks = [];
    capturedFrames = [];
    activeCameraStream = null;
    activeTeachingStream = null;
    elements.cameraPreview.pause?.();
    elements.cameraPreview.srcObject = null;
    elements.cameraPreview.hidden = true;
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
  let startTimer = null;
  const clearStartTimer = () => { if (startTimer) clearTimeout(startTimer); startTimer = null; };
  cancelSpeechStartup = clearStartTimer;

  recognition.addEventListener('start', () => {
    clearStartTimer();
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
  recognition.addEventListener('end', () => {
    clearStartTimer();
    setListeningState(false, speechErrorMessage || 'Hazır');
  });
  recognition.addEventListener('error', (event) => {
    clearStartTimer();
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
      clearStartTimer();
      try { recognition.stop(); } catch { recognition.abort(); }
      setListeningState(false, 'Dinleme durduruldu.');
      return;
    }
    recognitionBase = elements.heardText.value.trim();
    try {
      setListeningState(true, 'Mikrofon açılıyor…');
      startTimer = setTimeout(() => {
        startTimer = null;
        speechErrorMessage = 'Konuşma tanıma yanıt vermedi. Tarayıcı izinlerini kontrol edin veya metni elle yazın.';
        try { recognition.abort(); } catch { /* browser may have already closed speech */ }
        setListeningState(false, speechErrorMessage);
      }, 10000);
      recognition.start();
    } catch (error) {
      clearStartTimer();
      console.error('speech_start_failed', error?.name, error?.message);
      setListeningState(false, error?.name === 'NotAllowedError'
        ? 'Mikrofon izni verilmedi. Tarayıcı izinlerini açın veya metni elle yazın.'
        : error?.name === 'InvalidStateError'
          ? 'Mikrofon işlemi zaten açık. Birkaç saniye sonra yeniden deneyin.'
          : 'Bu tarayıcı konuşma tanımayı başlatamadı. Metni elle yazabilirsiniz.');
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

  function speakText(text) {
    if (!text) {
      elements.ttsStatus.textContent = 'Önce seslendirilecek yanıtı yazın.';
      elements.replyText.focus();
      return false;
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
    return true;
  }
  elements.speakButton.addEventListener('click', () => speakText(elements.replyText.value.trim()));
  elements.stopSpeech.addEventListener('click', () => {
    speechSynthesis.cancel();
    elements.speakButton.disabled = false;
    elements.ttsStatus.textContent = 'Seslendirme durduruldu.';
  });
  return speakText;
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
    await populateTeachingLabels();
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
  elements.cameraStart.disabled = privacyDisposed || !runtimeReady || busy || teachingCapturePending || Boolean(activeTeachingStream);
  elements.cameraFinish.disabled = privacyDisposed || appState.getState() !== 'capturing';
  elements.cameraStop.disabled = privacyDisposed || !['requesting-permission', 'capturing', 'processing'].includes(appState.getState());
  elements.cameraDownload.hidden = cameraManifest?.available !== true;
  elements.cameraDownload.disabled = privacyDisposed || cameraManifest?.available !== true || cameraInstalled;
}

function sourceLabel(source) {
  return ({ personal: 'Kişisel cihaz içi eşleşme', 'verified-onnx': 'Doğrulanmış yerel model adayı', 'cloud-candidate': 'NVIDIA bulut adayı', 'reviewed-mapping': 'Uzman onaylı gloss eşlemesi', manual: 'Tanıma başarısız · elle girilen metin' })[source] ?? 'Aday bulunamadı';
}

function renderCameraCandidate(result) {
  cameraCandidateReady = false;
  elements.cameraCandidateText.value = '';
  elements.cameraCandidateText.disabled = true;
  elements.cameraEdit.disabled = true;
  elements.cameraConfirm.disabled = true;
  elements.cameraCandidateSource.textContent = sourceLabel(result?.source);
  if (!result?.text || result.reason === 'anlaşılamadı') {
    cameraCandidateReady = true;
    elements.cameraCandidateText.disabled = false;
    elements.cameraCandidateSource.textContent = sourceLabel('manual');
    elements.cameraCandidateText.placeholder = 'İşaret anlaşılamadı. Gördüğünüz ifadeyi biliyorsanız buraya yazın.';
    appState.transition('idle');
    elements.cameraStatus.textContent = 'Güvenilir eşleşme bulunamadı. İfadeyi biliyorsanız elle yazıp seslendirebilir veya yeniden deneyebilirsiniz.';
    refreshCameraControls();
    return;
  }
  elements.cameraCandidateText.value = result.text;
  elements.cameraCandidateText.placeholder = 'Gerekirse metni düzeltin.';
  elements.cameraEdit.disabled = false;
  elements.cameraConfirm.disabled = false;
  cameraCandidateReady = true;
  appState.transition('candidate');
  elements.cameraStatus.textContent = `${sourceLabel(result.source)} hazır. Sonucu kontrol edin; yalnızca onayınızla yanıt alanına aktarılır.`;
  refreshCameraControls();
}

function clearCameraCandidate() {
  cameraCandidateReady = false;
  elements.cameraCandidateText.value = '';
  elements.cameraCandidateText.disabled = true;
  elements.cameraEdit.disabled = true;
  elements.cameraConfirm.disabled = true;
  elements.cameraCandidateSource.textContent = 'Henüz aday yok.';
}

function stopStream(stream = activeCameraStream) {
  if (stream && stream === activeCameraStream) {
    captureRegistry.cancel('camera');
    activeCameraStream = null;
    void cameraClient?.abortCapture('capture_stopped');
    cameraClientCapturing = false;
  } else if (stream && stream === activeTeachingStream) {
    captureRegistry.cancel('teaching');
    activeTeachingStream = null;
  } else {
    stopMediaStream(stream);
  }
  if (!stream || elements.cameraPreview.srcObject === stream) {
    elements.cameraPreview.srcObject = null;
    elements.cameraPreview.hidden = true;
  }
}

function finishRecorder() {
  if (!mediaRecorder) return Promise.resolve(cloudClip);
  if (mediaRecorder.state === 'inactive') {
    cloudClip = discardRecorderOutput ? null : recordedChunks.length ? new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'video/webm' }) : null;
    recordedChunks = [];
    return Promise.resolve(cloudClip);
  }
  const recorder = mediaRecorder;
  return new Promise((resolve) => {
    recorder.addEventListener('stop', () => {
      cloudClip = discardRecorderOutput ? null : recordedChunks.length ? new Blob(recordedChunks, { type: recorder.mimeType || 'video/webm' }) : null;
      recordedChunks = [];
      if (mediaRecorder === recorder) {
        mediaRecorder = null;
        mediaRecorderDataHandler = null;
      }
      resolve(cloudClip);
    }, { once: true });
    recorder.stop();
  });
}

function discardMediaRecording() {
  discardRecorderOutput = true;
  const recorder = mediaRecorder;
  if (recorder && mediaRecorderDataHandler) recorder.removeEventListener('dataavailable', mediaRecorderDataHandler);
  mediaRecorderDataHandler = null;
  if (recorder?.state !== 'inactive') {
    try { recorder.stop(); } catch { /* its camera track may already have stopped */ }
  }
  mediaRecorder = null;
  recordedChunks = [];
  cloudClip = null;
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

async function recognizeCapturedUtterance(onnxCandidate = null) {
  const privacy = privacyController.getState();
  const controller = new AbortController();
  activeRecognitionController = controller;
  try {
    const cloudBackend = privacy.mode === TRANSLATION_MODES.CLOUD_ASSISTED && privacy.cloudConsent
      ? await cloudCandidateBackend()
      : null;
    const recognizer = createHybridRecognizer({
      personalBackend,
      onnxBackend: onnxCandidate?.source === 'verified-onnx' ? { recognize: async () => onnxCandidate } : null,
      cloudBackend,
      translateGlosses: (events) => translateTidGlossToTurkish(events, translationResources?.glossToTurkish),
    });
    return await recognizer.recognize({ frames: capturedFrames, blob: cloudClip }, { ...privacy, signal: controller.signal });
  } finally {
    if (activeRecognitionController === controller) activeRecognitionController = null;
  }
}

async function populateTeachingLabels(selectedLabel = '') {
  const names = Object.keys(avatar?.poses ?? {}).sort((left, right) => left.localeCompare(right, 'tr'));
  const phrases = (await personalStore.listLabels()).filter((label) => personalPhraseText(label) !== null);
  elements.teachingLabel.replaceChildren(new Option('İşaret veya kayıtlı cümle seçin', ''), ...names.map((name) => new Option(name, name)), ...phrases.map((label) => new Option(`Cümle: ${personalPhraseText(label)}`, label)));
  elements.teachingLabel.value = selectedLabel;
  elements.teachingStatus.textContent = `${names.length} sözlük işareti ve ${phrases.length} kişisel cümle seçilebilir. Her biri için en az üç örnek kaydedin.`;
  void updatePersonalStorageStatus();
}

function teachingTarget() {
  const customText = elements.teachingCustomText.value.trim();
  return customText ? personalPhraseLabel(customText) : elements.teachingLabel.value;
}

function refreshTeachingControls() {
  const target = teachingTarget();
  elements.teachingRecord.disabled = privacyDisposed || !runtimeReady || teachingCapturePending || !target;
  elements.teachingDelete.disabled = privacyDisposed || !target;
  return target;
}

async function updatePersonalStorageStatus() {
  const mode = await personalStore.getStorageMode();
  elements.teachingStorageStatus.textContent = mode === 'device'
    ? 'Saklama: kişisel örnekler bu cihazda kalıcı olarak tutuluyor.'
    : 'Saklama: tarayıcı kalıcı depolamayı açamadı; örnekler yalnızca bu oturumda kalır ve sayfa kapanınca silinir.';
}

async function initializeCameraTools() {
  elements.cameraCandidateText.addEventListener('input', () => {
    elements.cameraConfirm.disabled = !cameraCandidateReady || !elements.cameraCandidateText.value.trim();
  });
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
    if (speakApprovedText(text)) {
      elements.cameraStatus.textContent = 'Onayladığınız metin Türkçe seslendiriliyor.';
    } else {
      elements.cameraStatus.textContent = 'Seslendirme bu tarayıcıda kullanılamıyor; metin yanıt alanına aktarıldı.';
    }
  });

  elements.cameraDownload.addEventListener('click', async () => {
    if (!cameraManifest?.available || cameraInstalled) return;
    elements.cameraDownload.disabled = true;
    try {
      await downloadCameraModel(cameraManifest, { origin: location.origin, baseUrl: new URL('./', location.href).href, onProgress: ({ percent }) => { elements.cameraProgress.textContent = `${percent}% doğrulandı`; } });
      if (privacyDisposed) return;
      cameraClient = new SignRecognitionClient({ videoElement: elements.cameraPreview, pageTarget: window });
      await cameraClient.load({ manifest: cameraManifest, onProgress: ({ percent }) => { elements.cameraProgress.textContent = `${percent}% model hazırlandı`; } });
      if (privacyDisposed) {
        void cameraClient?.dispose();
        cameraClient = null;
        return;
      }
      cameraInstalled = true;
      elements.cameraStatus.textContent = 'İsteğe bağlı yerel cümle modeli doğrulandı ve kullanıma hazır.';
    } catch {
      void cameraClient?.dispose();
      cameraClient = null;
      cameraInstalled = false;
      if (!privacyDisposed) elements.cameraStatus.textContent = 'İsteğe bağlı model indirilemedi; kişisel cihaz içi tanıma kullanılabilir.';
    }
    refreshCameraControls();
  });

  elements.cameraStart.addEventListener('click', async () => {
    if (privacyDisposed || !runtimeReady || teachingCapturePending || ['requesting-permission', 'capturing', 'processing'].includes(appState.getState()) || activeTeachingStream) return;
    clearCameraCandidate();
    const requestToken = captureRegistry.begin('camera');
    appState.transition('requesting-permission');
    refreshCameraControls();
    elements.cameraStatus.textContent = 'Kamera izni bekleniyor…';
    let cameraStage = 'getUserMedia';
    try {
      const stream = await requestCameraWithTimeout(navigator.mediaDevices, { audio: false, video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } } });
      if (!captureRegistry.accept('camera', requestToken, stream)) return;
      cameraStage = 'preview';
      activeCameraStream = stream;
      elements.cameraPreview.srcObject = activeCameraStream;
      elements.cameraPreview.hidden = false;
      await elements.cameraPreview.play();
      if (!captureRegistry.isCurrent('camera', requestToken)) return;
      cameraStage = 'landmarks';
      capturedFrames = [];
      cloudClip = null;
      recordedChunks = [];
      const privacy = privacyController.getState();
      if (privacy.mode === TRANSLATION_MODES.CLOUD_ASSISTED && privacy.cloudConsent && typeof MediaRecorder === 'function') {
        mediaRecorder = new MediaRecorder(activeCameraStream, { mimeType: MediaRecorder.isTypeSupported?.('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8' : 'video/webm' });
        discardRecorderOutput = false;
        mediaRecorderDataHandler = ({ data }) => { if (data?.size) recordedChunks.push(data); };
        mediaRecorder.addEventListener('dataavailable', mediaRecorderDataHandler);
        mediaRecorder.start(250);
      }
      if (cameraClient && privacy.mode !== TRANSLATION_MODES.LOCAL) {
        try {
          await cameraClient.startUtterance({ userInitiated: true, stream: activeCameraStream });
          cameraClientCapturing = true;
        } catch {
          if (!privacyDisposed && captureRegistry.isCurrent('camera', requestToken)) {
            elements.cameraProgress.textContent = 'Yerel cümle modeli açılamadı; kişisel cihaz içi tanıma kullanılacak.';
          }
        }
      }
      if (!captureRegistry.isCurrent('camera', requestToken)) return;
      await landmarkRuntime.startCapture(elements.cameraPreview, (frame, error) => {
        if (frame) capturedFrames.push(frame);
        if (error) elements.cameraProgress.textContent = 'Bir kamera karesi işlenemedi; kayıt sürüyor.';
      });
      if (!captureRegistry.isCurrent('camera', requestToken)) {
        landmarkRuntime.stopCapture();
        return;
      }
      appState.transition('capturing');
      elements.cameraStatus.textContent = 'İşaretinizi yapın, sonra “İşareti bitir” düğmesine basın.';
    } catch (error) {
      const wasCancelled = privacyDisposed || !captureRegistry.isCurrent('camera', requestToken);
      captureRegistry.cancel('camera');
      stopStream();
      if (wasCancelled) return;
      appState.transition('error');
      console.error('camera_start_failed', cameraStage, error?.name, error?.message);
      elements.cameraStatus.textContent = cameraStartMessage(cameraStage, error);
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
    if (privacyDisposed || appState.getState() !== 'processing') return;
    let onnxCandidate = null;
    if (cameraClientCapturing) {
      cameraClientCapturing = false;
      try { onnxCandidate = await cameraClient.stopCapture(); } catch { /* personal recognition remains available */ }
    }
    if (privacyDisposed || appState.getState() !== 'processing') return;
    stopStream();
    try {
      const result = await recognizeCapturedUtterance(onnxCandidate);
      if (!privacyDisposed && appState.getState() === 'processing') renderCameraCandidate(result);
    } catch {
      if (!privacyDisposed && appState.getState() === 'processing') renderCameraCandidate({ reason: 'anlaşılamadı', source: 'none' });
    } finally {
      cloudClip = null;
      recordedChunks = [];
      capturedFrames = [];
    }
  });

  elements.cameraStop.addEventListener('click', async () => {
    activeRecognitionController?.abort('capture_stopped');
    activeRecognitionController = null;
    landmarkRuntime?.stopCapture();
    captureRegistry.cancel('camera');
    discardMediaRecording();
    stopStream();
    clearCameraCandidate();
    appState.transition('idle');
    elements.cameraStatus.textContent = 'Kamera durduruldu; kayıt ve aday silindi.';
    refreshCameraControls();
  });

  elements.teachingLabel.addEventListener('change', async () => {
    elements.teachingCustomText.value = '';
    const label = refreshTeachingControls();
    if (label && personalTrainer) {
      const progress = await personalTrainer.getProgress(label);
      elements.teachingStatus.textContent = `${personalPhraseText(label) ?? label}: ${progress.sampleCount} / ${progress.minSamples} örnek${progress.ready ? ' · tanımaya hazır' : ''}`;
    }
  });
  elements.teachingCustomText.addEventListener('input', () => {
    if (elements.teachingCustomText.value.trim()) elements.teachingLabel.value = '';
    refreshTeachingControls();
  });
  elements.teachingRecord.addEventListener('click', async () => {
    const label = teachingTarget();
    if (privacyDisposed || !label || !runtimeReady || activeCameraStream || ['requesting-permission', 'capturing', 'processing'].includes(appState.getState())) return;
    const requestToken = captureRegistry.begin('teaching');
    teachingCapturePending = true;
    elements.teachingRecord.disabled = true;
    refreshCameraControls();
    elements.teachingStatus.textContent = 'Kamera izni bekleniyor; işareti doğal hızınızda yapın…';
    let stream;
    try {
      stream = await requestCameraWithTimeout(navigator.mediaDevices, { audio: false, video: { facingMode: 'user' } });
      if (!captureRegistry.accept('teaching', requestToken, stream)) return;
      activeTeachingStream = stream;
      elements.cameraPreview.srcObject = stream;
      elements.cameraPreview.hidden = false;
      await elements.cameraPreview.play();
      if (!captureRegistry.isCurrent('teaching', requestToken)) return;
      const frames = await landmarkRuntime.captureSample({ video: elements.cameraPreview, durationMs: personalPhraseText(label) === null ? 1800 : 5000 });
      if (!captureRegistry.isCurrent('teaching', requestToken)) return;
      const result = await personalTrainer.addSample(label, frames);
      if (personalPhraseText(label) !== null) {
        await populateTeachingLabels(label);
        elements.teachingCustomText.value = '';
      }
      elements.teachingStatus.textContent = `${personalPhraseText(label) ?? label}: ${result.sampleCount} / ${result.minSamples} örnek · kalite ${result.quality}${result.ready ? ' · tanımaya hazır' : ''}`;
    } catch (error) {
      if (captureRegistry.isCurrent('teaching', requestToken) && !privacyDisposed) {
        elements.teachingStatus.textContent = cameraStartMessage('getUserMedia', error);
      }
    } finally {
      stopStream(stream);
      teachingCapturePending = false;
      refreshTeachingControls();
      refreshCameraControls();
      if (!privacyDisposed) await updatePersonalStorageStatus();
    }
  });
  elements.teachingDelete.addEventListener('click', async () => {
    const label = teachingTarget();
    if (!label) return;
    await personalTrainer.deleteLabel(label);
    if (personalPhraseText(label) !== null) await populateTeachingLabels();
    elements.teachingStatus.textContent = `${personalPhraseText(label) ?? label} için kişisel örnekler silindi.`;
    refreshTeachingControls();
  });
  elements.teachingClear.addEventListener('click', async () => {
    await personalTrainer.clear();
    elements.teachingCustomText.value = '';
    await populateTeachingLabels();
    refreshTeachingControls();
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
    if (privacyDisposed) {
      await landmarkRuntime.dispose();
      return;
    }
    personalTrainer = createPersonalTrainer({ runtime: landmarkRuntime, store: personalStore, minSamples: 3 });
    personalBackend = createPersonalRecognitionBackend({ store: personalStore });
    runtimeReady = true;
    elements.cameraStatus.textContent = 'Kamera hareket izleme hazır. Tanıma için önce bir işareti üç kez öğretin; sözlük pozları kameradan tanınan işaretler değildir.';
    populateTeachingLabels();
  } catch (error) {
    console.error('camera_runtime_init_failed', error?.code ?? error?.message, JSON.stringify(error?.detail ?? null));
    if (!privacyDisposed) {
      appState.transition('error');
      elements.cameraStatus.textContent = 'Yerel kamera çalışma zamanı hazırlanamadı. Sayfayı yenileyip yeniden deneyin.';
    }
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
    autoPlayOnConfirm: true,
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
speakApprovedText = initializeTextToSpeech() ?? (() => false);
updateCharacterCount();




