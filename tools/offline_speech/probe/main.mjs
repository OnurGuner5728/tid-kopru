const elements = {
  localStatus: document.querySelector('#local-status'),
  loadModel: document.querySelector('#load-model'),
  modelProgress: document.querySelector('#model-progress'),
  modelStatus: document.querySelector('#model-status'),
  start: document.querySelector('#start-recognition'),
  stop: document.querySelector('#stop-recognition'),
  partial: document.querySelector('#partial-result'),
  final: document.querySelector('#final-result')
};

let model;
let recognizer;
let mediaStream;
let audioContext;
let audioSource;
let audioProcessor;
let mutedOutput;

function waitForControl(timeoutMs = 5000) {
  if (navigator.serviceWorker.controller) return Promise.resolve(true);
  return new Promise((resolve) => {
    let timeoutId;
    const finish = (controlled) => {
      window.clearTimeout(timeoutId);
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
      resolve(controlled);
    };
    const onChange = () => {
      if (navigator.serviceWorker.controller) finish(true);
    };
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    if (navigator.serviceWorker.controller) {
      finish(true);
      return;
    }
    timeoutId = window.setTimeout(() => finish(Boolean(navigator.serviceWorker.controller)), timeoutMs);
  });
}

async function prepareOfflineShell() {
  if (!('serviceWorker' in navigator)) {
    elements.localStatus.textContent = 'Bu tarayıcı servis çalışanını desteklemiyor; model yükleme çevrimdışı sınanamaz.';
    return false;
  }
  try {
    await navigator.serviceWorker.register('./service-worker.js');
    const controlled = await waitForControl();
    elements.localStatus.textContent = controlled
      ? 'Deneme sayfası bu cihazda çalışıyor. Model ve ses işlemleri cihazda kalır; kayıt tutulmaz.'
      : 'Çevrimdışı önbellek geç hazır oldu. Yenileyin; model yükleme çevrimiçi denenebilir.';
    return controlled;
  } catch {
    elements.localStatus.textContent = 'Çevrimdışı önbellek kurulamadı. Yerel deneme devam edebilir; model yüklemek için bağlantı gerekir.';
    return false;
  }
}

async function readModelArchive(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Model dosyası açılamadı (${response.status}).`);

  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    elements.modelProgress.value = 1;
    elements.modelStatus.textContent = `${(buffer.byteLength / 1048576).toFixed(1)} MB model dosyası okundu.`;
    return;
  }

  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.byteLength;
    if (total) {
      elements.modelProgress.value = Math.min(loaded / total, 1);
      elements.modelStatus.textContent = `Model dosyası okunuyor: ${(loaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`;
    } else {
      elements.modelProgress.removeAttribute('value');
      elements.modelStatus.textContent = `Model dosyası okunuyor: ${(loaded / 1048576).toFixed(1)} MB`;
    }
  }
  elements.modelProgress.value = 1;
}

async function loadModel() {
  elements.loadModel.disabled = true;
  elements.start.disabled = true;
  elements.modelProgress.value = 0;
  elements.modelStatus.textContent = 'Model dosyası ve çevrimdışı önbellek hazırlanıyor.';
  try {
    const controlled = await prepareOfflineShell();
    const modelUrl = new URL('./model.tar.gz', window.location.href).href;
    await readModelArchive(modelUrl);
    elements.modelStatus.textContent = 'Dosya hazır. Tanıma modeli belleğe yükleniyor…';
    if (!window.Vosk?.createModel) throw new Error('Yerel Vosk tanıma dosyası yüklenemedi.');
    model = await window.Vosk.createModel(modelUrl);
    elements.start.disabled = false;
    elements.stop.disabled = false;
    elements.modelStatus.textContent = controlled
      ? 'Model yüklendi. Sonraki denemede bu sayfa ve model çevrimdışı kullanılabilir.'
      : 'Model yüklendi; servis çalışanı kurulmadığı için çevrimdışı tekrar sınanamaz.';
  } catch (error) {
    elements.modelStatus.textContent = `${error.message} Dosyanın bulunduğunu ve yerel sunucuyu kontrol edin.`;
    elements.loadModel.disabled = false;
  }
}

function appendFinalText(text) {
  if (!text) return;
  const previous = elements.final.textContent === '—' ? '' : elements.final.textContent;
  elements.final.textContent = [previous, text].filter(Boolean).join(' ').trim();
}

async function stopCapture({ releaseModel = true } = {}) {
  const hadCapture = Boolean(mediaStream || audioContext);
  if (audioProcessor) {
    audioProcessor.onaudioprocess = null;
    audioProcessor.disconnect();
    audioProcessor = undefined;
  }
  audioSource?.disconnect();
  audioSource = undefined;
  mutedOutput?.disconnect();
  mutedOutput = undefined;
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = undefined;
  if (audioContext && audioContext.state !== 'closed') await audioContext.close();
  audioContext = undefined;
  recognizer?.remove();
  recognizer = undefined;

  if (releaseModel && model) {
    model.terminate();
    model = undefined;
    elements.start.disabled = true;
    elements.loadModel.disabled = false;
    elements.modelStatus.textContent = hadCapture
      ? 'Mikrofon kapandı ve model belleği bırakıldı. Yeniden denemek için modeli yükleyin.'
      : 'Model worker sonlandırıldı ve belleği bırakıldı. Yeniden denemek için modeli yükleyin.';
  }
  elements.stop.disabled = !model;
}

async function startCapture() {
  elements.start.disabled = true;
  elements.stop.disabled = true;
  elements.localStatus.textContent = 'Mikrofon izni yalnızca bu başlatma sırasında istenir. Ses bu cihazda işlenir ve kaydedilmez.';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Bu tarayıcı mikrofon erişimini desteklemiyor.');
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
    });
    audioContext = new AudioContext();
    await audioContext.resume();
    recognizer = new model.KaldiRecognizer(audioContext.sampleRate);
    recognizer.on('partialresult', (message) => {
      elements.partial.textContent = message.result.partial || '—';
    });
    recognizer.on('result', (message) => appendFinalText(message.result.text));

    audioSource = audioContext.createMediaStreamSource(mediaStream);
    audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    mutedOutput = audioContext.createGain();
    mutedOutput.gain.value = 0;
    audioProcessor.onaudioprocess = (event) => recognizer?.acceptWaveform(event.inputBuffer);
    audioSource.connect(audioProcessor);
    audioProcessor.connect(mutedOutput);
    mutedOutput.connect(audioContext.destination);
    elements.stop.disabled = false;
    elements.localStatus.textContent = 'Dinleme açık. Tanıma cihazda çalışıyor; ses kaydedilmiyor.';
  } catch (error) {
    await stopCapture({ releaseModel: false });
    elements.start.disabled = !model;
    elements.localStatus.textContent = `${error.message} Bu teknik denemede mikrofon çalışmadı; ana uygulamanın elle yazma alanı etkilenmez.`;
  }
}

elements.loadModel.addEventListener('click', loadModel);
elements.start.addEventListener('click', startCapture);
elements.stop.addEventListener('click', () => stopCapture());
window.addEventListener('pagehide', () => { void stopCapture(); });
void prepareOfflineShell();
