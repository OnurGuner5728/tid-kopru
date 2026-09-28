# Türkçe → TİD gösterimi değerlendirmesi

**Rapor tarihi:** 25 Eylül 2026

**Yazılım durumu:** Kullanılabilir deneysel gösterim

**Doğal TİD doğrulaması:** Bekliyor

**İçerik sürümü:** `pilot-content-0`

## Mevcut ölçülebilir kapsam

| Ölçüm | Mevcut sonuç | Açıklama |
| --- | ---: | --- |
| SignBridge kaynaklı sözlük pozu | 123 | Basit iskelette statik poz/geçiş olarak oynatılır |
| Uzman onaylı doğal TİD cümle | 0 | Cümle düzeyinde akıcı TİD iddiası yoktur |
| Lisanslı cümle videosu | 0 | Video yerine kaynak etiketi gösterilir |
| Bilinmeyen görünür sözcük desteği | Var | Harf kartı; parmak alfabesi veya doğal TİD diye sunulmaz |
| Biçimbilim kapsamı | Var | Kişi, iyelik, olumsuzluk, soru, gelecek zaman ve özel ad tamlaması |
| Held-out insan değerlendirmesi | 0 / 300 cümle | Henüz yapılmadı |
| Akıcı TİD değerlendiricisi | 0 / 2 | Henüz yapılmadı |
| Fiziksel Android değerlendirmesi | Yapılmadı | Ayrı kontrol listesi bekliyor |

`Sen iyisin`, `Ben iyi değilim`, `Annemin telefonu`, `Yarın okula gidecek misin?` ve `Onur'un kahvesi` otomatik kontrollerde dilbilgisi bilgisini koruyan gösterim planları üretir. Bu, işaret sırasının veya hareketlerin akıcı TİD kullanıcılarınca onaylandığı anlamına gelmez.

## Çıktı önceliği

1. İki bağımsız akıcı TİD değerlendiricisi tarafından kabul edilmiş ve lisanslı medyası bulunan tam cümle.
2. 123 pozdan kurulmuş, açıkça **sözlük dizimi** olarak etiketlenen gösterim.
3. Bulunmayan görünür sözcükler için **harf kartı**.
4. Gösterilemeyen simge için açık destek dışı bildirimi.

Her çıktı kendi kaynağıyla etiketlenir. Sözlük dizimi ve harf kartları doğal TİD sayılmaz; uygulama her cümleyi doğal TİD'e çeviremez.

## Doğal TİD yayın kapısı

| Kapı | Gereken | Mevcut |
| --- | ---: | ---: |
| İzinli held-out cümle/klip | En az 300 | 0 |
| Kişi ayrık işaretleyici | En az 20 kişi | 0 |
| Bağımsız akıcı TİD incelemesi | İki bağımsız değerlendirici | 0 |
| Türkçe anlam kabulü | En az %90 | Ölçülmedi |
| Destek dışı yanlış kabul | En fazla %5 | Ölçülmedi |
| Yüz yüze kullanım | En az 30 oturum | 0 |
| Hedef Android ölçümü | Doğruluk, gecikme ve erişilebilirlik | Yapılmadı |

Bu kapı, kişi, iyelik, olumsuzluk, soru ve zaman alt kümeleri ayrı raporlanarak uygulanacaktır. Otomatik testler ve geliştirici incelemesi insan dil değerlendirmesi yerine sayılmaz.

## Varlıklar

`saved-poses.json` SignBridge MIT kaynağından gelir. Yeniden dağıtım hakkı belgelenmeyen `rain.glb` site paketinde bulunmaz; bunun yerine basit bir prosedürel iskelet kullanılır. MediaPipe Tasks Vision 1.0.1, ONNX Runtime Web 1.30.0 ve Three.js lisans bildirimleri kamu paketindedir.
