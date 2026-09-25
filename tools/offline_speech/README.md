# Yerel Türkçe konuşma denemesi

Bu klasör, onaylı planın tarayıcıda Vosk uyumluluğunu inceleme aşamasıdır. `vosk-browser@0.0.5` yalnızca uyumluluk adayıdır; Android desteği veya ürün kullanımı onaylanmış değildir. Ana PWA'ya bağlı değildir ve ana uygulama kabuğuna eklenmez. Deneme mikrofonu yalnızca kullanıcı **Başlat** düğmesine dokunduktan sonra ister; ses dosyası veya konuşma kaydı oluşturmaz.

## Modeli hazırlama

Resmî [Vosk model kataloğundaki](https://alphacephei.com/vosk/models) `vosk-model-small-tr-0.3` Türkçe ZIP dosyasını indirin. Katalog şu anda modeli 35 MB, Apache-2.0 lisanslı olarak listeliyor; yayınlanan kelime hata oranı yok. Model çalışma anında çok daha fazla bellek kullanabilir ve mobil tarayıcı uyumluluğu ayrıca sınanmalıdır.

PowerShell'de proje kökünden. İndirdiğiniz ZIP'i `tools/offline_speech/downloads/` klasörüne kaydedin:

```powershell
python -m tools.offline_speech.prepare_model .\tools\offline_speech\downloads\vosk-model-small-tr-0.3.zip .\tools\offline_speech\probe\model.tar.gz
python tools/serve.py --port 8120 --directory tools/offline_speech/probe
```

Ardından aynı bilgisayarda `http://localhost:8120/` adresini açın. ZIP dosyasını isterseniz `tools/offline_speech/downloads/` içine koyun; indirilmiş paketler, hazırlanan model ve deneme kayıtları Git'e eklenmez. Model dosyasını Git'e koymayın.

## Deneme adımları

1. Modeli bir kez yükleyin ve sözlükte tanıma modelinin hazır olduğunu görün.
2. Çevrimdışı tekrar için yerel sunucuyu durdurup aynı sekmeyi yenileyin; sayfa ve modelin yerel önbellekten açıldığını kontrol edin.
3. Gerçek konuşma sınaması yalnızca mikrofon erişimi için ayrı izin verildikten sonra yapılır. **Durdur ve belleği bırak** akışı mikrofon izlerini kapatır ve Vosk worker'ını sonlandırır.

Bu deneme Android cihaz, Türkçe doğruluk, bellek, pil veya gecikme başarısı kanıtlamaz. Gerçek cihaz, konuşmacı onayı ve ölçülmüş cümleler olmadan bu özellik ana PWA'da açılmaz. 100 cümlelik doğruluk ölçümü için `tools/offline_speech/evaluate.mjs` ve `tools/offline_speech/phrases.tsv` kullanılır; ham ses dosyası saklanmaz.

## Yerel ön inceleme kaydı

**25 Eylül 2026 — Windows masaüstü, Codex uygulamasının tarayıcısı:** Gerçek Türkçe model paketi hazırlandı; Vosk worker'ı çevrimiçi ve sunucu kapalıyken çevrimdışı yüklemeyi başardı. Sunucu kapalıyken sayfa ve model yeniden açıldı. **Durdur ve belleği bırak** düğmesi worker'ı sonlandırdı. Mikrofon başlatılmadı; bu nedenle konuşma metni, WER, gecikme, pil/bellek ölçümü veya sesin istek yapmadığına ilişkin mikrofonlu doğrulama yoktur. Android Chrome kontrolü de yapılmadı.

## Bağımlılık bildirimi

`probe/vendor/vosk.js`, npm'den tam sürüm `vosk-browser@0.0.5` olarak alınmıştır; paket Apache-2.0 lisansı bildirir. Kaynak deposu, tarball bütünlük bilgisi ve vendored dosyanın SHA-256 özeti `probe/vendor/NOTICE.md` içindedir. Lisans metni `probe/vendor/LICENSE-2.0.txt` dosyasındadır.
