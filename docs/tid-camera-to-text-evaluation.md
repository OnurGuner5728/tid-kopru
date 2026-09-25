# TİD kamera → Türkçe değerlendirme

**Tarih:** 25 Eylül 2026
**Durum:** YAYIN ENGELLİ · KAMERA KAPALI
**Model sürümü:** Yok (`sentence-model-manifest.json`: `available: false`)
**İçerik sürümü:** `pilot-content-0`

Bu rapor ölçülmüş sonuçları ve eksik kanıtları ayırır. Yazılım testlerinin geçmesi, TİD tanıma başarımı ölçümü sayılmaz.

## Gerçek veri ve insan değerlendirmesi

| Kapı | Gereken | Mevcut kanıt | Sonuç |
|---|---:|---:|---|
| İzinli, zaman kodlu TİD cümle klibi | En az 300 | 0 | Açık |
| Eğitimde görülmemiş değerlendirici | En az 20 imzalayan kişi | 0 | Açık |
| Bağımsız akıcı TİD değerlendiricisi | 2 ve anlaşmazlık hakemi | 0 | Açık |
| Türkçe anlam kabulü | Uzlaştırma sonrası en az %90 | Ölçülmedi | Açık |
| Destek dışı yanlış kabul | En fazla %5 | Ölçülmedi | Açık |
| Hedef Android p95 öneri gecikmesi | Ölçülmüş cihaz sonucu | Ölçülmedi | Açık |
| Yüz yüze TİD kullanıcı oturumu | En az 30 | 0 | Açık |

İzin, TİD danışmanı onayı, katılımcı ve rıza eşleme kayıtları ile ham çalışma verisi yoktur. Bu rapora sentetik testlerden insan sonucu veya başarı oranı türetilmemiştir.

## Dağıtım paketindeki durum

- TİD→Türkçe aday eşleştiricisi yalnızca gloss sırası ve non-manual işaretleri iki bağımsız değerlendirici tarafından onaylanmış cümle kaydıyla eşleştirir. Dağıtım gloss sözlüğü, cümle, şablon ve onaylı aday bakımından boştur.
- İstemci ve worker kodu; aynı-kaynak ve SHA-256 denetimi, açık kullanıcı eylemi, kare aktarımı, ret, hata, durdurma ve kamera izlerini kapatma protokolünü içerir.
- `sentence-model-manifest.json` kullanılabilir model veya dosya bildirmez. Lisanslı MediaPipe/ONNX çalışma zamanı ve eğitilmiş cümle ONNX modeli pakette yoktur.
- Model indirme/başlatma düğmeleri bu nedenle kapalıdır; sayfa yüklemesi kamera izni istemez. Kullanıcıya MediaPipe kullanım/performans ölçümü ile sistem ortamı verilerinin Google'a gönderilebileceği bildirilir; sıfır ağ trafiği vaadi verilmez.
- Model dosyası hazır olduğunda tasarlanan indirme akışı dosyaları aynı kaynaktan getirir, karmaları doğrular ve ancak başarılı kurulumdan sonra eski `tid-camera-model-*` önbelleğini kaldırır. Kamera kareleri ve landmark'lar önbelleğe alınmaz.

## Yayın kararı

Bu yön çalışan bir kamera çevirisi olarak kullanılamaz. Gerekli veri, lisanslı çalışma zamanı, eğitimli model, uzman incelemesi ve cihaz/alan kanıtları sağlanmadan `available` değeri `true` yapılmamalı ve kamera açılmamalıdır.
