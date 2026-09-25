# Yayın ve Android cihaz kontrol listesi

**Durum:** Henüz tamamlanmadı. Karakter modelinin yeniden dağıtım hakkı ve fiziksel Android doğrulaması açık yayın kapılarıdır. Bir kutucuğu ancak ölçülen sonucu kaydettikten sonra işaretleyin.

## Dağıtım dosyaları ve lisanslar

Aşağıdaki liste `public/` altında bulunan her dağıtım dosyasını içerir. Yayın paketindeki dosya adlarını, içeriklerini ve kaynak bildirimlerini karşılaştırın.

- [ ] `public/app.mjs` — metin, konuşma ve PWA akışları; tarayıcı konuşma tanımasının internet kullanabileceği açıklaması.
- [ ] `public/avatar.mjs` — Three.js avatar yükleme ve animasyonu.
- [ ] `public/assets/avatar/rain.glb` — karakter modeli; yeniden dağıtım hakkı şu anda doğrulanmamış durumda.
- [ ] `public/assets/avatar/saved-poses.json` — SignBridge kaynaklı poz verisi; `SIGNBRIDGE-LICENSE.txt` MIT bildirimini paketle birlikte koruyun.
- [ ] `public/icons/icon.svg` — manifestteki standart uygulama simgesi.
- [ ] `public/icons/maskable.svg` — manifestteki maskelenebilir simge; gerçek Android başlatıcısında denetleyin.
- [ ] `public/index.html` — Türkçe dil tanımı, uygulama metinleri, durum etiketleri ve gizlilik açıklaması.
- [ ] `public/manifest.webmanifest` — `start_url`, `scope`, standalone gösterim, dil ve iki simge yolu.
- [ ] `public/matcher.mjs` — birebir sözcük eşleştirme; TİD cümle çevirisi iddiası olmadığını doğrulayın.
- [ ] `public/service-worker.js` — klasik worker URL'si, `sw-policy.js` yüklemesi, sürüm önbelleği ve kapsam.
- [ ] `public/styles.css` — küçük ekran, görünür klavye odağı, 48 piksel dokunma hedefi ve azaltılmış hareket kuralı.
- [ ] `public/sw-policy.js` — çevrimdışı sayfa dönüşü, indirilmeyen varlık mesajı ve yalnızca eski TİD önbelleklerini silme politikası.
- [ ] `public/vendor/three/three.module.js` — kaynak başlığında Three.js Authors, `SPDX-License-Identifier: MIT` ve telif bildirimi bulunur.
- [ ] `public/vendor/three/addons/loaders/GLTFLoader.js` — Three.js MIT lisans bildiriminin ve sürüm kaynağının dağıtım paketiyle korunduğunu doğrulayın.
- [ ] `public/vendor/three/addons/controls/OrbitControls.js` — Three.js MIT lisans bildiriminin ve sürüm kaynağının dağıtım paketiyle korunduğunu doğrulayın.
- [ ] `public/vendor/three/addons/utils/BufferGeometryUtils.js` — GLTFLoader'ın `three` bağımlılığını tamamlayan Three.js r162 yardımcı modülü; MIT kaynağını ve sürüm tutarlılığını doğrulayın.
- [ ] Depo kökündeki `ASSET-NOTICE.txt` ve `SIGNBRIDGE-LICENSE.txt` kaynak paketinde saklanır; statik `public/` klasörünü yayımlarken gerekli üçüncü taraf bildirimlerinin dağıtım paketinde de bulunduğunu doğrulayın.

### Karakter varlığı yayın kapısı

- [ ] `rain.glb` için hak sahibinden yeniden dağıtımı açıkça kapsayan yazılı izin veya lisans doğrulandı; kanıt ve kapsam kaydedildi.
- [ ] Bu hak doğrulanmadıysa, halka açık veya ticari dağıtım **engellenir**. Önizleme, kişisel kullanım veya kaynak projenin MIT olması tek başına model hakkını kanıtlamaz.
- [ ] İzinli bir yedek seçilirse, modelin iskeletindeki kemik adları `saved-poses.json` içindeki tüm poz anahtarlarıyla eşleşiyor; yükleme ve kayıtlı poz animasyonu görsel olarak doğrulandı.
- [ ] İşaret kodları, poz verileri, karakter ve Three.js için kaynak/lisans bilgisi dağıtım paketinde korunuyor.

## PWA kabuğu, ikonlar ve gizlilik

- [ ] `manifest.webmanifest` içindeki her ikon HTTPS yayın adresinde açılıyor; maskelenebilir ikon Android simgesinde kırpılmadan görünüyor.
- [ ] Service worker `./service-worker.js` adresinden klasik worker olarak kuruluyor; kapsam manifestteki `./` ile tutarlı.
- [ ] Uygulama kabuğu listesi HTML, CSS, modüller, manifest, simgeler ve üç vendored Three.js dosyasını içeriyor.
- [ ] `rain.glb` ve `saved-poses.json` ilk kurulum listesinde değil; her ikisi de başarılı ilk indirmeden sonra önbelleğe alınıyor.
- [ ] Çevrimdışı sayfa açılışı daha önce önbelleğe alınmış kabuğu gösteriyor; indirilmeyen bir varlık için anlaşılır hata ve yeniden deneme yolu var.
- [ ] Sürüm yükseltmesi yalnızca eski `tid-kopru-v<number>` önbelleklerini siliyor; başka uygulamaların önbelleği kalıyor.
- [ ] Ekrandaki gizlilik metni, yazı/avatarın cihazda işlendiğini ve konuşma tanımanın tarayıcı üzerinden uzak hizmet kullanabileceğini doğru anlatıyor.
- [ ] Uygulamanın konuşma tanıma dışında ses, metin veya kamera verisini göndermediği doğrulandı; kamera tanıma mevcut özellikmiş gibi tanıtılmıyor.

## Android Chrome'da elle doğrulama

Cihaz modeli, Android/Chrome sürümü, tarih ve sonuçları kayıt altına alın. Başka tarayıcı veya cihazlara başarı genellemesi yapmayın.

- [ ] Temiz kurulum: HTTPS sayfasını Android Chrome'da açın; uygulama simgesi/manifest kurulumu ve ana ekrandan açılış çalışıyor.
- [ ] İlk açılış: uygulama kabuğu açılıyor; avatar indirme ilerlemesi/başarısı görünüyor; sözlük ve kayıtlı poz animasyonu çalışıyor.
- [ ] İndirme hatası: ağ kesilince metin girişleri ve cihaz seslendirmesi kullanılabiliyor; avatar hatası anlaşılır ve **Yeniden dene** düğmesi çalışıyor.
- [ ] Çevrimdışı: uygulamayı çevrimiçi açıp avatarı yükledikten sonra uçak modunda ana ekrandan başlatın; kabuk, elle metin, cihaz seslendirmesi ve önceden indirilen avatarı sınayın.
- [ ] İlk çevrimdışı kullanım: avatar henüz indirilmediyse uygulamanın bunu açıkça bildirdiğini doğrulayın; tam çevrimdışı konuşma tanıma iddiası olmadığını kontrol edin.
- [ ] Mikrofon izni: reddedin; uyarı görünür kalıyor, elle yazma ve yanıtı seslendirme çalışıyor.
- [ ] Mikrofon ve konuşma: izin verildiğinde konuşma başlatma/durdurma, hata mesajı ve elle düzeltme akışını deneyin; konuşma hizmetinin ağ davranışını cihaz/tarayıcı bağlamında kaydedin.
- [ ] Yükseltme: önceki sürüm önbelleğinden güncelleyin; uygulama açılır ve başka site önbellekleri etkilenmez.
- [ ] Erişilebilirlik: TalkBack ile etiketler ve durum bildirimleri; klavye bağlıyken sıralı gezinme ve görünür odak; büyük metin ve en dar desteklenen ekran genişliği.
- [ ] Uzun kullanım ve yön değiştirme: avatar görünümü taşmıyor, dokunma hedefleri kullanılabilir, azaltılmış hareket tercihi animasyon yükünü azaltıyor.

## Yerel masaüstü tarayıcı denemesi

**25 Eylül 2026, Windows'ta localhost:** Uygulama açıldı; servis çalışanı hazır durumuna geçti ve sözlükte 123 işaret yüklendi. Sunucu kayıtları uygulama kabuğunun servis çalışanı kurulumundan önce, avatar dosyalarının ise servis çalışanı kontrolü sağlandıktan sonra istendiğini gösterdi. Yerel sunucu kapatılıp aynı adres yenilendiğinde uygulama kabuğu ve avatar çevrimdışı açıldı; avatar görsel olarak görüntülendi. Bu sonuç Android kurulumu, TalkBack, mikrofon izni veya farklı cihazlarda çalışma doğrulaması değildir.

### Yayın kararı

- [ ] Karakter modelinin yeniden dağıtım hakkı doğrulandı veya lisanslı uyumlu modelle değiştirildi.
- [ ] Bu listedeki fiziksel Android kontrolleri ölçülerek tamamlandı.
- [ ] Uygulama kapsamı, veri akışları, lisanslar ve bilinen sınırlar incelendi; TİD cümle çevirisi veya acil durum aracı iddiası yok.
- [ ] Yalnızca yukarıdaki maddeler tamamlanırsa yayın sahibi HTTPS statik dağıtımı onayladı.
