# TİD Köprü

TİD Köprü, Türkçe konuşan ve Türk İşaret Dili (TİD) kullanan kişilerin yüz yüze iletişimine yardımcı olan, kurulabilir bir web uygulamasıdır. Türkçe metni konuşarak veya yazarak alır; cümleyi kişi, olumsuzluk, soru, gelecek zaman ve iyelik bilgilerini koruyarak işler; bildiği işaretleri basit bir iskelet üzerinde sırayla gösterir. Kamera tarafında kullanıcının kendi öğrettiği işaretleri cihazda tanıyıp düzenlenebilir Türkçe aday üretir.

> **Mevcut kapsam:** 123 sözlük poz, 0 uzman onaylı doğal TİD cümle, 0 lisanslı cümle videosu. Sözlük pozlarının art arda gösterilmesi ve bilinmeyen sözcüklerin harf kartlarıyla görünür kılınması iletişime yardımcı olur; doğal TİD cümlesi değildir. Uygulama her konuşmayı doğal TİD'e çevirmez.

Uygulama acil, tıbbi veya hayati iletişimde tek kanal olarak kullanılmamalıdır.

## Hemen kullanma

Yayınlanan sürüm: [https://onurguner5728.github.io/tid-kopru/](https://onurguner5728.github.io/tid-kopru/). Adım adım [kullanım kılavuzu](https://onurguner5728.github.io/tid-kopru/kullanim-kilavuzu.html).

Bilgisayarda yerel olarak açmak için proje klasöründe:

```powershell
python tools/serve.py
```

Ardından [http://localhost:8000](http://localhost:8000) adresini açın. Telefon kurulumu, kamera, mikrofon ve çevrimdışı çalışma için yayınlanan HTTPS adresini kullanın. İlk açılışta yaklaşık 50 MB yerel kamera çalışma zamanı indirilip SHA-256 ile doğrulanır; sonraki açılışlarda önbellekten kullanılabilir.

## Türkçe → TİD gösterimi

1. Türkçe cümleyi yazın veya **Dinlemeyi başlat** ile konuşun.
2. Tarayıcının çıkardığı metni düzeltin ve **Onayla ve işaretleri göster** düğmesine basın. Gösterim hemen başlar.
3. Uygulama önce uzman onaylı cümle içeriği arar. Mevcut pakette bu sayı 0'dır.
4. Ardından kişi, iyelik, olumsuzluk, soru ve gelecek zaman gibi bilgileri koruyan aktarım planını kurar. 123 sözlük poz içinden bulunanları basit iskeletle, bulunmayan görünür sözcükleri harf kartlarıyla gösterir.
5. Hızı değiştirebilir, tekrar oynatabilir veya adım adım ilerleyebilirsiniz.

`Sen iyisin`, `Ben iyi değilim`, `Annemin telefonu`, `Yarın okula gidecek misin?` ve `Onur'un kahvesi` gibi biçimler artık ek bilgileri kaybolmadan işlenir. Çıktı ekranda kaynağıyla birlikte “sözlük dizimi”, “harf kartı” veya “uzman onaylı içerik” olarak etiketlenir.

## Kamera → Türkçe adayı

Kamera kendiliğinden açılmaz. **Kamerayı aç** düğmesiyle izin verildikten sonra MediaPipe el, yüz ve gövde noktalarını cihazda çıkarır. Ham kamera görüntüsü kişisel öğretme sırasında kaydedilmez veya saklanmaz.

Kişisel tanıma için:

1. **Kişisel işaret öğret** bölümünü açın ve sözlükten bir işaret seçin veya kısa bir Türkçe cümle yazın.
2. Aynı işareti veya cümleyi en az üç kez örnek olarak kaydedin. Cümle kaydı yaklaşık 5 saniye sürer ve yalnızca öğretilmiş cümlenin tekrarı için kişisel eşleştirme sağlar.
3. Kamerada işareti yapıp **İşareti bitir** düğmesine basın.
4. Bulunan Türkçe adayı gerekirse düzeltin; **Onayla ve seslendir** düğmesi metni yanıt alanına aktarır ve tarayıcının Türkçe sesiyle okur. Tanıma başarısızsa ifade biliniyorsa aday alanına elle yazılabilir.

Örnekler tarayıcının cihaz içi veritabanında sayısal hareket noktaları olarak kalır. Arayüz saklamanın kalıcı cihaz depolaması mı yoksa yalnızca geçerli oturum mu olduğunu bildirir. Tek bir işareti **Bu işareti sil** ile, bütün örnekleri **Tüm kişisel veriyi sil** ile kaldırabilirsiniz. Tarayıcı verileri temizlenmedikçe kişisel örnekler yeniden açılışta kullanılabilir.

Paketlenmiş, genel amaçlı bir TİD cümle tanıma modeli bulunmadığından kamera yalnızca kişisel olarak öğretilen işaretleri ve kısa cümleleri güvenli eşiğin üstünde eşleştirir. Eşleşme zayıfsa tahmin yerine “anlaşılamadı” sonucu verir. Elle girilen metin kamera çevirisi olarak değerlendirilmez.

## Gizlilik modları

- **Yalnızca cihazda:** Varsayılan moddur. Kamera karesi, hareket noktaları ve metin buluta gönderilmez.
- **Akıllı hibrit:** Önce kişisel yerel eşleştirme, ardından varsa hash doğrulanmış yerel ONNX modeli kullanılır. Mevcut pakette ONNX cümle modeli yoktur.
- **Bulut destekli:** Yalnızca ayrı kutuyu işaretleyerek açık izin verdiğinizde ve cihaz içi güven 0,72 eşiğinin altındaysa kısa klip NVIDIA hizmetine gönderilebilir. Yüksek güvenli yerel sonuçta klip gönderilmez. Bu seçim her oturumda yeniden yapılır.

NVIDIA modeli genel amaçlı ve TİD için doğrulanmamış bir video modelidir. Sonucu en fazla düşük güvenli, düzenlenebilir bir adaydır; kullanıcı onayı olmadan cevap alanına aktarılmaz. API anahtarı yalnızca sayfanın o oturumundaki bellekte tutulur, kalıcı depoya yazılmaz ve sayfa gizlenince veya kapanınca temizlenir. Depoda API anahtarı bulunmaz. Sayfa gizlenince medya izinleri ve kamera kaynakları kapatılır; devam etmek için sayfayı yenilemek gerekir.

Mikrofon yalnızca **Dinlemeyi başlat** düğmesine basılınca açılır. Tarayıcı konuşma tanıma hizmeti internet kullanabilir ve sesi tarayıcı sağlayıcısına gönderebilir. Elle yazma, cümle çözümleme, avatar ve kişisel kamera tanıma cihazda çalışır.

## Çevrimdışı çalışma

Uygulama kabuğu, 123 poz, dil kuralları ve yerel MediaPipe/ONNX Runtime Web dosyaları ilk başarılı çevrimiçi açılıştan sonra servis çalışanıyla önbelleğe alınır. Mikrofon konuşma tanımasının çevrimdışı çalışması tarayıcıya bağlıdır. Bulut destekli aday için internet gerekir.

Kullanılan çalışma zamanları:

- MediaPipe Tasks Vision 1.0.1 — Apache-2.0
- ONNX Runtime Web 1.30.0 — MIT
- Three.js — MIT
- SignBridge `saved-poses.json` — MIT

`rain.glb` karakter modelinin yeniden dağıtım hakkı doğrulanmadığı için kamuya açık kaynak ve site paketinden çıkarılmıştır. Uygulama bunun yerine projeye ait basit iskelet çizimini kullanır. Ayrıntılar [varlık bildiriminde](ASSET-NOTICE.txt) yer alır.

## Doğal TİD için yayın kapısı

Çalışan yazılım ile dil doğruluğu ayrı ölçülür. “Doğal TİD çevirisi” iddiası için en az 300 izinli ve geliştirmede kullanılmamış cümle/klip, en az 20 kişi ayrık işaretleyici, iki bağımsız akıcı TİD değerlendiricisi, en az %90 anlam kabulü, en fazla %5 destek dışı yanlış kabul, hedef Android ölçümü ve 30 yüz yüze kullanıcı oturumu gerekir. Bu insan ve saha çalışmaları henüz yapılmadı.

Güncel kanıt durumu:

- [Türkçe → TİD değerlendirmesi](docs/tid-text-to-sign-evaluation.md)
- [Kamera → Türkçe değerlendirmesi](docs/tid-camera-to-text-evaluation.md)
- [İki yönlü saha sonuçları](docs/tid-two-way-field-results.md)
- [Android ve yayın kontrol listesi](docs/manual-android-checklist.md)

## Geliştirme doğrulaması

```powershell
npm test
npm run check
python -m unittest discover -s tests -v
```

Otomatik kontroller yazılım davranışını ve gizlilik sınırlarını doğrular; akıcı TİD kullanıcısı değerlendirmesi yerine geçmez.
