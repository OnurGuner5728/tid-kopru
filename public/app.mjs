import { SignAvatar } from './avatar.mjs';
import { matchText } from './matcher.mjs';

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
  signText: document.querySelector('#sign-text'),
  showSigns: document.querySelector('#show-signs'),
  dictionaryCount: document.querySelector('#dictionary-count'),
  matchSummary: document.querySelector('#match-summary'),
  tokenList: document.querySelector('#token-list'),
  missingBox: document.querySelector('#missing-box'),
  missingWords: document.querySelector('#missing-words'),
  avatarStage: document.querySelector('#avatar-stage'),
  avatarLoader: document.querySelector('#avatar-loader'),
  avatarStatus: document.querySelector('#avatar-status'),
  currentWord: document.querySelector('#current-word'),
  signProgress: document.querySelector('#sign-progress')
};

let recognition;
let speechErrorMessage = '';
let listening = false;
let recognitionBase = '';
let avatar;
let dictionary = {};
let pwaStatusMessage = '';

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
    updateCharacterCount();
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
    updateCharacterCount();
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

function renderMatches(result) {
  elements.tokenList.replaceChildren();
  result.matched.forEach(({ dictionaryKey }, index) => {
    const token = document.createElement('span');
    token.className = 'token';
    token.dataset.index = String(index);
    token.textContent = dictionaryKey;
    elements.tokenList.appendChild(token);
  });
  elements.missingBox.hidden = result.missing.length === 0;
  elements.missingWords.textContent = result.missing.map(({ source }) => source).join(', ');
  elements.matchSummary.textContent = result.tokens.length
    ? `${result.matched.length} eşleşme · ${result.missing.length} bulunamayan sözcük`
    : `${Object.keys(dictionary).length} kayıtlı işaret hazır`;
}

function setActiveToken(index, done) {
  document.querySelectorAll('.token').forEach((token) => token.classList.remove('playing'));
  const current = document.querySelector(`.token[data-index="${index}"]`);
  if (current) current.classList.add(done ? 'done' : 'playing');
}

async function playMatchedSigns() {
  const text = elements.signText.value.trim();
  if (!text) {
    elements.matchSummary.textContent = 'Önce gösterilecek metni yazın.';
    elements.signText.focus();
    return;
  }
  const result = matchText(text, dictionary);
  renderMatches(result);
  if (!result.matched.length) return;
  if (!avatar?.ready) {
    elements.matchSummary.textContent = 'Avatar henüz hazırlanıyor.';
    return;
  }
  if (avatar.playing) {
    avatar.stop();
    return;
  }

  elements.showSigns.textContent = 'Oynatmayı durdur';
  const words = result.matched.map(({ dictionaryKey }) => dictionaryKey);
  await avatar.playSequence(words, ({ index, word, total, done }) => {
    setActiveToken(index, done);
    elements.currentWord.textContent = word;
    elements.currentWord.classList.toggle('visible', !done);
    elements.signProgress.style.width = `${((index + (done ? 1 : 0)) / total) * 100}%`;
  });
  elements.currentWord.classList.remove('visible');
  elements.showSigns.textContent = 'İşaretleri göster';
  setTimeout(() => { elements.signProgress.style.width = '0%'; }, 450);
}

async function loadAvatar() {
  elements.avatarLoader.hidden = false;
  elements.avatarRetry.hidden = true;
  elements.avatarRetry.disabled = true;
  elements.avatarStatus.textContent = 'Avatar hazırlanıyor…';
  elements.showSigns.disabled = true;

  try {
    if (!avatar) {
      avatar = new SignAvatar(elements.avatarStage, (message) => {
        elements.avatarStatus.textContent = message;
      });
    }
    dictionary = await avatar.initialize();
    elements.avatarLoader.hidden = true;
    elements.dictionaryCount.textContent = `${Object.keys(dictionary).length} kayıtlı işaret hazır`;
    elements.showSigns.disabled = false;
  } catch (error) {
    elements.avatarLoader.hidden = true;
    elements.avatarStatus.textContent = navigator.onLine
      ? 'Avatar yüklenemedi. İnternet bağlantısını kontrol edip yeniden deneyin.'
      : 'Avatar henüz indirilmedi. İlk yükleme için internet gerekir.';
    elements.dictionaryCount.textContent = 'İşaret sözlüğü yüklenemedi.';
    elements.avatarRetry.hidden = false;
    elements.avatarRetry.disabled = false;
    elements.showSigns.disabled = true;
    console.error(error);
  }
}

function renderPwaStatus() {
  const offlineMessage = navigator.onLine
    ? ''
    : 'Çevrimdışı kullanımda yalnızca daha önce açılmış avatar dosyaları kullanılabilir. Mikrofon tanıma internet gerektirebilir.';
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
        ? 'Uygulama çevrimdışı açılış için hazır. Kurulum HTTPS bağlantısında yapılır; ilk çevrimdışı kullanım için avatarı bir kez indirip açın.'
        : 'Çevrimdışı önbellek kurulumu zaman aldı. Avatar yine yüklenmeyi deneyecek; çevrimdışı kullanım için sayfayı yenileyin.');
    })
    .catch(() => {
      setPwaStatus('Çevrimdışı açılış ayarı yapılamadı. Kurulum için HTTPS gerekir; metinle kullanım devam eder.');
    })
    .finally(loadAvatar);
}

elements.showSigns.disabled = true;
elements.showSigns.addEventListener('click', playMatchedSigns);
elements.avatarRetry.addEventListener('click', loadAvatar);
elements.signText.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') playMatchedSigns();
});

initializePwa();
initializeSpeechRecognition();
initializeTextActions();
initializeTextToSpeech();
updateCharacterCount();




