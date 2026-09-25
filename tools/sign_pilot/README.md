# TİD işaret pilotu veri sözleşmesi

Bu klasör yalnızca veri biçimini ve yerel doğrulamayı tanımlar. İçindeki `S01`, `C01` ve `SIGN_A` gibi kodlar test fikstürüdür; gerçek katılımcı veya TİD işareti değildir. Bu depo içinde katılımcı kaydı, ham video, ses, iletişim bilgisi veya gerçek bir onam belgesi bulunmamalıdır.

## Katılımcı verisi için kapılar

- TİD kullanan sağır danışman 20 işaretin anlamını, varyantlarını ve çekim koşullarını onaylamadan gerçek etiket/koşul listesi oluşturmayın.
- Katılımcıdan adlandırılmış amaç, kullanım kapsamı, saklama süresi ve silme yöntemi için belgeli izin alınmadan kayıt toplamayın.
- Ham video varsayılan olarak yakalanmaz veya dışa aktarılmaz. Landmark verisi kimlikten arındırılsa bile hassas biyometrik veri sayılır; yalnızca erişimi sınırlandırılmış yerel depoda tutulmalıdır.
- Onam kodu gerçek izin belgesinin yerine geçmez. İzin kanıtı, kimliği açığa çıkaran eşleme ve erişim kaydı bu veri dosyasından ayrı ve korumalı tutulur.
- İzni geri çekilen kişinin `signerCode` değeriyle tüm kayıtlarını bulup silme süreci çalışmalıdır; bu bağlantı tablosu dağıtım verisine eklenmez.
- Gerçek Android telefon, danışman ve katılımcı izni olmadan yakalama, eğitim veya ürün modeli iddiası yapılmaz.

## Kayıt biçimi

`schema.json` kayıt yapısını tanımlar. `validate_dataset(records, signers, allowed_signs)` ek olarak sürüm, onam kodu, işaretçi/işaret listesi üyeliği, sonlu koordinatları, görünürlük maskelerini ve zaman damgalarını denetler. Her koordinat grubu 3 değerli (x, y, z) noktalar halinde düzleştirilir; karşılık gelen görünürlük maskesinde her nokta için 0 veya 1 bulunur. Eksik nokta sıfır koordinatla ve görünürlük değeri 0 ile gösterilir.

İzinli işaret ve işaretçi kodları bu fonksiyona ayrı, danışman/onam sürecinden gelen manifestolarla verilir. Fonksiyon veri yapısını denetler; iznin gerçekliğini veya kapsamının yeterliliğini doğrulayamaz.

Şema testlerini çalıştırmak için proje kökünde:

```powershell
python -m unittest discover -s tests -p test_sign_pilot_dataset.py -v
```
