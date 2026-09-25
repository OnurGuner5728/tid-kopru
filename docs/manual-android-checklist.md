# Yayın ve Android cihaz kontrol listesi

**Durum: YAYIN ENGELLENMİŞTİR.** TİD uzman değerlendirmesi, lisanslı cümle medyası, `rain.glb` model hakkı ve fiziksel Android denemesi açık yayın kapılarıdır. Bir kutuyu yalnızca ölçülen sonuç, cihaz ve tarih kaydedildikten sonra işaretleyin. Güncel içerik sayımları [Türkçe→TİD değerlendirme raporundadır](tid-text-to-sign-evaluation.md).

## Dağıtım dosyaları ve lisanslar

Yayın öncesi aşağıdaki her dosyanın kaynak, sürüm ve lisansını paketle karşılaştırın.

- [ ] `public/app.mjs` — onaylı Türkçe→TİD arayüzü ve mikrofonun sağlayıcıya bağlı olabileceği uyarısı.
- [ ] `public/avatar.mjs` — avatar yükleme ve yalnızca doğrulanmış içerik için poz oynatma.
- [ ] `public/assets/avatar/rain.glb` — karakter modeli; yeniden dağıtım izni şu anda doğrulanmamış.
- [ ] `public/assets/avatar/saved-poses.json` — SignBridge kaynaklı poz verisi; `SIGNBRIDGE-LICENSE.txt` MIT bildirimiyle birlikte.
- [ ] `public/assets/tid/content-manifest.json` — içerik sürümü, reviewed-content özeti ve medya hak/karmaları.
- [ ] `public/assets/tid/reviewed-content.json` — gerçek TİD incelemesi ve karar bilgisi bulunan cümle kayıtları; şu an boş.
- [ ] `public/assets/tid/morphology-rules.json` — Türkçe çözümleme kuralları; tek başına TİD karşılığı değildir.
- [ ] `public/avatar.mjs`, `public/tid-media-player.mjs`, `public/tid-output-ui.mjs`, `public/tid-transfer.mjs`, `public/turkish-morphology.mjs` — avatar, medya oynatma, arayüz, onaylı aktarım ve çözümleme modülleri.
- [ ] `public/matcher.mjs` — eski birebir eşleştirici; genel TİD çevirisi iddiası için kullanılmıyor.
- [ ] `public/index.html`, `public/styles.css`, `public/manifest.webmanifest` — Türkçe arayüz, durum metinleri, görünür odağı ve uygulama kurulumu. `manifest.webmanifest` simge yolları ve ikonları Android'de kontrol edilmelidir.
- [ ] `public/service-worker.js`, `public/sw-policy.js` — uygulama kabuğu ve manifestteki, lisans/karması doğrulanan medya önbelleği.
- [ ] `public/icons/icon.svg`, `public/icons/maskable.svg` — manifest simgeleri; Android başlatıcısında kırpılmayı denetleyin.
- [ ] `public/vendor/three/three.module.js`, `public/vendor/three/addons/loaders/GLTFLoader.js`, `public/vendor/three/addons/controls/OrbitControls.js`, `public/vendor/three/addons/utils/BufferGeometryUtils.js` — Three.js sürüm ve MIT bildirimleriyle birlikte.
- [ ] Depo kökündeki `ASSET-NOTICE.txt` ve `SIGNBRIDGE-LICENSE.txt` kaynak paketinde tutulur; statik dağıtımın gerekli lisans metinlerini de içerdiğini doğrulayın.

### İçerik ve varlık yayını

- [ ] `pilot-content-0` şu anda 0 cümle, 0 üretken kalıp ve 0 TİD medya varlığı içerir. Bu sayı artarsa yeni bir içerik sürümü, bağlanan kaynak/inceleme ve toplu rapor oluşturun.
- [ ] Her yeni karşılık iki bağımsız akıcı TİD değerlendiricisinden onay alır; anlaşmazlığı üçüncü hakem çözer. Sentetik test incelemeleri sayılmaz.
- [ ] Her oynatılabilir video veya avatar animasyonu için kaynağı, lisans belgesi/izni, atıfı, yeniden dağıtım kapsamı, SHA-256, süre, gloss hizası ve non-manual zamanlaması denetlenir.
- [ ] Türkçe→TİD held-out 300 cümle değerlendirmesinde uzlaştırma sonrası anlam kabulü en az %90 olmadan yayın yapılmaz. Alt küme, ret ve yanlış kabul sonuçlarını da kaydedin.
- [ ] `rain.glb` yeniden dağıtım hakkı doğrulanmadıysa bu karakteri içeren kamuya açık dağıtım engellidir. Kaynak kodun veya poz dosyalarının MIT olması karakter izni kanıtı değildir.
- [ ] Katılımcı kimliği, rıza formu, ham/özel video, landmark ve kimlik eşleme tablosu Git'e veya web önbelleğine konmaz.

## PWA kabuğu, çevrimdışı kullanım ve gizlilik

- [ ] Service worker `./service-worker.js` adresinden klasik worker olarak kurulur ve manifestteki `./` kapsamıyla tutarlıdır.
- [ ] Uygulama kabuğu HTML, CSS, gereken modülleri, manifesti, simgeleri, küçük TİD içerik/biçimbilim JSON dosyalarını ve vendored Three.js dosyalarını içerir.
- [ ] Büyük avatar modeli/poz dosyaları ile TİD video medyası ilk kurulum kabuğuna alınmaz. TİD medyası ancak mevcut içerik manifesti listelemiş, hak beyanı geçerli ve indirilen dosya karması doğruysa sürümlü önbelleğe girer.
- [ ] Manifestte listelenmeyen TİD varlığı ve ham katılımcı/kamera yolu önbelleğe girmez. İndirme, karma veya kota hatası kullanıcıya hata olarak bildirilir ve tekrar deneme yolu vardır.
- [ ] Eski uygulama kabuğu sürüm önbelleği silinir; başka site önbelleklerine dokunulmaz.
- [ ] Elle yazılan metin ve yerel çeviri akışının cihaz dışına gönderilmediği; mikrofon konuşma tanımanın tarayıcı sağlayıcısına göre ağ kullanabileceği açıklanır.
- [ ] Ürün arayüzünde kamera ile TİD→Türkçe özelliği sunulmaz. Ürün dışı araştırma araçları kamera çevirisi kanıtı değildir.

## Android Chrome'da elle doğrulama

Cihaz modeli, Android/Chrome sürümü, tarih ve sonucu kaydedin. Bu liste şu an fiziksel cihazda çalıştırılmış değildir.

- [ ] Temiz HTTPS kurulumu: uygulama simgesi, manifest, ana ekrandan açılış ve servis çalışanı kontrolü.
- [ ] Türkçe metin: `Sen iyisin` yazıp onaylayın. Mevcut boş içerik sürümünde sonuç **desteklenmiyor** olmalı; oynatma düğmesi görünmemeli. Bu örnek şu an TİD'e çevrilmiyor.
- [ ] Gerçek `ready` sonucu yalnızca sonradan uzmanlarca incelenmiş bir örnek ve lisanslı varlık eklenirse denenebilir; gerçek örnek eklenmeden bu madde tamamlandı sayılmaz.
- [ ] Ara metin, son transkript, mikrofonu durdurma ve son metni ayrıca onaylama sırasını deneyin. Tanıma sürerken onay/oynatma başlamamalı.
- [ ] Mikrofon iznini reddedin ve tarayıcı ağı kullanılamazken elle metin girişi, onay, hata açıklaması ve metni düzenleme çalışıyor.
- [ ] Onaylı medya eklendiğinde indirme, karma/erişim hatası, yeniden deneme, durdurma, çevrimdışı tekrar oynatma ve başka içerik sürümüne geçişi sınayın.
- [ ] Uçak modunda önbelleğe alınmış uygulama kabuğunu ve daha önce indirilmiş lisanslı medyayı açın. Konuşma tanımanın çevrimdışı çalıştığını varsaymayın.
- [ ] TalkBack durum bildirimleri, klavye gezinmesi, görünür odak, büyük metin, dar ekran ve azaltılmış hareket tercihini sınayın.
- [ ] Yazı/metin/TİD medyasının NVIDIA veya başka bir üretken AI hizmetine gönderilmediğini ağ incelemesiyle doğrulayın.

## Önceki masaüstü kontrolünün kapsamı

25 Eylül 2026, Windows'ta localhost: önceki kullanıcı arayüzünde uygulama kabuğu ve avatar dosyalarının çevrimdışı açıldığı kaydedilmiştir. Bu sonuç Android kurulumu veya güncel onaylı Türkçe→TİD akışının doğrulaması değildir; yeni arayüz ve medya önbelleği için ayrı deneme gerekir.

## Yayın kararı

- [ ] İki bağımsız TİD incelemesi ve gerektiğinde hakem sonucu kayda geçirildi.
- [ ] 300 held-out cümlede en az %90 anlam kabulü sağlandı; kişi, olumsuzluk, soru, zaman, iyelik ve çekim alt sonuçları raporlandı.
- [ ] Desteklenen tüm cümlelerin varlık hakları, içerik karmaları ve non-manual gösterimleri doğrulandı.
- [ ] `rain.glb` model hakkı çözüldü veya izinli modelle değiştirildi.
- [ ] Android Chrome, çevrimdışı ve erişilebilirlik denemeleri fiziksel cihazda geçti.
- [ ] Yayın sahibi yalnızca yukarıdaki kanıtlardan sonra HTTPS statik dağıtımı onayladı.
