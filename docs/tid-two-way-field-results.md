# TİD Köprü — iki yönlü saha ve entegrasyon sonucu

**Tarih:** 25 Eylül 2026
**Durum:** TAM ENTEGRASYON DOĞRULANMADI · YAYIN ENGELLİ

## Yazılım kapsamı

- Türkçe→TİD tarafında yazı/mikrofon metni, elle son düzeltme/onay, morfolojik çözümleme ve yalnızca onaylı içerik/medya oynatma yolu vardır. Paketli içerikte desteklenen cümle sayısı 0 olduğundan şu anda hiçbir Türkçe cümle TİD gösterimi üretmez.
- TİD→Türkçe tarafında onaylı gloss dizisini Türkçe adaya bağlayan, kullanıcı düzeltmesini ve ayrı onayı destekleyen kod vardır. Paketli ters yön sözlüğü boş olduğu için şu an Türkçe aday üretilemez.
- Kamera istemcisi, Web Worker, hash doğrulaması ve ayrı sürümlü indirme önbelleği yazılım olarak uygulanmıştır. Dağıtım manifestinde gerçek kamera modeli ve lisanslı çalışma zamanı bulunmadığından ürün düğmeleri kapalıdır; sayfa açılışında kamera başlamaz.
- Aday metin, `Yanıt alanına aktar` tıklamasına kadar mevcut yanıt alanını değiştirmez. Ses yalnızca ayrı Seslendir eylemiyle başlar.
- Test fixture'ları ve sentetik gözlemler sadece protokol davranışını sınar; gerçek konuşmacı, işaretleyici veya TİD anlam başarımı kanıtlamaz.

## İnsan ve cihaz sonuçları

| Ölçüm | Gereken | Yapılan |
|---|---:|---:|
| İki yönü kullanan yüz yüze TİD kullanıcı oturumu | 30 | 0 |
| Kamera cümle modeli held-out klibi | 300 | 0 |
| Bağımsız akıcı TİD incelemesi | 2 | 0 |
| Hedef Android cihaz değerlendirmesi | En az 1 | 0 |
| Temiz Android/HTTPS ve çevrimdışı kabulü | Tüm kontrol listesi | Yapılmadı |
| Aday düzeltme, anlaşılamadı ve durdurma kullanılabilirliği | Oturumlarda ölçüm | Ölçülmedi |

Bu nedenle anlam kabulü, yanlış kabul, gecikme, erişilebilirlik veya kullanıcı memnuniyeti için bir oran raporlanmamıştır. `docs/manual-android-checklist.md` tamamlanmamış fiziksel kontrolleri listeler.

## Sonraki dış bağımlılıklar

1. TİD danışmanı ve katılımcı rızasıyla zaman kodlu, kişi ayrık cümle verisi toplamak ve bağımsız uzmanlara etiketletmek.
2. MediaPipe ve ONNX çalışma zamanı/model dosyaları için yeniden dağıtım izinlerini ve MediaPipe telemetri açıklamasını doğrulamak.
3. Önceden tanımlanmış held-out ve ret kapılarını gerçek veride çalıştırmak; kalibrasyonu hedef Android telefonda ölçmek.
4. Boş olmayan ters yön gloss→Türkçe eşleşmelerini iki bağımsız akıcı TİD değerlendiricisiyle gözden geçirmek.
5. 30 ayrı yüz yüze kullanıcı oturumu ve Android erişilebilirlik/çevrimdışı kabulünü tamamlayıp sonuçları yeniden raporlamak.

Bu kanıtlar olmadan proje doğrudan kullanılabilir iki yönlü TİD çevirisi olarak tanıtılmamalıdır.
