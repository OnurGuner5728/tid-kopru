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

`schema.json` kayıt yapısını tanımlar. `validate_dataset(records, signers, allowed_signs, allowed_conditions=None)` ek olarak sürüm, onam kodu, işaretçi/işaret listesi üyeliği, sonlu koordinatları, görünürlük maskelerini ve zaman damgalarını denetler. Her koordinat grubu 3 değerli (x, y, z) noktalar halinde düzleştirilir; karşılık gelen görünürlük maskesinde her nokta için 0 veya 1 bulunur. Eksik nokta sıfır koordinatla ve görünürlük değeri 0 ile gösterilir.

İzinli işaret ve işaretçi kodları bu fonksiyona ayrı, danışman/onam sürecinden gelen manifestolarla verilir. Onaylı koşul kodları da allowed_conditions ile sağlanır; verilmediğinde yalnızca koşul alanlarının biçimi denetlenir. Fonksiyon veri yapısını denetler; iznin gerçekliğini veya kapsamının yeterliliğini doğrulayamaz.

Şema testlerini çalıştırmak için proje kökünde:

```powershell
python -m unittest discover -s tests -p test_sign_pilot_dataset.py -v
```

## Yerel kayıt aracı

capture.html yalnızca localhost üzerinde çalışır. Uygulama açıldığında kamera izni istemez. Kayıt için danışman onaylı pilot-manifest.json, hash değerleri doğrulanmış aynı-kaynak MediaPipe dosyaları için mediapipe-assets.json ve katılımcı onamında MediaPipe ölçüm açıklamasının yer alması gerekir. Örnek yapı dosyaları pilot-manifest.example.json ve mediapipe-assets.example.json içindedir. Örneklerde gerçek işaret, katılımcı veya model bilgisi yoktur. Özel dosyalar .gitignore altında tutulur.

Yerel deneme sunucusunu proje kökünde şu komutla başlatın: python tools/serve.py --port 8120 --directory tools/sign_pilot. Ardından http://localhost:8120/capture.html sayfasını açın. Yerel MediaPipe runtime ve model dosyaları izin/lisans incelemesi tamamlanmadan depoya eklenmez. Dosyalar onaylanıp yerel assets klasörüne konduğunda mediapipe-assets.json içindeki yollar, tam sürüm ve SHA-256 değerleri eşleşmelidir; uzak URL'ler hashleri doğru olsa bile reddedilir.

Kamera yalnızca “Kamerayı aç” seçildiğinde istenir. Yerel model doğrulanıp yüklendikten sonra kamera izni sorulur. Önizleme açıkken çıkarım yapılmaz; “Bir işareti kaydet” seçimiyle başlar ve yalnız landmark dizileri belleğe alınır. Kaydı bitirince kayıt Python sözleşmesiyle aynı kurallara göre tarayıcıda doğrulanır. Ham kare, video ve ses dışa aktarılmaz. “Dışa aktar” JSONL indirir; “Bu oturumun verisini sil”, kamera izlerini kapatıp belleği temizler. Sayfadan çıkış da kamera izlerini durdurur.

MediaPipe şartları görüntü girdisinin cihaz üzerinde işlendiğini ve Google'a gönderilmediğini söyler; ayrıca kullanım/performance ölçümleri, uygulama ve girdi türünün genel özellikleri ile sistem ortamının Google'a iletilebileceğini, bu işleme için bilgilendirilmiş onam gerektiğini bildirir. Bu nedenle araç, kamera açılmadan önce açıklama onayı arar. Bu ölçüm trafiği nedeniyle araca “hiçbir ağ bağlantısı kurmaz” denmemelidir. Ayrıntı: https://developers.google.com/edge/mediapipe/legal/tos .

MediaPipe Web kılavuzu Holistic Landmarker'ı @mediapipe/tasks-vision paketi ve yerel model bundle'ı ile çalıştırmayı tarif eder: https://developers.google.com/edge/mediapipe/solutions/vision/holistic_landmarker/web_js . Kılavuz model dosyasını projede kullanmayı anlatır; dağıtım ve yeniden dağıtım hakları ise ayrıca doğrulanmalıdır. Bu doğrulama, danışman onaylı landmark alt kümesi, gerçek katılımcı onamı ve Android ölçümü tamamlanmadan bu araç gerçek veri toplamaya hazır sayılmaz. Ana PWA'da kamera tanıma etkin değildir.

Tarayıcı mantık testleri: node --test tests/sign-pilot-preprocess.test.mjs . Bu testler yalnız sentetik şema verisi ve sahte kamera akışı kullanır; bilgisayar kamerasını açmaz.