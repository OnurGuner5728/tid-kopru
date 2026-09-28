# Kamera → Türkçe adayı değerlendirmesi

**Tarih:** 25 Eylül 2026

**Yerel çalışma zamanı:** MediaPipe Tasks Vision 1.0.1

**İsteğe bağlı ONNX çalışma zamanı:** ONNX Runtime Web 1.30.0

**Genel TİD cümle modeli:** Yok (`sentence-model-manifest.json`: `available: false`)

**Mevcut işlev:** Kişisel işaret öğretme ve eşleştirme

## Çalışan akış

- Kamera yalnızca kullanıcı **Kamerayı aç** düğmesine bastığında izin ister.
- MediaPipe el, yüz ve gövde landmark'larını cihazda çıkarır.
- Bir sözlük etiketi en az üç hareket örneğiyle kişisel olarak öğretilebilir.
- Ham kamera görüntüsü kişisel veri deposuna yazılmaz; yalnızca normalize edilmiş sayısal hareket dizileri IndexedDB'de saklanır.
- Kişisel örnekler DTW tabanlı, uyarlanır eşikle karşılaştırılır. Eşik aşılmazsa aday üretilmez.
- Kamera durdurulduğunda veya sayfa gizlendiğinde medya izleri bırakılır.
- Sonuç düzenlenebilir Türkçe adaydır; kullanıcı **Yanıt alanına aktar** demeden cevap veya ses üretmez.
- Tek etiket veya bütün kişisel veri kullanıcı tarafından silinebilir.

## Hibrit kaynak sırası

1. Kişisel yerel eşleştirme.
2. Varsa SHA-256 doğrulanmış yerel ONNX cümle modeli. Mevcut pakette yoktur.
3. Yalnızca **Bulut destekli** mod, ayrı kısa klip izni ve oturum anahtarı varsa NVIDIA genel amaçlı video adayı.

NVIDIA sonucu doğrulanmış TİD çevirisi değildir. Güveni 0,55 ile sınırlandırılır, kaynağı ve uyarıları gösterilir ve her zaman kullanıcı onayı ister. API anahtarı kalıcı depoya yazılmaz.

## Doğal konuşma tanıma kanıtı

| Kapı | Gereken | Mevcut | Durum |
| --- | ---: | ---: | --- |
| İzinli, zaman kodlu held-out TİD klibi | En az 300 klip | 0 / 300 | Bekliyor |
| Eğitimde görülmemiş işaretleyici | En az 20 kişi | 0 | Bekliyor |
| Bağımsız akıcı TİD değerlendiricisi | İki bağımsız kişi | 0 | Bekliyor |
| Türkçe anlam kabulü | En az %90 | Ölçülmedi | Bekliyor |
| Destek dışı yanlış kabul | En fazla %5 | Ölçülmedi | Bekliyor |
| Hedef Android doğruluk/gecikme | Ölçülmüş cihaz sonucu | Ölçülmedi | Bekliyor |
| Yüz yüze TİD kullanıcı oturumu | En az 30 oturum | 0 | Bekliyor |

Bu nedenle mevcut sürüm kişisel olarak öğretilen sınırlı işaretlerde yardımcı aday üretir; bilinmeyen tüm TİD konuşmalarını çözen genel kamera çevirmeni olarak değerlendirilmez. Fiziksel Android kamera, performans, ısınma ve erişilebilirlik ölçümü yapılmadı.
