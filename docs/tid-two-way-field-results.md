# TİD Köprü iki yönlü entegrasyon sonucu

**Tarih:** 25 Eylül 2026

**Yazılım entegrasyonu:** Tamamlandı; yayın öncesi tarayıcı doğrulamasında

**İnsan ve saha doğrulaması:** Bekliyor

## Entegre edilen kullanıcı akışları

- Türkçe konuşma tanıma veya elle yazma, son metni düzeltme ve açık onay.
- Kişi, iyelik, olumsuzluk, soru, gelecek zaman ve özel ad tamlamasını koruyan Türkçe çözümleme.
- 123 sözlük pozla prosedürel iskelet gösterimi, bilinmeyen sözcükte harf kartı, hız/tekrar/adım kontrolleri.
- Kamera izniyle cihazda MediaPipe landmark çıkarımı.
- En az üç örnekle kişisel işaret öğretme, IndexedDB'de yalnızca normalize hareket noktalarını saklama, silme ve düşük güvenli sonucu reddetme.
- Yerel kişisel eşleştirme, isteğe bağlı hash doğrulanmış ONNX ve açık izinli NVIDIA adayını sıralayan hibrit karar yolu.
- Düzenlenebilir kamera adayı; cevap alanına ayrı kullanıcı onayı; cihazın Türkçe ses sentezi.
- Kurulabilir PWA, ilk yüklemeden sonra çevrimdışı uygulama kabuğu ve yerel çalışma zamanı.

## Dil doğrulamasının mevcut sayıları

| Ölçüm | Gereken | Yapılan |
| --- | ---: | ---: |
| Uzman onaylı doğal TİD cümle | İçerik sürümüne göre | 0 |
| Held-out izinli cümle/klip | 300 | 0 / 300 |
| Kişi ayrık işaretleyici | 20 kişi | 0 |
| Bağımsız akıcı TİD değerlendiricisi | 2 | 0 |
| Uzlaştırılmış anlam kabulü | En az %90 | Ölçülmedi |
| Destek dışı yanlış kabul | En fazla %5 | Ölçülmedi |
| Yüz yüze TİD kullanıcı oturumu | 30 yüz yüze oturum | 0 |
| Hedef Android cihazı | En az 1 | Yapılmadı |

Bu sayılar otomatik yazılım doğrulamasından ayrı tutulur. 123 sözlük pozunun bulunması, doğal cümle hareketi veya bütün konuşmaların çevrildiği anlamına gelmez.

## Bekleyen saha çalışması

1. Açık rıza ve TİD danışmanı eşliğinde en az 300 held-out cümle/klip toplamak.
2. En az 20 kişi ayrık işaretleyiciyle yanlış kabul ve anlam kabulünü ölçmek.
3. Sonuçları iki bağımsız akıcı TİD değerlendiricisine inceletmek; anlaşmazlığı hakemle çözmek.
4. En az %90 anlam kabulü ve en fazla %5 destek dışı yanlış kabul kapısını uygulamak.
5. Android Chrome'da gecikme, pil, ısınma, çevrimdışı kullanım ve TalkBack ölçümü yapmak.
6. En az 30 yüz yüze kullanım oturumu tamamlamak.

Saha kapıları tamamlanana kadar ürün, çalışan bir iletişim yardımcısı ve kişisel işaret prototipi olarak sunulur; evrensel veya doğal TİD çevirmeni iddiası taşımaz.
