# TİD Köprü — Ürün Tasarımı ve Tamamlama Kriterleri

**Tarih:** 25 Eylül 2026  
**Durum:** İnceleme bekliyor  
**Amaç:** Var olan PWA'yı kullanılabilir bir sürüme tamamlamak ve TİD kamera tanımayı yalnızca hakları onaylı veri ve ölçülmüş sonuçlarla ürüne eklemek.

## Ürün amacı

TİD kullanan kişi ile işiten kişinin yüz yüze iletişimini kolaylaştıran, ücretsiz, hesapsız, sunucuya bağımlı olmayan ve Android telefona PWA olarak kurulabilen bir web uygulaması sunulur. Uygulama hassas konuşma veya kamera verisini sunucuya göndermez ve kullanıcı adına karar vermez.

Başarı iki ürün düzeyinde tanımlanır:

1. **Kullanılabilir iletişim sürümü:** Mevcut metin, cihazda seslendirme, tarayıcı desteği olduğunda konuşma tanıma ve kayıtlı işaret avatarı Android Chrome'da kurulur; temel metin ve önceden indirilen varlıklar çevrimdışı açılır. Özelliklerin sınırları ekranda belirtilir.
2. **Kontrollü kamera pilotu:** Yalnızca TİD uzmanı ve katılımcı izniyle oluşturulan veriyle eğitilmiş, bilinmeyeni reddedebilen sınırlı işaret tanıma eklenir. Tanınan sözcük seslendirilmeden önce kullanıcı tarafından onaylanır.

Serbest cümle düzeyinde TİD çevirisi bu sürümlerin tamamlanma ölçütü değildir. Ayrı bir veri, dil aktarımı ve saha doğrulama programı gerektirir.

## Başlangıç durumu

Proje, Three.js avatarı ve 123 kayıtlı pozla çalışan statik bir PWA içeriyor. Türkçe metin eşleştirmesi, tarayıcı konuşma tanıma, cihaz ses sentezi, service worker önbelleği ve işaret bulunamadığında açıklama mevcut. Kamera tanıma, yerel Vosk ve yayın kurulumu henüz tamamlanmış değil. Karakter GLB dosyasının yeniden dağıtım hakkı ayrıca doğrulanmalı. Klasörde önceki Git geçmişi bulunmuyor.

## Ürün ve teknik kararlar

- Ana dağıtım hedefi HTTPS üzerinden statik PWA ve Android Chrome'dur. Yerel APK ancak PWA'nın karşılayamadığı doğrulanmış bir gereksinim çıkarsa ayrıca değerlendirilir.
- Hesap, uygulama sunucusu, ücretli API veya buluta kamera yükleme eklenmez.
- Tarayıcının yerleşik konuşma tanıması internet kullanabilir. Kullanıcıya sağlayıcıya bağlı olabileceği açıkça bildirilir ve elle yazma her zaman çalışır.
- Çevrimdışı Türkçe konuşma tanıma ayrı bir uygunluk kapısıdır. Vosk resmi kataloğunda Türkçe küçük model 35 MB ve Apache 2.0 olarak listelenir; hata oranı “TBD” durumundadır. Katalog küçük modellerin çalışma anında yaklaşık 300 MB bellek kullanabileceğini de belirtir. Bu nedenle model, tarayıcı/Android entegrasyonu ve hedef cihaz ölçümü yapılmadan zorunlu bileşen sayılmaz. [Vosk model kataloğu](https://alphacephei.com/vosk/models)
- Avatar sözlüğü birebir sözcük eşleştirmesi olarak sunulur; doğal TİD cümle çevirisi diye tanıtılmaz.
- Kamera çıktısı sözcük adayı, güven bilgisi ve tekrar/ret seçeneği verir. Düşük güven, boş kadraj, bilinmeyen ve kısmi işaret durumlarında tahmin kabul edilmez. Kamera çıktısı otomatik konuşmaya çevrilmez.
- Veri ve model sürümü, landmark sırası, ön işleme ve model sürümüyle birlikte kaydedilir. Eğitim ve final test kümelerinde aynı işaretçinin örnekleri bulunmaz.
- `rain.glb` için yayın hakkı doğrulanamazsa hak sahibi izni alınır veya dağıtım hakkı açık alternatif kullanılır. Poz/kod/bağımlılık lisans atıfları pakette kalır.

## Aşamalar ve geçiş kapıları

### A. Mevcut PWA'yı yayına hazır hale getirme

Mevcut özelliklerin işleyişi ve erişilebilirliği incelenir; çevrimdışı açılış, kesilen indirme, eski service worker önbelleği, mikrofon izni reddi, avatar yükleme hatası ve küçük ekran davranışları ele alınır. İlk açılışta indirilecek avatar ve varsa konuşma modeli için ilerleme ve hata durumu gösterilir. Ekran okuyucu etiketleri, klavye kullanımı, kontrast ve dokunma hedefleri gözden geçirilir. Yüz yüze kullanım metinlerinin tam ekran görünümü korunur.

**Geçiş koşulu:** Android Chrome'da HTTPS kurulum, yeniden açılış, çevrimdışı kullanım, izin reddi ve kurtarma akışları fiziksel cihazda doğrulanır. Dosya hakları çözülmeden halka açık dağıtım yapılmaz.

### B. Yerel konuşma tanıma uygunluk deneyi

Türkçe Vosk modeli bir prototipte ölçülür. Deney, en az 100 gerçekçi Türkçe kullanıcı cümlesiyle kelime hata oranı, gecikme, bellek, pil etkisi, ilk model indirmesi ve uçak modunda yeniden açılışı kapsar. Model kalitesi yetersizse başka ücretsiz yerel seçenekler aynı veriyle karşılaştırılır. Mevcut tarayıcı tanıması, kullanıcıya veri akışı açıklamasıyla alternatif olarak kalabilir.

**Geçiş koşulu:** Hedef orta sınıf Android cihazda tamamen yerel çalıştığı ve kullanıcıya uygun yanıt verdiği kanıtlanır. Sonuçlar, cihaz/ortam kapsamı ve hata örnekleri belgelenir; yeterli değilse özellik “çevrimdışı” olarak işaretlenmez.

### C. İzinli 20 işaret veri seti ve pilot modeli

TİD bilen sağır danışman, gündelik 20 işaretin anlamını, varyantlarını ve bağlamını onaylar. En az 20 farklı işaretçiden her işaret için en az 10 tekrar; farklı ışık, kamera uzaklığı ve arka plan koşullarıyla toplanır. Boş/dinlenme, yanlış, kısmi, kadraj dışı ve bilinmeyen örnekler de eklenir. Katılımcı izni, kullanım kapsamı, saklama süresi ve silme süreci kayıt altına alınır; izni olmayan örnekler eğitimde kullanılmaz.

MediaPipe Holistic landmark zaman dizileri üzerinde bölütleme, sınıflandırma ve bilinmeyeni reddetme denenir. Ham video yalnızca açık izin ve tanımlı saklama süresi varsa tutulur; varsayılan çıkarım cihazda yapılır. Aynı örnekler için veri/ön işleme/model sürüm imzası korunur.

**Pilot geçiş koşulları** (ürün planındaki eşikler):

- İşaretçiden bağımsız final sette macro-F1 en az 0,80.
- Boş/bilinmeyen girişlerde yanlış kabul en fazla %5.
- İşaret yokken dakikada en fazla 1 yanlış sözcük.
- Düşük güvenli örnekleri reddetme en az %90.
- Orta sınıf Android cihazda p95 öneri gecikmesi en fazla 1,5 saniye.

Eşiklerden biri sağlanmazsa kamera modülü pilot olarak yayımlanmaz; veri, etiketleme veya model iyileştirilip yeniden ölçülür.

### D. PWA ile kamera entegrasyonu ve saha doğrulaması

Model, sürümlü ve web/Android'de ortak kullanılabilen biçime aktarılır. Aynı 100 altın klipte landmark ve tahmin çıktıları karşılaştırılır; 100 ağsız klipte web ve Android sonuçlarının tutarlılığı kontrol edilir. Kamera izni, kadraj dışı el, düşük ışık, ret, durdurma ve gizlilik göstergeleri telefon arayüzünde açıkça ele alınır.

En az 30 ayrı yüz yüze TİD kullanıcı oturumunda hata türü, düzeltme süresi, ret davranışı, avatar anlaşılabilirliği ve izinler değerlendirilir. Acil/medikal kullanım test kapsamına alınmaz. Katılımcı verisi ayrıca izin olmadan yayımlanmaz.

**Geçiş koşulu:** Ölçüm eşikleri ve kullanıcı oturumları başarılı olur; açık hata türleri ve kullanım sınırı sürüm notlarında açıklanır. Kamera tahmini kullanıcı onayından önce konuşmaya dönüştürülmez.

### E. Yayın, kurulum ve bakım

Lisans envanteri, çevrimdışı ilk açılış yönergeleri, gizlilik açıklaması, desteklenen cihaz/tarayıcı bilgisi ve sınırlamalar yayın paketiyle sunulur. Statik hosting hesabı kullanıcıya ait olacak şekilde dağıtım adımları hazırlanır; kullanıcı hesabına erişim yoksa paket yayıma hazır halde teslim edilir. Güncellenen service worker eski uygulamadan güvenilir biçimde yükselir. Model ve avatar indirmeleri sürümlenir, başarısız indirme tekrar denenebilir.

**Yayın tamamlanma koşulu:** Temiz kurulum yapılan Android cihazda uygulama HTTPS üzerinden kurulmuş, yeniden açılmış ve çevrimdışı kontrol listesini geçmiş olmalı; varlık izinleri ve veri akışları doğrulanmış olmalı.

### F. Cümle düzeyi araştırma (ayrı genişleme)

Uzmanlarca etiketlenmiş, izinli cümle korpusu; gloss zaman damgaları, dil varyantları, yüz ifadesi ve iki el etkileşimi gerekir. Gloss tanıma ile Türkçe anlam aktarımı ayrı ölçülür; TİD uzmanlarıyla insan değerlendirmesi yapılır. Türkçe sözcük dizisi avatarı tam TİD çevirisi olarak sunulmaz. Bu aşama için veri/uzmanlık/finansman bulunmadan takvim veya başarı taahhüdü verilmez.

## Doğrulama yaklaşımı

Kod düzeyi doğrulama sözlük eşleştirme, Türkçe harf normalizasyonu, bilinmeyen sözcükler, boş girdi, servis çalışanı önbelleği ve hatalı indirme durumlarını kapsar. Statik dosyalar yerel HTTP sunucusunda açılır. Cihaz doğrulaması Android Chrome'da izin, mikrofon, ses sentezi, avatar animasyonu, PWA kurulum, uçak modu ve bellek/hız ölçümlerini kapsar. TİD anlaşılabilirliği yalnızca TİD kullanıcıları ve danışman değerlendirmesiyle doğrulanır.

## Kapsam dışı ve sınırlar

- Araştırma veri kümeleri (AUTSL, BosphorusSign22k, TurkSign446) ürün eğitimine hak ve lisans durumu çözülmeden katılmaz.
- Aile Bakanlığı sözlük videoları topluca kopyalanmaz.
- Uygulama tıbbi/acil karar aracı olarak konumlandırılmaz.
- Başarı iddiaları yalnızca ölçülmüş cihaz, dil varyantı, işaret listesi ve ortam kapsamı için yapılır.

## İnceleme kontrolü

- Belirsiz yayın kapsamı, bir ilk kullanılabilir sürüm ile kamera pilotu ve ayrı cümle araştırmasına bölündü.
- Konuşma tanımanın Türkçe doğruluğu kanıtlanmış varsayılmadı; kaynak model listesi TBD gösteriyor.
- Kamera pilotu için veri izni, işaretçi ayrımı, ret davranışı ve nicel eşikler tanımlandı.
- Avatar dağıtım hakkı çözülmeden yayın izni varmış gibi davranılmıyor.
- Kullanılabilir ilk sürüm ile tam cümle çevirisi ayrı başarı tanımları olarak tutuldu.
