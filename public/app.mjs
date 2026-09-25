import { SignAvatar } from './avatar.mjs';
import { loadTidTranslationResources, translateTurkishToTid } from './tid-transfer.mjs';
import { createTidMediaPlayer } from './tid-media-player.mjs';
import { createTidOutputController } from './tid-output-ui.mjs';
import { SignRecognitionClient } from './sign-recognition.mjs';
import { downloadCameraModel } from './onnx-runtime-loader.mjs';
import { translateTidGlossToTurkish } from './tid-transfer.mjs';
import { TRANSLATION_MODES, createPrivacyModeController } from './privacy-mode.mjs';

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
  cameraEdit: document.querySelector('#camera-edit'),
  cameraConfirm: document.querySelector('#camera-confirm'),
  modeInputs: [...document.querySelectorAll('[name="translation-mode"]')],
  cloudConsent: document.querySelector('#cloud-consent'),
  cloudDisclosure: document.querySelector('#cloud-disclosure'),
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
  privacyController.registerDisposer(() => {
    try { recognition?.abort?.(); } catch { /* recognition may already be closed */ }
    globalThis.speechSynthesis?.cancel?.();
    void cameraClient?.dispose();
    cameraClient = null;
    cameraInstalled = false;
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
    refreshCameraControls();
    tidOutput?.setIdle();
    if (retryCurrentText && elements.heardText.value.trim()) await tidOutput?.confirm();
  } catch {
    translationResources = null;
    refreshCameraControls();
    tidOutput?.setError('Onaylı TİD içerik listesi yüklenemedi. Bağlantıyı kontrol edip yeniden deneyin; Türkçe metniniz düzenlenebilir durumda.');
  }
}

function canUseCameraTranslations() {
  const reverse = translationResources?.glossToTurkish;
  if (!cameraManifest?.available || !reverse || reverse.contentVersion !== cameraManifest.contentVersion
      || !Array.isArray(reverse.vocabulary) || reverse.vocabulary.length === 0) return false;
  return cameraManifest.vocabulary.every((gloss) => reverse.vocabulary.includes(gloss));
}

function refreshCameraControls() {
  const modelAvailable = cameraManifest?.available === true;
  const contentAvailable = canUseCameraTranslations();
  elements.cameraDownload.disabled = !modelAvailable || !contentAvailable || cameraInstalled;
  elements.cameraStart.disabled = !modelAvailable || !contentAvailable || !cameraInstalled;
  if (modelAvailable && !contentAvailable) {
    elements.cameraStatus.textContent = 'Bu model için iki uzman tarafından onaylanmış gloss→Türkçe eşleşmesi bulunmuyor. Çeviri için tahmin üretilmeyecek.';
  }
}

function renderCameraCandidate(result) {
  cameraCandidateReady = false;
  elements.cameraCandidateText.value = '';
  elements.cameraCandidateText.disabled = true;
  elements.cameraEdit.disabled = true;
  elements.cameraConfirm.disabled = true;
  if (result.status !== 'ready') {
    elements.cameraStatus.textContent = 'Bu işaret dizisi için onaylı bir Türkçe karşılık bulunamadı. Yanıt alanı değiştirilmedi.';
    return;
  }
  elements.cameraCandidateText.value = result.text;
  elements.cameraCandidateText.disabled = true;
  elements.cameraEdit.disabled = false;
  elements.cameraConfirm.disabled = false;
  cameraCandidateReady = true;
  elements.cameraStatus.textContent = 'Türkçe aday hazır. Gerekirse düzeltin; yanıt alanına yalnızca onayınızla aktarılır.';
}

function showCameraRecognitionCandidate(candidate) {
  const reverse = translationResources?.glossToTurkish;
  if (!reverse || reverse.contentVersion !== candidate.contentVersion) {
    renderCameraCandidate({ status: 'unsupported' });
    return;
  }
  renderCameraCandidate(translateTidGlossToTurkish(candidate.glossEvents, reverse));
}

async function initializeCameraTools() {
  elements.cameraDownload.addEventListener('click', async () => {
    if (!cameraManifest?.available || !canUseCameraTranslations() || cameraClient) return;
    elements.cameraDownload.disabled = true;
    elements.cameraStatus.textContent = 'Model ve çalışma zamanı hash doğrulaması yapılıyor…';
    try {
      await downloadCameraModel(cameraManifest, {
        origin: location.origin,
        onProgress: ({ percent, path }) => {
          elements.cameraProgress.textContent = `${percent}% doğrulandı · ${path.split('/').at(-1)}`;
        },
      });
      cameraClient = new SignRecognitionClient({
        origin: location.origin,
        mediaDevices: navigator.mediaDevices,
        videoElement: elements.cameraPreview,
        pageTarget: window,
      });
      await cameraClient.load({
        manifest: cameraManifest,
        onProgress: ({ percent }) => { elements.cameraProgress.textContent = `${percent}% doğrulandı`; },
      });
      cameraInstalled = true;
      elements.cameraStatus.textContent = `Model ${cameraManifest.modelVersion} doğrulandı. Kamerayı yalnızca aşağıdaki düğmeyle açabilirsiniz.`;
      refreshCameraControls();
    } catch {
      await cameraClient?.dispose();
      cameraClient = null;
      cameraInstalled = false;
      elements.cameraStatus.textContent = 'Model kurulamadı veya doğrulanamadı. Kamera kapalı kaldı; bağlantı ve depolama alanını kontrol edip yeniden deneyin.';
      elements.cameraDownload.disabled = false;
    }
  });

  elements.cameraStart.addEventListener('click', async () => {
    if (!cameraClient || !cameraInstalled || !canUseCameraTranslations()) return;
    cameraCandidateReady = false;
    elements.cameraCandidateText.value = '';
    elements.cameraCandidateText.disabled = true;
    elements.cameraEdit.disabled = true;
    elements.cameraConfirm.disabled = true;
    elements.cameraStart.disabled = true;
    elements.cameraStatus.textContent = 'Kamera izni isteniyor. Görüntü yalnızca yerel çalışma hattına aktarılır; MediaPipe ölçüm bildirimi yukarıdadır.';
    try {
      await cameraClient.startUtterance({
        userInitiated: true,
        onCandidate: showCameraRecognitionCandidate,
        onRejected: () => {
          renderCameraCandidate({ status: 'unsupported' });
        },
        onError: () => {
          const failedClient = cameraClient;
          cameraClient = null;
          cameraInstalled = false;
          void failedClient?.dispose();
          elements.cameraStatus.textContent = 'Tanıma durdu. Kamera bağlantısı kapatıldı; yanıt alanı değiştirilmedi.';
          elements.cameraFinish.disabled = true;
          elements.cameraStop.disabled = true;
          elements.cameraPreview.hidden = true;
          refreshCameraControls();
        },
      });
      elements.cameraPreview.hidden = false;
      elements.cameraFinish.disabled = false;
      elements.cameraStop.disabled = false;
      elements.cameraStatus.textContent = 'İşaret ederken “İşareti bitir” düğmesine basın; dilediğiniz an Durdur seçeneğini kullanabilirsiniz.';
    } catch {
      elements.cameraStatus.textContent = 'Kamera açılamadı veya izin verilmedi. Hiçbir metin yanıt alanına aktarılmadı.';
      elements.cameraPreview.hidden = true;
      refreshCameraControls();
    }
  });

  elements.cameraFinish.addEventListener('click', async () => {
    if (!cameraClient) return;
    elements.cameraFinish.disabled = true;
    elements.cameraStatus.textContent = 'İşaret dizisi yerel olarak değerlendiriliyor…';
    await cameraClient.stopCapture();
    elements.cameraPreview.hidden = true;
    elements.cameraStop.disabled = true;
    refreshCameraControls();
  });

  elements.cameraStop.addEventListener('click', async () => {
    await cameraClient?.abortCapture();
    elements.cameraPreview.hidden = true;
    elements.cameraFinish.disabled = true;
    elements.cameraStop.disabled = true;
    elements.cameraStatus.textContent = 'Kamera durduruldu. Yanıt alanı değiştirilmedi.';
    refreshCameraControls();
  });

  elements.cameraEdit.addEventListener('click', () => {
    if (!cameraCandidateReady) return;
    elements.cameraCandidateText.disabled = false;
    elements.cameraCandidateText.focus();
    elements.cameraStatus.textContent = 'Adayı düzeltebilirsiniz. Değişiklik yanıt alanına yalnızca onayla aktarılır.';
  });

  elements.cameraConfirm.addEventListener('click', () => {
    const text = elements.cameraCandidateText.value.trim();
    if (!cameraCandidateReady || !text) return;
    elements.replyText.value = text;
    elements.replyText.dispatchEvent(new Event('input', { bubbles: true }));
    elements.replyText.focus();
    elements.cameraStatus.textContent = 'Onayladığınız metin yanıt alanına aktarıldı. Seslendirmek için “Seslendir” düğmesine basın.';
  });

  try {
    const manifestUrl = new URL('./assets/tid/sentence-model-manifest.json', location.href);
    if (manifestUrl.origin !== location.origin) throw new Error('unsafe_model_manifest');
    const response = await fetch(manifestUrl, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('camera_manifest_unavailable');
    const value = await response.json();
    if (value?.schemaVersion !== 1 || typeof value.available !== 'boolean') throw new Error('invalid_camera_manifest');
    cameraManifest = value;
    if (!value.available) {
      elements.cameraStatus.textContent = 'Cümle modeli ve lisanslı yerel çalışma zamanı henüz dağıtım paketinde yok. Kamera açılmaz; hazır olduğunda kullanıcı ayrıca indirip başlatır.';
    }
    refreshCameraControls();
  } catch {
    elements.cameraStatus.textContent = 'Kamera model listesi doğrulanamadı. Kamera kapalı kaldı.';
  }
}

function initializeTidOutput() {
  const avatarPlayer = {
    playValidatedAnimation: (...args) => {
      if (!avatar?.ready) throw Object.assign(new Error('avatar_unavailable'), { code: 'avatar_unavailable' });
      return avatar.playValidatedAnimation(...args);
    },
    stop: () => avatar?.stop(),
    applyIdlePose: () => avatar?.applyIdlePose(),
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
    sourceText: elements.tidSource,
    status: elements.tidStatus,
    gloss: elements.tidGloss,
    progress: elements.tidProgress,
    player: translationPlayer,
    translateText: (text) => {
      if (!translationResources) throw new Error('translation_resources_unavailable');
      return translateTurkishToTid(text, translationResources);
    },
    onMediaSegment: (segment, progress) => {
      if (progress.result) {
        elements.tidVideo.hidden = true;
        elements.avatarStage.hidden = false;
        elements.avatarStatus.textContent = progress.result.status === 'completed'
          ? 'Gösterim tamamlandı'
          : progress.result.status === 'error' ? 'Gösterim hazırlanamadı' : 'Gösterim durdu';
      } else {
        const showVideo = segment.kind === 'video';
        elements.tidVideo.hidden = !showVideo;
        elements.avatarStage.hidden = showVideo;
        elements.avatarStatus.textContent = showVideo ? 'Onaylı video oynatılıyor' : 'Onaylı avatar hareketi oynatılıyor';
      }
    },
    onRetry: () => loadTranslationResources({ retryCurrentText: true }),
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

  navigator.serviceWorker.register('./service-worker.js')
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
void initializeCameraTools();
elements.avatarRetry.addEventListener('click', loadAvatar);

initializePwa();
initializeSpeechRecognition();
initializeTextActions();
initializeTextToSpeech();
updateCharacterCount();




