# TİD Köprü Hibrit Çeviri Tasarımı

**Tarih:** 25 Eylül 2026  
**Durum:** Kullanıcı tarafından konuşmada onaylanan mimari tasarım  
**Kapsam:** Cihaz içi kamera ve mikrofon akışı, kişisel işaret öğretme, indirilebilir yerel model, isteğe bağlı bulut adayı, Türkçe çözümleme ve TİD gösterimi

## 1. Amaç

TİD Köprü, Türkçe konuşan bir kişi ile Türk İşaret Dili (TİD) kullanan bir kişinin aynı cihaz üzerinden yüz yüze iletişim kurmasını kolaylaştıracaktır.

Kullanıcı şunları yapabilmelidir:

- Kamera ile işaret dizisi kaydedip Türkçe aday metin alabilmek.
- Türkçe metin yazmak veya mikrofonla söylemek.
- Türkçe girdiyi TİD sözlük hareketleri, onaylı cümle kalıpları ve gerektiğinde harfleme ile gösterebilmek.
- Yerel, indirilebilir model ve isteğe bağlı bulut katmanlarını birlikte kullanabilmek.
- Kamera, mikrofon ve ağ izinlerini ayrı ayrı yönetebilmek.
- Yerel modda görüntü, ses, landmark ve metni cihazdan çıkarmadan çalışabilmek.

Başarı, her görünür kontrolün çalışması, yerel modun ağ olmadan kullanılabilmesi, desteklenmeyen girdinin sessizce yanlış çevrilmemesi ve her sonucun kaynağının kullanıcıya açıkça belirtilmesiyle ölçülür.

## 2. Ürün doğruluğu sınırı

Mevcut depo, 123 adet SignBridge iskelet pozu içerir. Bu pozlar tek karelik rig değerleridir; doğal TİD cümle hareketi, yüz ifadesi, ağız hareketi veya süre bilgisi sağlamaz. Depoda uzman onaylı cümle medyası ve eğitilmiş sürekli TİD tanıma modeli yoktur.

Bu nedenle sürüm üç ayrı çıktı sınıfı kullanacaktır:

1. **Onaylı TİD:** Kaynağı, lisansı ve iki bağımsız TİD incelemesi kayıtlı içerik.
2. **Sözlük/harfleme gösterimi:** Mevcut pozların veya harf kartlarının art arda gösterimi. Bu çıktı iletişim desteğidir; doğal TİD cümlesi olarak etiketlenmez.
3. **Yapay zekâ adayı:** Yerel veya bulut modelinin ürettiği, kullanıcı onayı gerektiren deneysel aday.

Genel amaçlı NVIDIA VLM modellerinin video kabul etmesi, bu modellerin TİD çevirmeni olduğu anlamına gelmez. NVIDIA katmanı yalnızca deneysel aday üretir. Kesin TİD çevirisi etiketi ancak TİD verisiyle eğitilmiş model ve saha değerlendirmesi yayın kapılarını geçtiğinde kullanılabilir.

## 3. Mimari

Uygulama kurulabilir bir PWA olarak GitHub Pages üzerinde kalır. Tarayıcı arayüzü beş bağımsız birim kullanır:

### 3.1 İzin ve gizlilik yöneticisi

- Kamera yalnızca kullanıcı “Kamerayı aç” düğmesine bastığında istenir.
- Mikrofon yalnızca kullanıcı “Dinlemeyi başlat” düğmesine bastığında istenir.
- Bulut modu ayrı bir anahtarla açılır ve her oturumda görüntü gönderimi açıklanır.
- Bulut kapalıyken uygulamanın çeviri kodu hiçbir kare, video, landmark, ses veya metin göndermez.
- İzin reddedildiğinde elle metin girişi ve yerel içerik kullanılabilir kalır.
- Kamera ve mikrofon durdurma işlemi MediaStream izlerini hemen kapatır.

### 3.2 Cihaz içi görsel işlem hattı

- Kamera karelerinden el, yüz ve üst gövde landmark'ları çıkarılır.
- Ham kareler kalıcı depolamaya yazılmaz.
- Landmark dizileri normalize edilir; ölçek, konum ve mümkün olduğu kadar kamera açısı etkisi azaltılır.
- İşaret başlangıç ve bitişi hareket enerjisi, kararlı bekleme ve kullanıcı “Bitir” düğmesiyle belirlenir.
- İşlem Web Worker içinde yürütülür; arayüz iş parçacığı donmaz.
- Yerel model paketi manifest, SHA-256 özeti, lisans ve içerik sürümü doğrulandıktan sonra açılır.

### 3.3 Yerel tanıma katmanları

Tanıma sırası aşağıdaki gibidir:

1. **Kişisel öğretme modeli:** Kullanıcı bir sözlük girdisi için en az üç örnek kaydeder. Örnek landmark dizileri yalnızca IndexedDB içinde saklanır. Dinamik zaman hizalama ve en yakın örnek karşılaştırmasıyla kişiye özel aday üretilir.
2. **İndirilebilir TİD modeli:** Manifestte kullanılabilir olarak işaretlenmiş, hash doğrulaması geçen ONNX model tarayıcıda çalıştırılır.
3. **İsteğe bağlı bulut adayı:** Kullanıcı açıkça etkinleştirdiyse ve yerel güven eşiği aşılmadıysa kısa klip bulut sağlayıcısına gönderilebilir.

Katmanlar tek bir aday biçimi döndürür: `text`, `glosses`, `confidence`, `source`, `warnings` ve `needsConfirmation`. Bir katmanın düşük güvenli sonucu diğerini ezmez. Kullanıcı onayı olmadan aday konuşma geçmişine eklenmez veya seslendirilmez.

### 3.4 Türkçe çözümleme ve TİD gösterimi

- Metin elle girilebilir veya tarayıcının konuşma tanımasıyla oluşturulabilir.
- Türkçe çözümleyici kişi, sayı, iyelik, durum, zaman, olumsuzluk ve soru bilgilerini koruyan bir ara gösterim üretir.
- Onaylı cümle eşleşmesi varsa doğrudan onaylı içerik oynatılır.
- Onaylı cümle yoksa sözlük gloss dizisi oluşturulur ve bunun “sözlük dizimi” olduğu belirtilir.
- Bilinmeyen özel adlar ve sözcükler harf harf gösterilir. Harfleme görseli TİD uzmanı tarafından onaylanana kadar “harf kartı” olarak etiketlenir.
- Mevcut SignBridge pozları, yeniden dağıtım hakkı belirsiz eski karakter modeli yerine projeye ait basit bir prosedürel iskelet üzerinde gösterilir.
- Statik pozlar arasında yumuşak geçiş yapılır; bu geçiş doğal işaret hareketi olarak sunulmaz.
- Yüz ifadesi ve el dışı işaretler için veri bulunmadığında arayüz eksikliği açıkça gösterir.

### 3.5 Bulut sağlayıcı köprüsü

Bulut desteği sağlayıcıdan bağımsız bir arayüz kullanır. İlk sağlayıcı NVIDIA NIM olabilir.

- Yayınlanan JavaScript dosyalarına API anahtarı gömülmez.
- Güvenli sunucu uç noktası varsa anahtar sunucu sırrında tutulur.
- Yalnızca statik site kullanılacaksa kullanıcı kendi anahtarını oturum için girebilir; anahtar diske yazılmaz ve servis çalışanı önbelleğine girmez.
- Önceden konuşmada paylaşılmış anahtar kodda, Git geçmişinde veya dağıtım ayarında kullanılmaz.
- Bulut sonucu `source: cloud-candidate` olarak işaretlenir ve kullanıcı onayı ister.
- Sağlayıcı hatası yerel akışı kesmez.
- Genel VLM çıktısı, yayın kapılarından geçmeden TİD çevirisi olarak değerlendirilmez.

## 4. Kullanıcı akışları

### 4.1 Kamera ile TİD'den Türkçeye

1. Kullanıcı yerel, akıllı hibrit veya bulut destekli modu seçer.
2. Kamera düğmesine basar ve tarayıcı iznini verir.
3. Görüntü cihaz içinde landmark dizisine çevrilir.
4. Yerel kişisel model ve varsa indirilebilir model aday üretir.
5. Güven düşükse kullanıcı yeniden deneyebilir, metni düzeltebilir veya bulut adayı isteyebilir.
6. Kullanıcı metni onayladığında konuşma geçmişine eklenir ve isteğe bağlı olarak Türkçe seslendirilir.

### 4.2 Türkçe konuşma/metinden TİD'e

1. Kullanıcı metin yazar veya mikrofonu açar.
2. Tanınan metin düzenlenebilir alanda gösterilir.
3. Kullanıcı metni onaylar.
4. Çözümleyici cümle özelliklerini çıkarır.
5. Onaylı içerik, sözlük pozları ve harf kartları kaynak etiketiyle sıralanır.
6. Kullanıcı oynatmayı durdurabilir, yavaşlatabilir, tekrarlayabilir veya adım adım ilerletebilir.

### 4.3 Kişisel işaret öğretme

1. Kullanıcı sözlükten bir etiket seçer.
2. Uygulama aynı işaret için en az üç örnek ister.
3. Örneklerin landmark bütünlüğü ve süre aralığı cihazda kontrol edilir.
4. Kullanıcı örnekleri kaydeder veya siler.
5. Model yalnızca bu cihazdaki kullanıcıya özel olarak etkinleşir.
6. Tüm kişisel veriler tek düğmeyle silinebilir ve dışa aktarım varsayılan olarak kapalıdır.

## 5. Hata ve belirsizlik davranışları

- Kamera izni reddedilirse kamera bölümü açık bir mesaj gösterir; metin akışı çalışmaya devam eder.
- Landmark çıkarılamazsa kullanıcıya ışık, kadraj ve iki el görünürlüğü konusunda kısa yönlendirme verilir.
- Model dosyasının hash'i uyuşmazsa model çalıştırılmaz ve bozuk önbellek silinir.
- Model yüklenemezse uygulama kişisel öğretme veya metin moduna döner.
- Ağ kesilirse bulut isteği iptal edilir ve yerel sonuç korunur.
- Bulut zaman aşımında aynı medya otomatik olarak yeniden gönderilmez.
- Bir sonuç güven eşiğinin altındaysa “anlaşılamadı” gösterilir; tahmin konuşma geçmişine eklenmez.
- İçerik karşılığı yoksa sözlük/harfleme gösterimi kullanılır ve bu durum görünür kalır.
- Kamera veya mikrofon sekme kapanırken ve sayfa arka plana alınırken kapatılır.

## 6. Veri, lisans ve sürümleme

- Her içerik varlığı kaynak, lisans, SHA-256, TİD inceleme durumu ve içerik sürümü taşır.
- Kişisel kamera örnekleri yayın paketine veya analitiğe eklenmez.
- SignBridge pozları MIT lisans bildirimiyle kullanılmaya devam eder.
- Yeniden dağıtım hakkı doğrulanmayan `rain.glb` kamu paketine eklenmez.
- Araştırma veri kümeleri, kendi kullanım koşulları ticari veya kamu dağıtımına izin vermeden site paketine eklenmez.
- İçerik ve model manifestleri birbirine aynı `contentVersion` üzerinden bağlanır.

## 7. Doğrulama ve kabul ölçütleri

### 7.1 Yazılım kabulü

- Kamera ve mikrofon yalnızca kullanıcı işlemiyle açılır; durdurulduğunda MediaStream izleri kapanır.
- Yerel modda uygulama çeviri girdilerini ağa göndermez.
- Kişisel öğretme örnekleri sayfa yenilendiğinde kalır ve “verilerimi sil” işlemiyle tamamen kaldırılır.
- Sözlükteki mevcut 123 etiket prosedürel gösterici tarafından yüklenebilir.
- Bilinmeyen her Türkçe sözcük için uygulama boş ekran yerine harf kartı veya açık desteklenmiyor mesajı üretir.
- `Sen iyisin`, `Ben iyiyim`, iyelik, olumsuzluk, soru ve temel zaman örnekleri dilbilgisi özelliklerini kaybetmeden ara gösterime çevrilir.
- Düşük güvenli kamera adayı kullanıcı onayı olmadan geçmişe eklenmez.
- Çevrimdışı mod, ilk kurulumdan sonra uygulama kabuğunu ve yerel içerikleri açar.
- API anahtarı kaynak dosyalarda, Git geçmişinde, servis çalışanında veya tarayıcının kalıcı deposunda bulunmaz.
- GitHub Pages alt dizin yolu altında tüm varlıklar doğru yüklenir.

### 7.2 TİD ürün kabulü

“Tam doğal TİD çevirisi” etiketi için aşağıdaki kapılar birlikte geçilmelidir:

- En az 300 izinli, tutulmuş cümle klibi.
- En az 20 eğitimden ayrılmış işaretçi.
- İki bağımsız akıcı TİD değerlendiricisi.
- En az %90 anlamsal kabul.
- En fazla %5 yanlış kabul.
- Hedef Android cihazlarda ölçülmüş gecikme ve bellek sonuçları.
- En az 30 yüz yüze kullanım oturumu.

Bu kapılar geçilmeden yazılım çalışır durumda olabilir; ancak sözlük dizimi, kişisel model ve yapay zekâ adayları doğal TİD çevirisi diye etiketlenmez.

## 8. Dağıtım sırası

1. İzin merkezi, mod seçici ve sonuç kaynağı etiketleri.
2. Prosedürel iskelet gösterici, sözlük dizimi ve harf kartı geri dönüşü.
3. Yerel landmark çıkarma, kişisel öğretme ve kişiye özel tanıma.
4. Doğrulanmış indirilebilir model adaptörü.
5. İsteğe bağlı NVIDIA adayı ve güvenli anahtar yönetimi.
6. Çevrimdışı önbellek, veri silme ve erişilebilirlik tamamlaması.
7. Otomatik yazılım kontrolleri, Android tarayıcı kontrolü ve canlı site yayını.
8. TİD veri ve uzman inceleme programı tamamlandıkça onaylı içerik sürümleri.

## 9. Kaynaklar

- NVIDIA NIM çoklu ortam girdisi: <https://docs.nvidia.com/nim/large-language-models/latest/advanced-use-cases/multimodal-input.html>
- AUTSL veri kümesi makalesi: <https://arxiv.org/abs/2008.00932>
- BosphorusSign22k veri kümesi: <https://github.com/ogulcanozdemir/bosphorussign22k>
- İzole işaret tanımanın sürekli çeviri sınırını açıklayan Signa projesi: <https://github.com/V4HD3T/signa>

