# TİD Köprü işaret modeli araçları

Bu klasör, danışman ve katılımcı onayıyla ileride yürütülebilecek 20 işaretlik araştırma pilotunun yerel eğitim, ölçüm ve ONNX dışa aktarma aracıdır. Ana PWA'ya bağlı bir tanıma modeli değildir. Bu depoda gerçek TİD işaret listesi, katılımcı verisi, eğitilmiş model veya pilot sonuç raporu yoktur.

## Şu anki durum

Gerçek eğitim ve dışa aktarma kapalıdır. İlerlemek için TİD kullanan sağır danışmanın onayladığı 20 işaret ve çekim koşulları, her katılımcı için belgeli ve kapsamı uygun izin, MediaPipe ölçüm verisi onamı, veri/model kullanım hakları ve gerçek Android telefon gerekir. Bu kapıların kodda `true` yazılması kanıt sayılmaz; sorumlu kişi belgeleri ve izinleri ayrıca doğrulamalıdır. MediaPipe kullanım/performance ölçümü ile sistem ortamının Google'a iletilebilmesi nedeniyle ölçüm açıklaması katılımcı onamına dahil edilmelidir.

Bu gereklilikler tamamlanmadan örnek verilerle model eğitmeyin, model dosyası üretmeyin ve `docs/sign-pilot-results.md` oluşturmayın. Otomatik doğrulama yalnızca dosya biçimini ve beyan edilmiş kapıları kontrol edebilir; danışman onayını, onamın geçerliliğini veya veri haklarını kendisi doğrulayamaz.

## Veri güvenliği

- Ham video ve ses bu eğitim hattının girdisi değildir. Girdi, `tools/sign_pilot/README.md` sözleşmesine göre alınmış landmark JSONL dosyasıdır.
- Katılımcı JSONL dosyası ve PyTorch kontrol noktası Git deposunun dışında, erişimi sınırlı yerel bir klasörde tutulmalıdır. Kod iki konum için de depo içini reddeder.
- Katılımcı kodları da özel veri kabul edilir. Eğitim kontrol noktası signer bölümlerini ve veri dosyasının SHA-256 parmak izini içerir; bu dosya paylaşılmamalıdır.
- Çalışma zamanı raporu kimlik içermeyen toplu sınıflandırma ölçümlerini, cihaz modelini ve 20 işaret kimliğini içerir. Ham kayıtları veya katılımcı başına satırları rapora koymayın.
- Katılımcı onamından geri çekilme, ilgili katılımcının bütün kayıtlarının silinmesiyle sonuçlanmalıdır. Silinen veriyle eğitilmiş model de yeniden değerlendirilmeden kullanıma alınmamalıdır.

## Kurulum

Python 3.11 ile ayrı ve özel bir sanal ortam kullanın. Bu depoda veri veya kontrol noktası oluşturmadan önce paketleri kurun:

```powershell
python -m venv D:\tid-kopru-private\venv
D:\tid-kopru-private\venv\Scripts\python.exe -m pip install -r tools/sign_model/requirements.txt
```

Paket sürümleri `requirements.txt` içinde sabittir. Bu komutlar bu çalışma sırasında çalıştırılmadı; henüz gerçek veri olmadığı için paket kurulumuna gerek yoktu.

## Onay manifesti ve eğitim

Onay manifestinde mediaPipeWasmFiles alanı da gerekir. Liste, MediaPipe FilesetResolver'ın seçebileceği yerel WASM loader/binary dosyalarının göreli yollarını ve SHA-256 değerlerini taşır. Hash değerleri yerel kayıt aracının kullandığı dosyalarla aynı olmalıdır; captureContractSha256 bu listeyi de bağlar.

Onay manifestinde mediaPipeModelVersion, mediaPipeRuntimeVersion, mediaPipeModelSha256, mediaPipeRuntimeSha256 ve captureContractSha256 alanları da bulunmalıdır. Hash değerleri yerel kayıt aracının kullandığı tam dosyalarla aynı olmalıdır. Fingerprint özel manifestten hesaplanır ve pilot-manifest.json dosyasına da kopyalanır; landmark sırası veya dosya hash'i değişirse kayıt başlamaz.

Onay manifesti JSON biçiminde ve depo dışında olmalıdır. Şu alanları gerçek danışman/izin sürecinden gelen kodlarla içermelidir:

- `advisorApproved`, `participantConsentVerified`, `dataRightsVerified`, `mediaPipeMetricsConsentVerified`, `mediaPipeAssetsRightsVerified`, `androidDeviceVerified`: her biri yalnız kanıtı ayrıca incelendikten sonra `true` olmalıdır.
- `allowedSigns`: danışmanca onaylanmış, benzersiz 20 işaret kimliği.
- `signers`: en az 20 anonim katılımcı kodu; ad veya iletişim bilgisi değil.
- `consentCodes`: izin kayıtlarıyla korumalı eşleme dışında ilişkilendirilemeyen kodlar.
- `conditions`: `lighting`, `distance` ve `background` için onaylı kod listeleri.
- `metricsDisclosureNoticeId`: onamda kullanılan MediaPipe ölçüm açıklamasının sürümü.
- `preprocessVersion`: şu an desteklenen `v1`.
- `landmarkIndices`: MediaPipe pose, iki el ve yüz alt kümesinin sıralı indeksleri; iki omuz noktası zorunludur.
- `randomSeed`: çalışmayı tekrar edilebilir kılan tamsayı.

Her onaylı işaret her katılımcıdan en az 10 tekrar içermelidir. `UNKNOWN`, `BLANK` ve `PARTIAL` ret örnekleri de ayrı etiketlerle bulunmalı ve her ret sınıfı en az üç farklı katılımcıyı kapsamalıdır. Kayıtlar Task 1 veri sözleşmesi doğrulamasından geçer. Bölme kayıt bazında değil katılımcı bazındadır; aynı katılımcı train, validation ve test bölümlerinde bulunamaz.

Yalnız tüm gerçek kapılar ve yerel veri doğrulaması geçince özel kontrol noktasını depo dışına yazın:

```powershell
D:\tid-kopru-private\venv\Scripts\python.exe -m tools.sign_model.train `
  --dataset D:\tid-kopru-private\consented-landmarks.jsonl `
  --manifest D:\tid-kopru-private\approval-manifest.json `
  --output D:\tid-kopru-private\sign-pilot.pt
```

Eğitim, ölçekleme istatistiklerini yalnız train katılımcılarından çıkarır; güven eşiğini yalnız validation katılımcılarında kalibre eder. Son test katılımcılarında confusion matrix, sınıf başına precision/recall ve macro-F1 hesaplanır, fakat eşik ayarı yapılmaz. Ham video, landmark kayıtları ve kontrol noktası PWA paketine girmez.

## Held-out ölçümü

Boşta ölçüm en az 10 dakika sürmeli ve dakika başına en az 60 işlenmiş bir saniyelik pencere içermelidir. Bu, ölçüm yokken yanlışlıkla sıfır yanlış sözcük raporlanmasını engelleyen geçici iç kapsam eşiğidir; gerçek pilot protokolü öncesinde TİD danışmanıyla onaylanmalıdır.

Ölçüm JSON'unda idleWindowsProcessed pozitif tam sayı olmalıdır; boşta ölçüm sırasında gerçekten işlenen pencere sayısını gösterir. idlePredictions yalnızca pencereler sırasında yayımlanan yanlış sözcük olaylarının listesidir ve boş olabilir. Her olay benzersiz windowId, signId, confidence ve accepted alanları taşır. Böylece hiç yanlış olay çıkmaması, hiç ölçüm yapılmamasından ayrılır.

BLANK/UNKNOWN false-acceptance oranı yalnızca bu iki ret sınıfının örneklerinden hesaplanır. PARTIAL ayrı ölçülür ve kendi başına en fazla %5 false acceptance kapısına sahiptir; PARTIAL satırları BLANK/UNKNOWN paydasını seyreltemez. Kalibrasyon validation verisinde aynı sınıf tanımlarını uygular. Her üç ret sınıfı train, validation ve test bölümlerinde yoksa eğitim/değerlendirme durur.

Aynı yerel veri, onay manifesti ve özel kontrol noktası; gerçek Android telefonda yapılan model gecikme ölçümleri ve ayrı boşta-kamera ölçümüyle değerlendirilir. Ölçüm JSON'u şu alanları taşır: `idlePredictions`, `idleWindowsProcessed`, `idleMinutes`, `latencyMs` ve `androidDevice` (`platform: "Android"` ve cihaz `model` alanı). `latencyMs` yalnız hedef telefondaki ölçümlerden oluşmalıdır; masaüstü zamanı kullanılamaz. Dosya hash'i ölçüm dosyasının içeriğini rapora bağlar; ölçümlerin gerçekten hedef telefondan geldiğini tek başına kanıtlamaz, bu kaynak ayrıca doğrulanmalıdır.

```powershell
D:\tid-kopru-private\venv\Scripts\python.exe -m tools.sign_model.evaluate `
  --checkpoint D:\tid-kopru-private\sign-pilot.pt `
  --dataset D:\tid-kopru-private\consented-landmarks.jsonl `
  --approval-manifest D:\tid-kopru-private\approval-manifest.json `
  --measurements D:\tid-kopru-private\android-measurements.json `
  --output D:\tid-kopru-private\pilot-evaluation.json
```

Sürüm kapıları macro-F1 ≥ 0.80, false acceptance ≤ %5, boşta dakikada en fazla 1 yanlış sözcük, güven eşiğinin altındaki önerilerin reddedilme oranı ≥ %90 ve Android p95 model gecikmesi ≤ 1.5 saniyedir. Kalibrasyon, eşik altında kalan onaylı işaretleri çoğaltmak yerine false acceptance sınırını korurken validation kümesinde doğru işaretlerin kabulünü en yüksek tutar. Eşik başarısızsa gevşetilmez; veri, etiket veya ön işleme incelenip yeni sürümlü bir deney yapılır.

## ONNX dışa aktarma

Dışa aktarma aynı Android ölçüm JSON dosyasını --measurements ile yeniden okur ve dosya SHA-256 değerini raporla karşılaştırır. Ayrıca checkpoint ve held-out veri üzerinden sınıflandırma ölçütlerini tekrar hesaplar; düzenlenmiş bir rapor tek başına modeli yayımlatamaz. Bu ölçüm dosyası üretilmiş olmalı, ham kayıt ve kontrol noktası gibi depo dışında tutulmalıdır.

ONNX manifesti ve gömülü metadata ayrıca captureContractSha256 ile MediaPipe model/runtime hash değerlerini taşır. Eğitim kontrol noktası, değerlendirme raporu, özel onay manifesti ve dışa aktarma runtime bilgisi aynı fingerprint'e bağlanır.

Dışa aktarma, eğitim onaylarını ve JSONL kayıtlarını yeniden doğrular; raporun aynı kontrol noktası/veri dosyası/Android cihaz için olduğuna ve her sayısal geçiş kapısının karşılandığına bakar. Sonra modeli ONNX Runtime ile tekrar çalıştırıp PyTorch sonucuyla karşılaştırır. Ölçekleme ONNX grafiğinin içine alınır. Sürüm, runtime, tam ön işleme JSON'u, ölçekleme hash'i, sıralı landmark adları, sınıflar ve güven eşiği ONNX metadata'sına gömülür; ayrıca manifestteki kopyalarıyla birebir karşılaştırılır.

Tüm kontrollerden sonra tek hedef `models/sign-pilot/` klasörüdür. Dışa aktarma `sign-pilot.onnx` ve `model-manifest.json` üretir. Eksik manifest, model hash'i, ön işleme hash'i, ölçekleme hash'i, sıralı landmark adı, sınıf listesi, güven eşiği, MediaPipe sürümleri veya Android cihaz bilgisi modelin yayımlanmasını engeller.

```powershell
D:\tid-kopru-private\venv\Scripts\python.exe -m tools.sign_model.export_onnx `
  --checkpoint D:\tid-kopru-private\sign-pilot.pt `
  --dataset D:\tid-kopru-private\consented-landmarks.jsonl `
  --approval-manifest D:\tid-kopru-private\approval-manifest.json `
  --evaluation-report D:\tid-kopru-private\pilot-evaluation.json `
  --runtime-metadata D:\tid-kopru-private\runtime-metadata.json
```

Bu komut şimdi çalıştırılmamalıdır: gerçek onaylı veri, Android ölçümü ve doğrulanmış MediaPipe varlık hakları henüz yoktur. Ana PWA'da kamera ile işaret tanıma kapalı kalmalıdır. Kod testleri yalnız sentetik biçim/aritmetik kontrolleridir; bunlar TİD doğruluğu, gerçek kullanıcı başarısı veya Android performansı kanıtlamaz.

Odaklı birim kontrolleri proje kökünde `python -m unittest discover -s tests -p test_sign_model_pipeline.py -v` ile çalıştırılır.
