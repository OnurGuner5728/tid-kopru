# Android ve yayın kontrol listesi

**Tarih:** 25 Eylül 2026

**Durum:** Masaüstü tarayıcı doğrulaması sürüyor; fiziksel Android doğrulaması yapılmadı.

**Dil kapsamı:** 123 sözlük poz, 0 uzman onaylı doğal TİD cümle.

Bu liste yayınlanan HTTPS sürümünde fiziksel Android Chrome ile tamamlanacaktır. Bir madde yalnızca cihaz modeli, Android/Chrome sürümü, tarih ve gözlenen sonuç kaydedilince işaretlenir.

## Kullanıcı akışı

- [ ] Temiz açılışta sayfa kamera veya mikrofon izni istemez.
- [ ] **Dinlemeyi başlat** düğmesi mikrofon iznini ister; ara metin görünür; durdurduktan sonra metin elle düzeltilebilir.
- [ ] `Sen iyisin` yazılıp onaylanınca kişi bilgisi korunur; bulunan sözlük pozları oynar, bulunmayan bölüm varsa harf kartı görünür ve çıktı doğal TİD diye etiketlenmez.
- [ ] Bilinmeyen bir sözcük boş sonuç vermek yerine görünür harf kartları oluşturur.
- [ ] Oynatma hızı, **Tekrarla**, **Adım adım** ve **Durdur** kontrolleri çalışır.
- [ ] **Kamerayı aç** düğmesine basınca kamera izni istenir ve önizleme başlar.
- [ ] **Durdur** kamera akışındaki bütün izleri kapatır; sayfadan ayrılınca kamera açık kalmaz.
- [ ] Kişisel işaret en az üç örnek kaydedilmeden hazır sayılmaz.
- [ ] En az üç örnekten sonra kişisel işaret adayı üretilebilir; düşük güvenli hareket “anlaşılamadı” sonucunda kalır.
- [ ] Arayüz IndexedDB açıksa kişisel örneklerin cihazda kaldığını; açılamazsa yalnızca oturumda tutulacağını söyler; ham görüntü saklanmaz.
- [ ] **Bu işareti sil** seçili etiketi, **Tüm kişisel veriyi sil** bütün kişisel örnekleri kaldırır; yeniden açılışta silinen veri geri gelmez.
- [ ] Kamera adayı düzenlenebilir ve **Yanıt alanına aktar** tıklanmadan cevap alanını değiştirmez.
- [ ] Cevap metni **Seslendir** ile okunur ve **Durdur** ile kesilir.

## Gizlilik ve ağ

- [ ] **Yalnızca cihazda** modunda kamera ve metin isteklerinde bulut servisine ağ çağrısı yoktur.
- [ ] **Akıllı hibrit** modunda kişisel eşleştirme ve varsa yerel ONNX modeli kullanılır; mevcut paket cümle modeli içermediğini açıkça söyler.
- [ ] **Bulut destekli** modda ayrı onay kutusu seçilmeden veya yerel güven 0,72 eşiğinin üstündeyken kısa klip gönderilmez.
- [ ] NVIDIA ayarında boş veya geçersiz anahtar anlaşılır hata verir; genel amaçlı model sonucu “düzenlenebilir aday” olarak görünür.
- [ ] Oturum anahtarı sayfa kapatılınca/gizlenince temizlenir; IndexedDB, localStorage, servis çalışanı önbelleği ve kaynak dosyalarda bulunmaz.
- [ ] Mikrofon konuşma tanımanın tarayıcıya göre internet/uzak hizmet kullanabileceği görünürdür.

## Kurulum, çevrimdışı ve erişilebilirlik

- [ ] HTTPS adresinden manifest ve servis çalışanı kurulur; ana ekrana eklenen simge doğru kırpılır.
- [ ] İlk çevrimiçi açılış yerel kamera çalışma zamanını indirir, SHA-256 doğrular ve hazır durumuna geçer.
- [ ] Daha sonra uçak modunda uygulama kabuğu, 123 poz, metin çözümleme, avatar ve kişisel işaret verisi açılır.
- [ ] Çevrimdışı durumda konuşma tanıma veya NVIDIA beklenmez; elle yazma ve yerel özellikler çalışır.
- [ ] Kamera/mikrofon izni reddedilince elle kullanım devam eder ve yeniden deneme yolu görünür.
- [ ] TalkBack; başlıkları, alan etiketlerini, durum mesajlarını ve düğmeleri anlaşılır sırada okur.
- [ ] Klavye odağı görünürdür; büyük yazı, dar ekran, yatay/dikey yön ve azaltılmış hareket tercihi kullanılabilir.
- [ ] Android Chrome sekmesi arka plana alınınca kamera, kısa klip ve oturum anahtarı bırakılır.

## Yayın dosyası ve lisans envanteri

- [ ] `public/index.html`, `public/styles.css`, `public/app.mjs`, `public/app-state.mjs`
- [ ] `public/avatar.mjs`, `public/procedural-rig.mjs`, `public/letter-cards.mjs`, `public/tid-display-plan.mjs`
- [ ] `public/tid-media-player.mjs`, `public/tid-output-ui.mjs`, `public/tid-transfer.mjs`, `public/turkish-morphology.mjs`
- [ ] `public/assets/avatar/saved-poses.json`, `public/SIGNBRIDGE-LICENSE.txt`
- [ ] `public/assets/tid/content-manifest.json`, `public/assets/tid/reviewed-content.json`, `public/assets/tid/morphology-rules.json`
- [ ] `public/assets/tid/gloss-to-turkish.json`, `public/assets/tid/sentence-model-manifest.json`
- [ ] `public/assets/runtime/runtime-manifest.json` ve üç MediaPipe `.task` modeli
- [ ] `public/landmark-runtime.mjs`, `public/landmark-worker.js`, `public/landmark-normalization.mjs`, `public/mediapipe-fileset.mjs`
- [ ] `public/personal-sign-store.mjs`, `public/personal-training.mjs`, `public/personal-sign-recognizer.mjs`
- [ ] `public/sign-recognition.mjs`, `public/sign-recognition-worker.js`, `public/onnx-runtime-loader.mjs`, `public/tid-to-turkish.mjs`
- [ ] `public/hybrid-recognition.mjs`, `public/privacy-mode.mjs`, `public/media-capture-registry.mjs`, `public/cloud-session.mjs`, `public/nvidia-candidate.mjs`
- [ ] `public/service-worker.js`, `public/sw-policy.js`, `public/manifest.webmanifest`, `public/icons/icon.svg`, `public/icons/maskable.svg`
- [ ] `public/vendor/mediapipe/LICENSE.txt`, `public/vendor/onnxruntime/LICENSE.txt`, `public/vendor/three/LICENSE.txt`
- [ ] `public/vendor/three/three.module.js` ve gereken addon modülleri
- [ ] `public/ASSET-NOTICE.txt`; `rain.glb` kamuya açık kaynak ve site paketinde yoktur.

## Doğal TİD kanıt kapısı

- [ ] En az 300 izinli, zaman kodlu ve geliştirmede kullanılmamış cümle/klip.
- [ ] En az 20 kişi ayrık işaretleyici.
- [ ] Her sonuç için iki bağımsız akıcı TİD değerlendiricisi ve anlaşmazlık hakemi.
- [ ] Uzlaştırma sonrası en az %90 anlam kabulü.
- [ ] Destek dışı girdilerde en fazla %5 yanlış kabul.
- [ ] Hedef Android cihazda doğruluk, gecikme, pil ve ısınma ölçümü.
- [ ] En az 30 yüz yüze TİD kullanıcı oturumu.

Bu kapılar tamamlanmadan 123 sözlük pozu veya kişisel eşleştirme “bütün konuşmaları doğal TİD'e çevirir” diye tanıtılamaz.
