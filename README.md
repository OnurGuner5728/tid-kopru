# TİD Köprü

Yüz yüze iletişimi destekleyen, ücretsiz ve hesapsız bir web uygulaması. Bu sürüm; elle yazılan Türkçe metni, tarayıcı destekliyorsa konuşmayı yazıya dönüştürmeyi, cihazın ses sentezini ve kayıtlı işaretleri avatarla göstermeyi bir araya getirir.

> **Durum:** Teknik ilk sürüm. Android Chrome'da çevrimdışı kurulum ve erişilebilirlik kontrolleri henüz doğrulanmadı. `public/assets/avatar/rain.glb` dosyasının yeniden dağıtım hakkı belirsiz olduğu için uygulama halka açık dağıtıma hazır değildir.

## Bilgisayarda açma

Ek paket kurmadan projeyle gelen yerel sunucuyu kullanın. Sunucu JavaScript modüllerine doğru MIME türünü verir ve yalnızca bu bilgisayarda dinler. Proje klasöründe şu komutu çalıştırın:

```powershell
python tools/serve.py
```

Ardından aynı bilgisayarda [http://localhost:8000](http://localhost:8000) adresini açın. Başka bir port seçmek için `python tools/serve.py --port 8111` komutunu kullanın. Sunucuyu kapatmak için komut penceresinde `Ctrl+C` kullanın.

Uzak Android telefondan kurulum, servis çalışanı ve mikrofon izni için güvenli bağlantı gerekir: yayın adresi HTTPS olmalıdır. `localhost` yalnızca aynı cihazdaki yerel deneme adresidir. Bu proje henüz belirli bir barındırma sağlayıcısına yayımlanmamıştır.

## İlk avatar yüklemesi ve çevrimdışı kullanım

Avatarın iki dosyası birlikte yaklaşık **8,1 MB** boyutundadır: `rain.glb` 7.169.048 bayt, `saved-poses.json` 958.753 bayt. İlk denemeyi internet bağlıyken açın ve avatarın yüklenmesini bekleyin. Service worker bu dosyaları başarılı indirmeden sonra önbelleğe alır; büyük avatar dosyaları uygulama kabuğunun kurulumunu geciktirmez. İndirme başarısız olursa **Yeniden dene** düğmesini kullanabilirsiniz.

Önceden yüklenmiş uygulama kabuğu ve avatar çevrimdışı açılabilir. Avatar ilk kez indirilmediyse çevrimdışı kullanılamaz. Konuşmayı yazıya çevirme tarayıcının konuşma tanıma hizmetine bağlıdır; bu hizmet internet kullanabilir veya sesi cihaz dışına gönderebilir. Tamamen çevrimdışı konuşma tanıma bu sürümde yoktur. Uygulama bu davranış hakkında ekranda uyarı gösterir.

## Android Chrome'da deneme

1. HTTPS üzerinden açılan uygulamada sayfa tamamen yüklensin.
2. Avatarın tamamlandığını ve sözlüğün hazır olduğunu bekleyin; bu ilk avatar indirmesidir.
3. Chrome menüsünden **Uygulamayı yükle** veya **Ana ekrana ekle** seçeneğini kullanın.
4. Ana ekrandaki uygulamayı açın; metin yazma, yanıtı seslendirme ve önceden indirilmiş bir işareti gösterme akışlarını deneyin.
5. Uçak modunda yeniden açıp önbelleğe alınmış uygulama kabuğunu ve avatarı kontrol edin. Mikrofonla konuşmayı yazıya çevirmenin çevrimdışı çalışacağını varsaymayın.

Bu adımlar henüz fiziksel Android cihazda doğrulanmış sayılmaz. Yayın öncesi ayrıntılı kontrol listesi [`docs/manual-android-checklist.md`](docs/manual-android-checklist.md) dosyasındadır.

## Gizlilik ve veri akışı

Elle yazılan metin ve avatar animasyonu uygulama kodunda cihazda işlenir; uygulama hesabı veya kendi uygulama sunucusu yoktur. Mikrofon yalnızca kullanıcı **Dinlemeyi başlat** düğmesine bastığında istenir. Tarayıcının konuşma tanıma özelliği uzak bir hizmet kullanabilir; bu nedenle ağ ve veri işleme ayrıntısı tarayıcı/cihaz sağlayıcısına bağlıdır. Kullanım sırasında metin geçmişi uygulama tarafından kaydedilmez. İşletim sistemi veya tarayıcı düzeyindeki saklama/telemetri davranışı bu uygulamanın denetiminde değildir.

## Kapsam ve bilinen sınırlar

- Avatar, yalnızca sözlükte birebir bulunan tekil sözcükleri Türkçe sözcük sırasıyla oynatır; **doğal TİD cümle çevirisi değildir**.
- Kameradan işaret tanıma ve işareti otomatik olarak Türkçe yazıya çevirme bu sürümde yoktur.
- Konuşma tanımanın doğruluğu, kullanılabilirliği ve internet gereksinimi tarayıcıya, cihaza ve ortama göre değişebilir; geniş cihaz kapsamı henüz ölçülmemiştir.
- Yazılım **acil durum aracı değildir**; medikal veya hayati kararlar için tek iletişim kanalı olarak kullanılmamalıdır.
- Avatar poz verileri SignBridge kaynaklıdır. Karakter modeli `rain.glb` için yeniden dağıtım izni doğrulanmamıştır. Bkz. [`ASSET-NOTICE.txt`](ASSET-NOTICE.txt) ve yayın kontrol listesi.

## Geliştirme kontrolleri

```powershell
npm test
npm run check
python -m unittest discover -s tests -p test_dev_server.py
```

Yayın adımlarını, lisans kapılarını ve cihaz kontrollerini [`docs/manual-android-checklist.md`](docs/manual-android-checklist.md) üzerinden takip edin. Haklar ve fiziksel cihaz doğrulaması tamamlanmadan genel kullanıma açmayın.

