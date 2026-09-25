# Türkçe→TİD değerlendirme ve yayın kapısı

**Rapor tarihi:** 25 Eylül 2026
**Durum:** **YAYIN ENGELLİ — insan değerlendirmesi yapılmadı**
**İçerik sürümü:** `pilot-content-0`

Bu rapor gerçek inceleme kanıtlarının özetidir. Eksik sonuçlar boş bırakılır; sentetik test girdileri, aday veri veya otomatik testler insan onayı yerine sayılmaz. Katılımcı kimliği, iletişim bilgisi, imza videosu ve özel inceleme formları depoya konmaz.

## Mevcut kanıt

| Ölçüm | Mevcut sonuç | Yayın koşulu |
| --- | ---: | ---: |
| Paketlenmiş onaylı Türkçe→TİD cümlesi | 0 | Her kayıt iki bağımsız akıcı TİD değerlendiricisinin onayını taşımalı |
| Onaylı üretken aktarım kalıbı | 0 | Her dilbilgisi özelliği ve TİD karşılığı ayrıca incelenmeli |
| Manifestte gösterim medyası | 0 | Her varlık için kanıtlı lisans, SHA-256 ve zamanlı gloss/non-manual anotasyonu |
| Ayrılmış held-out değerlendirme cümlesi | 0 / 300 | En az 300 cümle, içerik geliştirmede kullanılmamış kümeden |
| İnceleme yapan akıcı TİD değerlendiricisi | 0 / 2 | İki bağımsız inceleme; görüş ayrılığında üçüncü hakem |
| İki değerlendiricinin kabul ettiği sonuç | Ölçülmedi | Uzlaştırma sonrası en az %90 kabul |
| Held-out insan cümle çevirisi sonucu | **Henüz değerlendirme yapılmadı** | Kabul, ret ve alt küme sonuçları yayımlanmalı |
| Fiziksel Android Chrome kontrolü | Yapılmadı | HTTPS temiz kurulum, çevrimdışı, erişilebilirlik ve kullanıcı akışı |

`Sen iyisin` için biçimbilim çözümlemesi `iyi` yüklemini ve ikinci tekil kişiyi tutar. Bu raporda bu cümle için onaylı TİD ifadesi, hareket varlığı veya insan kabul sonucu yoktur; dağıtım paketi cümleyi desteklenmeyen olarak tutar. Benzer şekilde testlerde kullanılan yapay reviewer kodları gerçek değerlendirici değildir.

Karakter modeli `public/assets/avatar/rain.glb` için yeniden dağıtım hakkı ayrıca doğrulanmamıştır. TİD medya listesi boş olsa da bu varlık hakkı kamuya açık dağıtımı engellemeye devam eder.

## 300 cümlelik held-out değerlendirme

Şu an değerlendirme kümesi toplanmamış ve incelenmemiştir. Yeni değerlendirme sürümü; kişi, olumsuzluk, soru, zaman, iyelik ve çekim biçimlerini dengeli kapsamalı; yinelenen/yazım varyantlı cümleleri aynı bölmede tutmalı; geliştirmede görünmeyen cümlelerden ayrılmalıdır. Cümle başına çıktı, çözümleme, TİD karşılığı ve medya kimliği özel inceleme kaydında izlenir. Depoya yalnızca kimliksiz toplu sayımlar ve kişiyi tanımlamayan kaynak kimlikleri eklenir.

İki bağımsız akıcı TİD değerlendiricisi her cümlenin anlamını ayrı ayrı puanlar. Görüş ayrılıkları üçüncü hakem tarafından karara bağlanır. Her cümle için kişi, olumsuzluk, soru, zaman, iyelik ve çekim alt kümesi; kabul/ret, destek dışı ret ve yanlış kabul ayrı raporlanır. Sonuç eşiği, anlaşmazlık uzlaştırmasından sonra cümlelerin en az %90'ının anlamca kabul edilebilir bulunmasıdır. Eşik sağlanmazsa içerik sürümü yayımlanmaz ve yeni bir held-out küme gerekir.

## Gösterim, güvenlik ve çevrimdışı kapıları

- Desteklenmeyen veya belirsiz cümleler hiç medya segmenti döndürmemeli ve hiçbir durumda oynatılmamalı.
- Oynatılabilir her cümle iki bağımsız dil incelemesi ve varsa üçüncü hakem sonucuna bağlı olmalı.
- Her klip veya avatar animasyonu için lisans kaynağı, yeniden dağıtım izni, atıf, SHA-256, süre, gloss hizası ve non-manual zaman çizelgesi doğrulanmalı.
- Medya yalnızca aynı kaynaklı, manifestte listelenmiş ve dosya karması doğrulanmışsa önbelleğe alınmalı. Ham kamera ve katılımcı kayıtları dağıtım paketine veya önbelleğe girmemeli.
- Android Chrome'da metni gözden geçirme/onaylama, oynatma/durdurma, hata/yeniden deneme, izin reddi, ekran okuyucu ve çevrimdışı davranış fiziksel cihazda denenmeli.

## Karar

Türkçe→TİD arayüzü ve aktarım yazılımı bulunmaktadır; gerçek içerik ve insan değerlendirme kapıları **geçilmemiştir**. Ürünü “TİD cümlelerini çevirir” diye sunmayın. Yayın ancak yukarıdaki kanıtlar yeni içerik sürümü ve bu raporla kayda geçirildikten sonra yeniden değerlendirilebilir.
