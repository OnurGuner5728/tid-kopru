# TİD Köprü — İki Yönlü Konuşma Çevirisi Tasarımı

**Tarih:** 25 Eylül 2026
**Durum:** İnceleme bekliyor
**Amaç:** Türkçe konuşan ve TİD kullanan kişilerin gündelik, yüz yüze konuşmasını iki yönde destekleyen; sınırlarını doğru ifade eden, ölçülmüş ve kurulabilir bir ürün tanımlamak.

## Kullanıcı amacı ve başarı

Kullanıcı, karşısındaki kişinin Türkçe konuşmasını TİD olarak izlemek ve TİD kullanan kişinin kamera karşısında işaretlediği mesajı Türkçe metin/ses olarak anlamak istiyor. Türkçe ek almış sözcükler ile cümle anlamı da işlenmeli; örneğin **“sen iyisin”** yalnızca “iyi” sözcüğüne indirgenmemeli. “İyisin”deki `-sin` ikinci tekil kişiyi bildiren yüklem çekimidir, iyelik eki değildir. Uygulama bu biçimi anlamca koruyup, TİD için uzmanlarca onaylanmış uygun karşılığı üretmelidir.

Tamamlanmış ürün iki yönü de gerçekten kullanılır hale getirir:

1. **Türkçe → TİD:** Metin yazma veya isteğe bağlı ses tanıma ile Türkçe cümle alınır; kullanıcı metni gözden geçirir; uygulama anlamı TİD yapısına aktarır ve doğrulanmış işaretleri yüz/baş hareketleri de dahil olmak üzere anlaşılır sırada gösterir.
2. **TİD → Türkçe:** Kullanıcı kamerayı bilinçli olarak açar; görüntü cihazda işlenir; uygulama işaretlenen cümlenin Türkçe karşılığını önerir; kullanıcı metni onaylar/düzeltir ve isterse seslendirir.

İlk çalışır kapsam kontrollü günlük iletişimdir: selamlaşma/tanışma, aile ve kişiler, temel ihtiyaçlar, gündelik etkinlikler, zaman/yer, tercih ve basit rica, tekrar/açıklama isteme. Ekranda desteklenen kapsam adlandırılır. “Her cümleyi anlar/çevirir” iddiası ancak geniş ve bağımsız testlerle gösterilirse kullanılabilir. Desteklenmeyen cümle için yanlış bir işaret ya da anlam uydurulmaz.

## Başlangıç durumu ve sınırlar

PWA'da metin alanı, tarayıcı destekliyorsa konuşmayı yazıya çevirme, cihazın Türkçe ses sentezi ve 123 kayıtlı avatar pozu vardır. Mevcut eşleştirici Türkçe sözcükleri tek tek, yaklaşık birebir arar; Türkçe biçimbilim, TİD cümle düzeni, kamera tanıma ve cümle hareketleri yoktur. Kayıtlı poz dizisi cümle çevirisi sayılamaz. Avatar karakterinin yeniden dağıtım hakkı da yayın öncesi çözülmelidir.

TİD bir Türkçe ek-kodlama sistemi değildir. Türkçe biçimbilim, kişi/zaman/olumsuzluk/soru gibi anlam bilgilerini çıkarmaya yardım eder; bu özelliklerin TİD'de nasıl ifade edileceğine uzman onaylı aktarım karar verir. Her Türkçe eki ayrı bir işaret veya harf dizisi olarak oynatmak kabul edilmez.

## Seçenekler ve karar

1. **Birebir sözlük araması:** Çabuk ve çevrimdışı çalışır; cümle anlamını, ekleri ve TİD sırasını karşılamaz. Var olan ilk sürümün kapasitesidir, hedef mimari olamaz.
2. **Genel amaçlı bulut yapay zekâsı:** Türkçe cümle için gloss taslakları üretebilir; TİD doğruluğu, tutarlı dil bilgisi, hizmet sürekliliği ve gizlilik güvencesi vermez. Kullanıcılara doğrulamasız işaret gösteremez.
3. **Doğrulanmış paralel içerik + dil aktarımı + kontrollü model:** Türkçe biçimbilim çözümlemesini, TİD uzmanlarının onayladığı sözlük/örnek/cümle karşılıklarıyla birleştirir. Desteklenen kapsamda deterministik davranır; kapsam dışını reddeder. Önerilen yoldur.

Üçüncü yol seçilir. Makine öğrenmesi yalnızca izinli, işaretçiye göre ayrılmış veriyle eğitilir ve ölçülür. Çeviri çıktısı için kaynak cümle, çözümleme, seçilen TİD karşılığı ve oynatılabilen varlık bağlantısı izlenebilir olmalıdır.

## Ürün akışları

### A. Türkçe konuşma veya metinden TİD'e

1. Kullanıcı Türkçe yazar veya mikrofonla konuşur. Konuşma tanımanın metni kullanıcıya gösterilir; çeviriye geçmeden önce düzenlenebilir.
2. Türkçe çözümleyici sözcükleri kök/gövdeye ve dil bilgisi özelliklerine ayırır. Örneğin `iyisin` için gövde `iyi`, yüklem işlevi ve ikinci tekil kişi bilgisi saklanır; anlam değiştirici ekler atılmaz.
3. Aktarım katmanı bu yapıyı TİD söz dizimi/biçimiyle eşler. İlk kapsamda uzmanların onayladığı cümleler ve açıkça tanımlı üretken kalıplar kullanılır. `Sen iyisin` için kabul edilen ifade/işaret dizisi, yalnızca Türkçe sözcükleri sıraya dizerek belirlenmez; TİD uzmanları tarafından onaylanır.
4. Her işaret/ifade yalnızca lisansı, glossu, varyantı, TİD notu ve gösterim varlığı belirli sözlük kaydından seçilir. Gösterim, lisanslı video klip veya TİD uzmanlarınca doğrulanmış avatar animasyonu olabilir; oynatma el hareketi, zamanlama ve ilgili yüz/baş bileşenlerini taşımalıdır.
5. Çeviri kapsam dışıysa kullanıcıya Türkçe metin korunarak hangi bölümün desteklenmediği söylenir; tahmin avatarla oynatılmaz. Kullanıcı metni düzenleyebilir veya basit sözlük kipini açıkça seçebilir.

### B. Kamera ile TİD'den Türkçeye

1. Kamera yalnızca kullanıcı “Kamerayı aç” dediğinde ve izin verdiğinde çalışır. Canlı durum göstergesi ve açık durdurma kontrolü görünür.
2. Kamera kareleri ve landmark'ler varsayılan olarak cihazda, bellekte işlenir; kaydedilmez ve ağa gönderilmez. Sunucu/bulut kamera akışı, canlı üründe yoktur.
3. Tanıma hattı el, beden, yüz ve zaman bilgilerini kullanır. Tekil sözcük tanıma için eğitilmiş model, cümle çevirisi olarak sunulamaz. Cümle kapsamı için akıcı işaret videoları, gloss zamanlaması, yüz/baş dil bilgisi ve Türkçe karşılık içeren ayrı, izinli veri gerekir.
4. Model tamamlanmış bir ifade ve güven/ret durumu üretir. Düşük güven, eksik işaret, kamera dışı hareket ve bilinmeyen ifade “anlaşılamadı” olarak kalır. Kullanıcı onaylamadan metin kabul edilmez ve ses çalmaz.
5. Onaylanan Türkçe metin büyük gösterilebilir veya cihaz sesiyle okutulabilir. Düzeltme, kullanıcı istemedikçe saklanmaz.

### C. Çeviri hizmeti ve içerik biçimi

Uygulama, arayüzden bağımsız iki yerel arayüze sahip olur:

- `translateTurkishToTid(text, locale, scopeVersion)` → çözümleme, TİD ifadesi, destek durumu, onaylı varlık sırası ve gerekirse açıklama.
- `translateTidToTurkish(observation, modelVersion)` → Türkçe öneri, güven/ret nedeni, destek kapsamı ve kaynak gloss dizisi.

Sözlük girdisi Türkçe yüzey biçimini, lemma ve dil bilgisi özelliklerini; gloss/konsept kimliğini; TİD açıklamasını ve bölgesel/kişisel varyantı; uzman ve içerik sürümünü; medya/animasyon lisansını ve zaman bilgisini taşır. Cümle girdisi Türkçe örnek, TİD karşılığı, gloss hizalaması, el dışı dil bileşenleri, bağlam/niyet ve onay durumunu içerir. Her yayımlanacak karşılık iki bağımsız, akıcı TİD değerlendiricisi tarafından onaylanır; anlaşmazlık üçüncü değerlendiriciyle karara bağlanır. Kişi adları ve katılımcı kimliği uygulama sözlüğüne konmaz.

## Veri ve içerik planı

- Mevcut 123 kayıt başlangıç sözlüğüdür; her kaydın kaynağı, anlamı, lisansı ve TİD anlaşılabilirliği ayrı ayrı teyit edilmeden yeni çeviri kapsamına alınmaz.
- Boğaziçi TULAP'taki 1.950 Türkçe–TİD yazılı cümle açıklaması olası başlangıç paralel kaynağıdır ve Apache 2.0 olarak listelenmiştir. Bu kaynak gloss/işaret videosu veya animasyon verisi değildir; üretime alınmadan önce indirilen dosyanın lisansı ve örnekleri gözden geçirilip TİD uzmanlarınca doğrulanır. [TULAP Sign Language Corpus](https://tulap.cmpe.boun.edu.tr/items/4bccab49-30e9-4c94-bdd0-ae5171e074f9/full)
- TİD makine-okunur kaynak çalışmaları gloss, sınıflandırıcılar, non-manual işaretler ve yapısal işaretlemelerin gerekliliğini gösterir; bunlar hazır bir ürün modeli olduğu anlamına gelmez. [ITU'da TİD makine-okunur kaynak çalışması](https://research.itu.edu.tr/en/publications/building-the-first-comprehensive-machine-readable-turkish-sign-la/)
- Eğitim ve değerlendirme verisinde kişi bazlı ayrım zorunludur. Katılımcı izni, kullanım amacı, saklama süresi ve silme yolu çekimden önce belirlenir; ham video varsayılan olarak tutulmaz. Sözlük videosu veya kamu araştırma seti lisansı kapsamı açıkça izin vermedikçe kopyalanmaz.
- TİD bilen sağır dil danışmanı/çevirmen içerik, varyant, cümle eşdeğerliği, yüz ifadesi ve ret metinlerini onaylar. Kullanıcı testi erişilebilir rıza ve ücretli/uygun katılımcı emeği ile yapılır.

## NVIDIA ve üretken modeller

NVIDIA API anahtarı tarayıcıya veya Git deposuna konmaz. NVIDIA'nın hosted API belgeleri bu hizmetleri prototip için tanımlar; deneme koşulları üretim kullanımını dışlar ve belirli hizmetlerde yüklenen içeriğin saklanabileceğini, hassas insan verisinin kısıtlı olduğunu belirtir. [NVIDIA NIM kullanım seçenekleri](https://docs.api.nvidia.com/nim/docs/run-anywhere), [NVIDIA API deneme koşulları](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf)

Bu nedenle ücretsiz hosted endpoint canlı konuşma metni, katılımcı videosu, landmark veya doğrulanmamış çeviri için kullanılmaz. Gerekirse yalnızca kimliksiz/sentetik Türkçe örneklerle, dahili araştırma deneyi yapılabilir: model TİD öneri taslağı çıkarır; çıktı veri setine veya kullanıcıya girmeden uzman incelemesi ve held-out değerlendirmeden geçer. Bu deneme ürüne bağımlılık yaratmaz. Mevcut API anahtarı konuşmada açığa çıktığı için kullanımdan önce iptal edilip yenilenmelidir.

## Gizlilik, güvenlik ve erişilebilirlik

- Metin ve medya için kullanıcıya hangi işlem türünün cihazda veya harici sağlayıcıda gerçekleştiği anlaşılır dille gösterilir. Varsayılan çeviri yolu sunucu gerektirmez.
- Kamera izin isteği kullanıcı eyleminden sonra gelir; durdurma, sekmeden çıkma ve hata durumunda kamera izleri kapanır.
- Kamera görüntüsü/landmark, açık ve ayrı bir veri toplama izni olmadan dosyaya, günlüğe veya ağa yazılmaz.
- Çevrimdışı sözlük ve medya indirmesi sürümlüdür; başarısız indirme tekrar denenebilir ve eski sürüme dönüş yolu bulunur.
- Klavye, ekran okuyucu, kontrast, metin büyütme, dokunma alanı ve büyük gösterim temel akışlarla birlikte tasarlanır. Metin düzeltmesi ve avatar oynatma durdurulabilir.

## Aşamalar ve tamamlanma kapıları

### 1. İçerik ve dil temeli

Varlık lisans envanteri; en az iki akıcı TİD değerlendiricisi ve üçüncü anlaşmazlık hakemi; veri şeması; yukarıda tanımlanan günlük iletişim kapsamı; onaylı Türkçe–TİD cümle ve gloss tabanı hazırlanır. İlk değerlendirme kümesi en az 300 Türkçe cümle örneği içerir; kişi, zaman, olumsuzluk, soru, iyelik ve çekim çeşitleri dengeli temsil edilir. Aynı cümlenin yazım/varyant biçimleri tek bir veri bölümünde kalır. `sen iyisin` ve çekimli/iyelik biçimleri gibi örnekler kapsam matrisinde bulunur.

**Kapı:** Her destek etiketi ve animasyon/medya lisansı kaynakla bağlı; ilk test kümesindeki her cümle iki değerlendirici tarafından bağımsız gözden geçirilmiş, görüş ayrılıkları üçüncü değerlendiriciyle çözülmüştür.

### 2. Türkçe → TİD kullanılabilir sürüm

Türkçe çözümleme ve uzman onaylı aktarım önce kurallı/cümle şablonlu uygulanır. Kaynak metin ve çıktı birlikte gösterilir; desteklenmeyen öğeler işaretlenir. Metin ve mevcut ses tanıma akışı bu katmana bağlanır. Gerçek TİD hareketi olmayan metinsel gloss, kullanıcıya animasyonmuş gibi gösterilmez.

**Kapı:** Önceden ayrılmış en az 300 cümlelik testte, anlaşmazlıkları hakemle çözülen iki bağımsız TİD değerlendiricisi çıktıları puanlar; cümlelerin en az %90'ı ikisi tarafından anlamca kabul edilebilir bulunur. Kişi/olumsuzluk/soru/zaman/iyelik ve varyant alt kümeleri ayrıca raporlanır. Kapsam dışı örneklerde sistem çeviri uydurmaz. Desteklenen tüm öğelerin lisanslı video klibi veya doğrulanmış animasyon gösterimi vardır.

### 3. Kamera ile tekil işaret kontrollü pilotu

Önce 20 işaretli, açıkça sınırlandırılmış pilot hazırlanır. En az 20 farklı imzalayan kişiden, her işaret için kişi başına en az 10 tekrar alınır; ışık, kamera uzaklığı ve arka plan çeşitlendirilir; train/validation/test kümeleri imzalayan kişiye göre ayrılır. Boş, bilinmeyen, kısmi ve kadraj dışı durumları değerlendirilir. Model cihazda çalışır; kullanıcı aday metni onaylar.

**Kapı:** Held-out katılımcılarda macro-F1 en az 0,80; boş/bilinmeyen yanlış kabul en fazla %5; boş kullanımda dakikada en fazla 1 yanlış sözcük; düşük güvenli örnekleri reddetme en az %90; hedef Android telefonda p95 öneri gecikmesi en fazla 1,5 saniyedir. Başarısız metrikte pilot yayımlanmaz.

### 4. TİD cümlesinden Türkçeye

Tekil işaret pilotu, cümle tanıma başarısı gibi etiketlenmez. Cümle hattı için yeni izinli, uzman etiketli akıcı TİD videoları ve gloss zamanlamaları toplanır; iki el, yüz/baş bileşenleri, eşzamanlılık, varyant ve bağlam anotasyonu yapılır. Eğitimde yer almayan en az 20 imzalayan kişiden en az 300 ayrı değerlendirme klibi gerekir. Model sadece bu kapsam için eğitilir ve telefon üzerinde değerlendirilir. Kullanıcıya tek bir adayla birlikte ret/düzeltme verilir.

**Kapı:** Önceden ayrılmış, imzalayanı eğitimde yer almayan en az 20 kişiden gelen en az 300 ayrı değerlendirme klibinde, iki bağımsız TİD değerlendiricisi uzlaştırma sonrası Türkçe karşılıkların en az %90'ını anlamca kabul edilebilir bulur; destek dışı cümlelerin yanlış kabulü en fazla %5'tir. Aday onayı, gizlilik, Android performansı ve saha oturumları geçmeden özellik yayımlanmaz.

### 5. Birleştirme ve yayın

İki yön aynı konuşma ekranına bağlanır; durum, onay, düzeltme, oynatma ve ret akışları en az 30 ayrı yüz yüze TİD kullanıcı oturumunda denenir. Temiz Android Chrome kurulumunda çevrimiçi/çevrimdışı, izin reddi, yeniden açılış, varlık indirmesi ve iki yön uçtan uca denenir. Konuşma tanıma tarayıcı hizmeti kullanıyorsa bu durum belirtilir ve elle yazma her zaman çalışır. Lisans, gizlilik metni, desteklenen kapsam ve hata sınırları uygulamada yer alır.

**Tamamlanma:** Her iki yön yukarıdaki kapılardan geçer; temiz cihaz kurulumunda başka kişiye hesap/terminal gerektirmeden kullanım açılır; bağımsız TİD kullanıcıları test edilen kapsamda akışı tamamlar. Kapılardan biri geçilmezse ürün yalnızca geçen yönü açıkça “pilot/ilk sürüm” olarak sunar; iki yönlü tam çeviri diye adlandırılmaz.

## Ölçüm ve doğrulama

- Türkçe → TİD: uzmanların anlam uygunluğu, eksik/yanlış bilgi, kişi/zaman/kip/olumsuzluk/soru alt kümeleri, destek dışı ret oranı ve gerçek animasyon anlaşılabilirliği.
- TİD → Türkçe: cümle anlam uygunluğu, ret/yanlış kabul, kişi ve varyant genellemesi, gecikme, kullanıcı düzeltme oranı ve anlaşılma süresi.
- Her model değerlendirmesinde veri, etiket, içerik, model ve ön işleme sürümü kaydedilir. Train/validation/test arasında imzalayan kişi veya yinelenen cümle bulunması değerlendirmeyi geçersiz kılar.
- Otomatik doğrulama arayüz protokolü, Türkçe normalizasyonu, biçimbilim çözümleme, destek dışı ret, varlık yüklemesi, çevrimdışı davranış ve kamera izin/durdurma yollarını kapsar. TİD kalitesi otomatik test skoru ile kanıtlanmış sayılmaz.

## Kaynaklar ve doğrulanması gereken lisanslar

- TULAP, 1.950 Türkçe cümle ile TİD cümle açıklamaları içerdiğini ve Apache 2.0 lisansını listeler: [kayıt](https://tulap.cmpe.boun.edu.tr/items/4bccab49-30e9-4c94-bdd0-ae5171e074f9/full).
- TİD yapısı ve cümle düzeni için: [ITU makine-okunur kaynak çalışması](https://research.itu.edu.tr/en/publications/building-the-first-comprehensive-machine-readable-turkish-sign-la/), [ODTÜ TİD dilbilgisi/kelime sırası tezi](https://open.metu.edu.tr/handle/11511/16407).
- Hosted NVIDIA NIM prototipleme ve deneme kısıtları: [NIM belgeleri](https://docs.api.nvidia.com/nim/docs/run-anywhere), [deneme koşulları](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf).
- Avatar, sözlük videosu, araştırma veri setleri, animasyon araçları ve model lisansları varlık bazında ayrıca doğrulanır; adı geçen kaynakların varlığı üründe kullanma izni olduğu anlamına gelmez.

## Kapsam dışı

- Her şehir/bölge, yaş ve kişisel varyant için genel başarı iddiası.
- Sağlık, acil durum, hukuki veya başka yüksek riskli iletişimde tek çeviri kanalı olma.
- Canlı kullanıcı içeriğini ücretsiz bulut modeline gönderme veya API anahtarını istemciye ekleme.
- Uzman onayı olmadan Türkçe ekleri işaretlere mekanik olarak dönüştürme.
- Gösterim/lisans verisi olmayan kavramlarda hareket uydurma.
