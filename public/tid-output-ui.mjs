const STATUS_TEXT = {
  ready: 'Uzman onaylı TİD hareketi hazır. Oynatmak için düğmeye dokunun.',
  'text-only': 'Bu karşılık yalnızca yazılı gloss olarak var; işaret hareketi yok.',
  unsupported: 'Bu ifade için onaylı TİD karşılığı bulunamadı. Metni düzenleyip yeniden onaylayın.',
  loading: 'Onaylı TİD içeriği yükleniyor…',
  error: 'İşlem tamamlanamadı. Bağlantıyı kontrol edip yeniden deneyin veya metni düzenleyin.',
};

const SOURCE_LABELS = {
  'reviewed-tid': 'Onaylı TİD',
  'dictionary-sequence': 'Sözlük dizimi',
  'fallback-cards': 'Harf kartları / yapay zekâ adayı',
};

export function createTidOutputController({
  input,
  confirmButton,
  playButton,
  stopButton,
  retryButton,
  repeatButton = null,
  stepButton = null,
  sourceText,
  status,
  gloss,
  progress,
  player,
  translateText,
  onMediaSegment = () => {},
  onRetry = null,
} = {}) {
  if (!input || !confirmButton || !playButton || !stopButton || !retryButton || !sourceText || !status || !gloss || !progress
    || typeof translateText !== 'function' || typeof player?.play !== 'function' || typeof player?.stop !== 'function') {
    throw new TypeError('translation_ui_dependencies_missing');
  }

  let currentResult = null;
  let currentState = 'idle';
  let translating = false;
  let playing = false;
  let speechActive = false;
  let generation = 0;
  let activeRequest = 0;
  let resourcesLoading = false;
  let stepIndex = 0;

  function updateControls() {
    const canPlay = currentState === 'ready' && currentResult?.status === 'ready'
      && Array.isArray(currentResult.segments) && currentResult.segments.length > 0;
    confirmButton.disabled = translating || playing || speechActive || currentState === 'loading';
    playButton.hidden = !canPlay;
    playButton.disabled = !canPlay || translating || playing;
    stopButton.hidden = !playing;
    stopButton.disabled = !playing;
    retryButton.hidden = currentState !== 'error';
    retryButton.disabled = translating || playing;
    if (repeatButton) repeatButton.disabled = !canPlay || playing || translating;
    if (stepButton) stepButton.disabled = !canPlay || playing || translating;
  }

  function renderTidTranslation(result) {
    const playable = Array.isArray(result?.segments) && result.segments.length > 0;
    const nextState = result?.status === 'ready' && !playable
      ? 'error'
      : ['ready', 'text-only', 'unsupported'].includes(result?.status) ? result.status : 'error';
    currentState = nextState;
    currentResult = nextState === 'error' ? null : result;
    stepIndex = 0;
    sourceText.textContent = typeof result?.sourceText === 'string' ? result.sourceText : input.value;
    if (nextState === 'ready') {
      const sourceLabel = SOURCE_LABELS[result.sourceClass] ?? 'Onaylı TİD';
      gloss.textContent = `${sourceLabel}: ${result.glossText || 'gösterim hazır'}`;
      status.textContent = result.sourceClass === 'reviewed-tid' || !result.sourceClass
        ? STATUS_TEXT.ready
        : result.sourceClass === 'dictionary-sequence'
          ? 'Sözlükteki işaretlerin dizimi hazır. Bu dizi uzman onaylı doğal TİD cümlesi değildir.'
          : 'Sözlükte olmayan bölümler harf kartlarıyla gösterilecek. Bu çıktı uzman onaylı doğal TİD değildir.';
    } else if (nextState === 'text-only') {
      gloss.textContent = result.glossText ? `Yalnızca yazılı gloss: ${result.glossText}` : 'Yalnızca yazılı gloss';
      status.textContent = STATUS_TEXT['text-only'];
    } else if (nextState === 'unsupported') {
      gloss.textContent = '';
      status.textContent = STATUS_TEXT.unsupported;
    } else {
      gloss.textContent = '';
      status.textContent = 'Oynatılabilir, doğrulanmış TİD hareketi bulunamadı. Metni yeniden onaylayın.';
    }
    status.dataset.state = nextState;
    progress.textContent = '';
    updateControls();
    return currentResult;
  }

  function setLoading(message = STATUS_TEXT.loading) {
    resourcesLoading = true;
    currentState = 'loading';
    currentResult = null;
    sourceText.textContent = input.value;
    gloss.textContent = '';
    status.textContent = message;
    status.dataset.state = 'loading';
    progress.textContent = '';
    updateControls();
  }

  function setIdle(message = 'Türkçe metni yazın veya konuşun; son metni gözden geçirip onaylayın.') {
    resourcesLoading = false;
    currentState = 'idle';
    currentResult = null;
    sourceText.textContent = input.value;
    gloss.textContent = '';
    status.textContent = message;
    status.dataset.state = 'idle';
    progress.textContent = '';
    updateControls();
  }

  function setError(message = STATUS_TEXT.error) {
    resourcesLoading = false;
    currentState = 'error';
    sourceText.textContent = input.value;
    gloss.textContent = '';
    status.textContent = message;
    status.dataset.state = 'error';
    updateControls();
  }

  async function confirm() {
    if (translating || playing || speechActive || currentState === 'loading') return;
    const submittedText = input.value;
    const requestGeneration = ++generation;
    activeRequest = requestGeneration;
    translating = true;
    currentResult = null;
    currentState = 'loading';
    sourceText.textContent = submittedText;
    gloss.textContent = '';
    status.textContent = STATUS_TEXT.loading;
    status.dataset.state = 'loading';
    progress.textContent = '';
    updateControls();
    try {
      const result = await translateText(submittedText);
      if (requestGeneration !== generation || input.value !== submittedText) return;
      renderTidTranslation(result);
    } catch {
      if (requestGeneration === generation) setError();
    } finally {
      if (requestGeneration === activeRequest) {
        translating = false;
        activeRequest = 0;
        updateControls();
      }
    }
  }

  async function play() {
    if (playing || translating || currentResult?.status !== 'ready' || !currentResult.segments?.length) return;
    const result = currentResult;
    playing = true;
    currentState = 'ready';
    let segmentIndex = 0;
    updateControls();
    status.textContent = 'TİD işaretleri oynatılıyor…';
    status.dataset.state = 'ready';
    try {
      const playback = await player.play(result.segments, {
        onSegmentStart: (segment) => {
          if (currentResult !== result) return;
          segmentIndex += 1;
          progress.textContent = `Gösterim ${segmentIndex} / ${result.segments.length} oynatılıyor.`;
          onMediaSegment(segment, { index: segmentIndex - 1, total: result.segments.length });
        },
        onSegmentEnd: (segment, segmentResult) => onMediaSegment(segment, { result: segmentResult }),
      });
      if (currentResult !== result) return;
      if (playback?.status === 'stopped') {
        status.textContent = 'Oynatma durduruldu. İsterseniz yeniden oynatabilirsiniz.';
      } else {
        status.textContent = 'TİD gösterimi tamamlandı.';
      }
    } catch {
      onMediaSegment(null, { result: { status: 'error' } });
      if (currentResult === result) setError('Onaylı TİD hareketi oynatılamadı. Yeniden deneyebilir veya metni düzenleyebilirsiniz.');
    } finally {
      playing = false;
      updateControls();
    }
  }

  async function stop() {
    if (!playing) return;
    try {
      await player.stop();
    } finally {
      playing = false;
      if (currentResult?.status === 'ready') {
        currentState = 'ready';
        status.textContent = 'Oynatma durduruldu. İsterseniz yeniden oynatabilirsiniz.';
        status.dataset.state = 'ready';
      }
      updateControls();
    }
  }

  async function retry() {
    if (translating || playing) return;
    if (currentResult?.status === 'ready') return play();
    if (typeof onRetry === 'function') return onRetry();
    return confirm();
  }

  async function step() {
    if (playing || translating || currentResult?.status !== 'ready' || !currentResult.segments?.length) return;
    const result = currentResult;
    const index = stepIndex % result.segments.length;
    playing = true;
    updateControls();
    try {
      await player.play([result.segments[index]], {
        onSegmentStart: (segment) => onMediaSegment(segment, { index, total: result.segments.length }),
      });
      stepIndex = (index + 1) % result.segments.length;
      progress.textContent = `Adım ${index + 1} / ${result.segments.length} gösterildi.`;
    } catch {
      setError('Bu adım gösterilemedi. Yeniden deneyebilirsiniz.');
    } finally {
      playing = false;
      updateControls();
    }
  }

  function setSpeechActive(active) {
    speechActive = active === true;
    updateControls();
  }

  input.addEventListener('input', () => {
    generation += 1;
    translating = false;
    activeRequest = 0;
    if (playing) void stop();
    if (resourcesLoading) {
      currentResult = null;
      sourceText.textContent = input.value;
      gloss.textContent = '';
      status.textContent = STATUS_TEXT.loading;
      status.dataset.state = 'loading';
      progress.textContent = '';
      updateControls();
    } else {
      setIdle('Metin değişti. Çeviri için son hâlini yeniden onaylayın.');
    }
  });
  confirmButton.addEventListener('click', () => confirm());
  playButton.addEventListener('click', () => play());
  stopButton.addEventListener('click', () => stop());
  retryButton.addEventListener('click', () => retry());
  repeatButton?.addEventListener('click', () => play());
  stepButton?.addEventListener('click', () => step());
  setIdle();

  return {
    renderTidTranslation,
    confirm,
    play,
    step,
    stop,
    retry,
    setLoading,
    setIdle,
    setError,
    setSpeechActive,
    get currentResult() { return currentResult; },
  };
}
