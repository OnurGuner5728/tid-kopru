# TİD işaret pilotu veri sözleşmesi

Bu klasör yalnızca veri biçimini ve yerel doğrulamayı tanımlar. İçindeki `S01`, `C01` ve `SIGN_A` gibi kodlar test fikstürüdür; gerçek katılımcı veya TİD işareti değildir. Bu depo içinde katılımcı kaydı, ham video, ses, iletişim bilgisi veya gerçek bir onam belgesi bulunmamalıdır.

## Katılımcı verisi için kapılar

- TİD kullanan sağır danışman 20 işaretin anlamını, varyantlarını ve çekim koşullarını onaylamadan gerçek etiket/koşul listesi oluşturmayın.
- Katılımcıdan adlandırılmış amaç, kullanım kapsamı, saklama süresi ve silme yöntemi için belgeli izin alınmadan kayıt toplamayın.
- Ham video varsayılan olarak yakalanmaz veya dışa aktarılmaz. Landmark verisi kimlikten arındırılsa bile hassas biyometrik veri sayılır; yalnızca erişimi sınırlandırılmış yerel depoda tutulmalıdır.
- Onam kodu gerçek izin belgesinin yerine geçmez. İzin kanıtı, kimliği açığa çıkaran eşleme ve erişim kaydı bu veri dosyasından ayrı ve korumalı tutulur.
- İzni geri çekilen kişinin `signerCode` değeriyle tüm kayıtlarını bulup silme süreci çalışmalıdır; bu bağlantı tablosu dağıtım verisine eklenmez.
- Gerçek Android telefon, danışman ve katılımcı izni olmadan yakalama, eğitim veya ürün modeli iddiası yapılmaz.

## Kayıt biçimi

Kayıt şeması 1.1'dir. Her satır anonim ve tekil bir captureId ile captureContractSha256 parmak izini taşır. Parmak izi ön işleme sürümünü, sıralı landmark indekslerini, MediaPipe model/runtime sürümlerini, model/runtime hash değerlerini ve seçilen WASM loader/binary dosyalarının yollarıyla hashlerini kapsar. Yerel loader çözülen WASM dosyalarının hashlerini doğrular ve doğrulanmış baytları kullanır. Doğrulayıcı yinelenen tekrar numaralarını, captureId değerlerini ve zamanı/FPS'i değişse bile tekrar kullanılan landmark dizilerini reddeder; içerik karşılaştırması sıralı anahtarlara ve mikro ölçekte yuvarlanmış koordinatlara dayanır.

`schema.json` kayıt yapısını tanımlar. `validate_dataset(records, signers, allowed_signs, allowed_conditions=None)` ek olarak sürüm, onam kodu, işaretçi/işaret listesi üyeliği, sonlu koordinatları, görünürlük maskelerini ve zaman damgalarını denetler. Her koordinat grubu 3 değerli (x, y, z) noktalar halinde düzleştirilir; karşılık gelen görünürlük maskesinde her nokta için 0 veya 1 bulunur. Eksik nokta sıfır koordinatla ve görünürlük değeri 0 ile gösterilir.

İzinli işaret ve işaretçi kodları bu fonksiyona ayrı, danışman/onam sürecinden gelen manifestolarla verilir. Onaylı koşul kodları da allowed_conditions ile sağlanır; verilmediğinde yalnızca koşul alanlarının biçimi denetlenir. Fonksiyon veri yapısını denetler; iznin gerçekliğini veya kapsamının yeterliliğini doğrulayamaz.

Şema testlerini çalıştırmak için proje kökünde:

```powershell
python -m unittest discover -s tests -p test_sign_pilot_dataset.py -v
```

## Yerel kayıt aracı

Varlık manifesti modelVersion ve runtimeVersion yanında runtime/model yollarını ve SHA-256 değerlerini, ayrıca runtime'ın yüklediği WASM JS/WASM dosyalarının yol/hash listesini taşır. Özel onay manifestindeki mediaPipeWasmFiles listesi bu seçilmiş dosya çiftini en az kapsamalıdır; SIMD ve SIMD olmayan dağıtım yapılıyorsa her iki çift de listelenebilir. captureContractSha256, yerel kayıt manifestiyle özel eğitim onay manifestinde aynı olmalıdır. Nihai landmark düzeni ve onaylı varlık kimlikleri özel approval manifestine yazıldıktan sonra şu komutla parmak izi hesaplanır: python -m tools.sign_pilot.capture_contract --manifest D:\tid-kopru-private\approval-manifest.json. Çıkan değer iki yerel manifestte de kullanılır.

capture.html yalnızca localhost üzerinde çalışır. Uygulama açıldığında kamera izni istemez. Kayıt için danışman onaylı pilot-manifest.json, hash değerleri doğrulanmış aynı-kaynak MediaPipe dosyaları için mediapipe-assets.json ve katılımcı onamında MediaPipe ölçüm açıklamasının yer alması gerekir. Örnek yapı dosyaları pilot-manifest.example.json ve mediapipe-assets.example.json içindedir. Örneklerde gerçek işaret, katılımcı veya model bilgisi yoktur. Özel dosyalar .gitignore altında tutulur.

Yerel deneme sunucusunu proje kökünde şu komutla başlatın: python tools/serve.py --port 8120 --directory tools/sign_pilot. Ardından http://localhost:8120/capture.html sayfasını açın. Yerel MediaPipe runtime ve model dosyaları izin/lisans incelemesi tamamlanmadan depoya eklenmez. Dosyalar onaylanıp yerel assets klasörüne konduğunda mediapipe-assets.json içindeki yollar, tam sürüm ve SHA-256 değerleri eşleşmelidir; uzak URL'ler hashleri doğru olsa bile reddedilir.

Kamera yalnızca “Kamerayı aç” seçildiğinde istenir. Yerel model doğrulanıp yüklendikten sonra kamera izni sorulur. Önizleme açıkken çıkarım yapılmaz; “Bir işareti kaydet” seçimiyle başlar ve yalnız landmark dizileri belleğe alınır. Kaydı bitirince kayıt Python sözleşmesiyle aynı kurallara göre tarayıcıda doğrulanır. Ham kare, video ve ses dışa aktarılmaz. “Dışa aktar” JSONL indirir; “Bu oturumun verisini sil”, kamera izlerini kapatıp belleği temizler. Sayfadan çıkış da kamera izlerini durdurur.

MediaPipe şartları görüntü girdisinin cihaz üzerinde işlendiğini ve Google'a gönderilmediğini söyler; ayrıca kullanım/performance ölçümleri, uygulama ve girdi türünün genel özellikleri ile sistem ortamının Google'a iletilebileceğini, bu işleme için bilgilendirilmiş onam gerektiğini bildirir. Bu nedenle araç, kamera açılmadan önce açıklama onayı arar. Bu ölçüm trafiği nedeniyle araca “hiçbir ağ bağlantısı kurmaz” denmemelidir. Ayrıntı: https://developers.google.com/edge/mediapipe/legal/tos .

MediaPipe Web kılavuzu Holistic Landmarker'ı @mediapipe/tasks-vision paketi ve yerel model bundle'ı ile çalıştırmayı tarif eder: https://developers.google.com/edge/mediapipe/solutions/vision/holistic_landmarker/web_js . Kılavuz model dosyasını projede kullanmayı anlatır; dağıtım ve yeniden dağıtım hakları ise ayrıca doğrulanmalıdır. Bu doğrulama, danışman onaylı landmark alt kümesi, gerçek katılımcı onamı ve Android ölçümü tamamlanmadan bu araç gerçek veri toplamaya hazır sayılmaz. Ana PWA'da kamera tanıma etkin değildir.

Tarayıcı mantık testleri: node --test tests/sign-pilot-preprocess.test.mjs . Bu testler yalnız sentetik şema verisi ve sahte kamera akışı kullanır; bilgisayar kamerasını açmaz.

## Cümle düzeyinde TİD pilotu için ek sözleşme

`utterance-schema.json` ve `validate_utterances.py`, cümle/ifade zaman çizelgesi için ayrı şema sürümü 2'yi tanımlar. `validate_utterances(records, signers, approved_glosses)` her karede sonlu landmark, artan zaman damgası, kodlu onam ve izinli gloss üyeliği arar; `utteranceId` tekrarlarını reddeder. `captureContractSha256`, aynı ön işleme ve runtime sözleşmesinin veri, eğitim ve ölçüm boyunca değişmediğini bağlamak içindir. Şekil doğrulaması gerçek onamı, izin kapsamını veya TİD dilbilimsel doğruluğunu kanıtlamaz.

Gloss olay zamanları klibin başlangıcına göre milisaniyedir ve son kareyi aşamaz. `channel: "manual"` el işaretini, `channel: "nonManual"` yüz/baş/gövde bileşenini belirtir. Bu iki kanal yalnızca her iki olay aynı `parallelGroup` koduyla açıkça eşleştirildiğinde çakışabilir; aynı kanaldaki veya eşleşmeyen olaylardaki çakışma reddedilir. `nonManual` alanında olayla hizalı kodlu işaretler bulunur; `spatialReference` varsa kişiyi tanımlamayan, danışman onaylı bir uzam kodu olmalıdır. Eğitim/doğrulama/test signer kümeleri `validate_split_manifest` ile ayrık tutulur.

Gerçek kayıt öncesinde TİD danışmanı etiket sözlüğünü, varyantları ve annotation kılavuzunu onaylamalı; her katılımcı da adlandırılmış kullanım amacı, paylaşım, saklama süresi ve geri çekilme/silme yöntemi için ayrı aydınlatılmış izin vermelidir. `consentCode` yalnızca erişimi kısıtlı onam kaydına işaret eden takma koddur; ad, imzalı form veya kimlik eşleme tablosu manifestoya eklenmez. Landmark kayıtları biyometrik olarak hassas sayılır ve şifreli, erişimi kısıtlı yerel depoda tutulur; belirlenen saklama süresi dolunca silinir. İzni geri çekilen kişinin `signerCode` koduyla tüm landmark, annotation, kopya ve türetilmiş eğitim kayıtları bulunup silinir ve silme olayı özel erişim kaydında tutulur.

Ham görüntü bu aracın varsayılan çıktısı değildir. Eğitim amacıyla ham video ancak imzalı izin formu bu amacı ve gerekli saklama süresini açıkça kapsıyorsa, sınırlı erişimli şifreli depoda tutulabilir; Git'e, herkese açık pakete veya service worker önbelleğine girmez. Bu plan için TİD danışmanı, gerçek katılımcı izni ve hedef Android ölçümü mevcut değildir; örnekler sentetik kalır ve bir ürün modeli yayımlanmaz.

Şema testleri: `python -m unittest discover -s tests -p test_sign_utterance_dataset.py -v`. Bu testler yalnızca yapay landmark/gloss fikstürleri kullanır; kamera veya katılımcı verisi açmaz.
