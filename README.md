# TİD Köprü

Türkçe konuşan ve Türk İşaret Dili (TİD) kullanan kişilerin yüz yüze iletişimini desteklemek için geliştirilen teknik prototip. Metni yazabilir veya tarayıcı konuşma tanımasını kullanabilir, görünen son metni onaylayabilir ve cihazın Türkçe ses sentezinden yararlanabilirsiniz.

> **Yayın durumu: Engelli.** Uygulamanın Türkçe→TİD aktarım ve oynatıcı altyapısı vardır; fakat dağıtım paketinde TİD uzmanlarınca onaylanmış cümle veya lisansı doğrulanmış gösterim medyası yoktur. Şu anda desteklenen TİD cümle alanı **0 cümledir**. Desteklenmeyen her ifadede TİD işareti oynatılmaz. Android Chrome ve erişilebilirlik cihaz kontrolleri de henüz yapılmamıştır.

Yazılım **acil durum aracı değildir**; tıbbi veya hayati iletişimde tek kanal olarak kullanmayın.

## Bu prototip şu an ne yapıyor?

- Türkçe metni düzenlenebilir bir alana alır. İsteğe bağlı mikrofon tanımasında ara ve son metin görünür; dinleme durduktan sonra kullanıcı son metni ayrıca onaylar.
- Metni cihazda çalışan sınırlı Türkçe biçimbilim ve onaylı içerik denetiminden geçirir. Bilinmeyen veya belirsiz ifadeyi tahminle tamamlamaz.
- Mevcut `pilot-content-0` içeriğinde **0 onaylı cümle, 0 üretken aktarım kalıbı ve 0 medya varlığı** vardır. Bu nedenle `Sen iyisin` dahil hiçbir cümle şu an TİD hareketine çevrilemez. `iyisin` çözümlemesinin testlerde ikinci tekil kişi bilgisini koruması, bu cümle için TİD karşılığının onaylandığı anlamına gelmez.
- Yanıt metnini cihazın ses senteziyle seslendirebilir.
- Kameradan TİD cümlelerini Türkçeye çevirme bu kullanıcı arayüzünde yoktur. Araştırma/kamera toplama araçları ürünün ters yönlü çeviri özelliği değildir.

Hedeflenen olası ilk içerik alanı selamlaşma, kişiler/aile, temel ihtiyaçlar, gündelik etkinlikler, zaman/yer, tercih, basit rica ve tekrar isteme cümleleridir. Bunların hiçbiri iki bağımsız akıcı TİD değerlendiricisinin incelemesi ve uygun gösterim medyası olmadan desteklenmiş sayılmaz. Güncel sayımlar ve yayın kapısı [değerlendirme raporunda](docs/tid-text-to-sign-evaluation.md) tutulur.

## Bilgisayarda açma

Ek paket kurmadan projeyle gelen yerel sunucuyu kullanın. Sunucu JavaScript modüllerine doğru MIME türünü verir ve yalnızca bu bilgisayarda dinler. Proje klasöründe:

```powershell
python tools/serve.py
```

Sonra aynı bilgisayarda [http://localhost:8000](http://localhost:8000) adresini açın. Başka bir port için `python tools/serve.py --port 8111` kullanın; durdurmak için `Ctrl+C` basın.

Uzak Android telefonda kurulum, servis çalışanı ve mikrofon izni için HTTPS gerekir. `localhost` yalnızca aynı cihazdaki yerel deneme adresidir. Depo belirli bir barındırma sağlayıcısına yayımlanmış değildir.

## Konuşma tanıma ve gizlilik

Elle yazılan metin, biçimbilim çözümlemesi ve onaylı içerik araması tarayıcıda, cihazda çalışır. Uygulama metin, video, landmark veya kamera görüntüsünü bulut yapay zekâsına göndermez ve NVIDIA API anahtarı içermez.

Mikrofon yalnızca **Dinlemeyi başlat** düğmesine basılınca istenir. Konuşmayı yazıya çevirme tarayıcının konuşma tanıma sağlayıcısını kullanabilir; bu sağlayıcı internet bağlantısı ve sesin cihaz dışına gönderilmesini gerektirebilir. Sağlayıcının ağ ve saklama davranışı tarayıcıya/cihaza bağlıdır. Mikrofon izni reddedilse de elle yazma çalışır.

## Çevrimdışı kullanım ve varlıklar

Uygulama kabuğu, küçük içerik dosyaları ve biçimbilim kuralları servis çalışanıyla önbelleğe alınır. Lisansı ve SHA-256 özeti manifestte kayıtlı TİD medyası yalnızca onaylı içerik listesinde bulunursa, dosya özeti doğrulandıktan sonra sürümlü önbelleğe alınır. Ham kamera veya katılımcı kayıtları bu akışa dahil edilmez. İlk çevrimdışı kullanım için gerekiyorsa uygulamayı çevrimiçiyken bir kez açın; mikrofon tanımasının çevrimdışı çalışacağını varsaymayın.

Avatar kurulumu `rain.glb` (7.169.048 bayt) ve `saved-poses.json` (958.753 bayt) dosyalarını, toplam yaklaşık **8,1 MB** olarak indirir. Bu büyük dosyalar ilk uygulama kabuğu listesinde değildir; başarılı ilk yüklemeden sonra önbelleğe alınır. Karakter modeli hakkı doğrulanmadığı için kamuya açık dağıtım hâlâ engellidir.

Mevcut `rain.glb` karakter modelinin yeniden dağıtım hakkı doğrulanmamıştır. Bu nedenle kamuya açık dağıtım engellidir; kaynak poz verileri de TİD cümle çevirisi veya insan tarafından doğrulanmış hareket sayılmaz. Hak durumu [`ASSET-NOTICE.txt`](ASSET-NOTICE.txt) ve [Android/yayın kontrol listesinde](docs/manual-android-checklist.md) izlenir.

## Geliştirme kontrolleri

```powershell
npm test
npm run check
python -m unittest discover -s tests -v
```

Otomatik testlerdeki sentetik onaylar yalnızca yazılım davranışını sınar; TİD uzman incelemesi, insan değerlendirmesi veya gerçek cihaz denemesi yerine geçmez. Ürünü acil, tıbbi veya hayati iletişimde tek kanal olarak kullanmayın.
