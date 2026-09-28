import { stopMediaStream } from './privacy-mode.mjs';

export function requestCameraWithTimeout(mediaDevices, constraints, timeoutMs = 30000) {
  let expired = false;
  let timer;
  const request = Promise.resolve().then(() => mediaDevices.getUserMedia(constraints));
  request.then((stream) => { if (expired) stopMediaStream(stream); }, () => {});
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(Object.assign(new Error('camera_permission_timeout'), { name: 'TimeoutError' }));
    }, timeoutMs);
  });
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
}

export function cameraStartMessage(stage, error) {
  const name = error?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'Kamera izni verilmedi. Tarayıcıdaki kamera iznini açıp yeniden deneyin.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'Bu cihazda kullanılabilir kamera bulunamadı.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'Kamera başka bir uygulama tarafından kullanılıyor olabilir. Diğer uygulamayı kapatıp yeniden deneyin.';
  if (name === 'TimeoutError') return 'Kamera izin isteği yanıt vermedi. Tarayıcıdaki izin penceresini kontrol edin ve yeniden deneyin.';
  if (stage === 'preview') return 'Kamera görüntüsü başlatılamadı. Kamerayı kapatıp yeniden deneyin.';
  if (stage === 'landmarks') return 'Kamera açıldı, fakat hareket noktaları işlenemedi. Sayfayı yenileyip yeniden deneyin.';
  return 'Kamera başlatılamadı. Tarayıcı izinlerini kontrol edip yeniden deneyin.';
}
