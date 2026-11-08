# Qyriptalk Android (WebView + localhost) + FCM push

HTML uygulaması `app/src/main/assets/www/` içinde; cihazda `http://localhost:38213` üzerinden yüklenir.

## Bildirimler
- **FCM (asıl sistem):** `functions/` (Cloud Functions) yeni mesaj / arama olunca telefona push atar → uygulama kapalıyken de gelir.
- **Yedek:** `ChatWatcher` Firebase'i yerel dinler (Functions kurulu değilse de uygulama arka plandayken çalışır).
- Mesaj: sohbet başına tek bildirim, Yanıtla / Okundu. Arama: zil sesi, Cevapla / Reddet.

## Kurulum (bir kez)
1. Firebase konsol → proje `qyriptalk-cdf56` → Android uygulaması ekle: paket adı `com.xadan.qyriptalk`
   → `google-services.json` indir → `app/google-services.json` olarak repoya koy.
2. Firebase projesini **Blaze** (kullandıkça öde, ücretsiz kotalı) planına al (Functions için şart).
3. GitHub repo → Settings → Secrets → `FIREBASE_TOKEN` (`firebase login:ci` çıktısı) 
   veya `FIREBASE_SERVICE_ACCOUNT` (konsol → Project settings → Service accounts → yeni özel anahtar JSON'u).
4. Push et: "Build APK" APK'yı, "Deploy Functions" sunucu kısmını kurar.


## 1.4.0 — Bildirim güncellemesi
- **Özel mesaj (DM) bildirimleri düzeltildi:** DM'ler artık kullanıcı listesinden bulunuyor; `privateMessages` kökü okunamasa bile bildirim gelir.
- **Sesli bildirim:** Mesajlar için Qyriptalk'a özel bildirim sesi + titreşim (Ayarlar > Ses Bildirimleri kapalıysa sessiz kanal).
- **Uygulama içi uyarı:** Uygulama açıkken başka bir sohbete mesaj gelirse ses + üstte kısa bildirim.
- **Kilit ekranı:** mesaj içeriğini göster/gizle ayarı, gönderen avatarı, Yanıtla / Okundu / Sessize al (8 sa) butonları,
  Android 12+ sistem arama görünümü (tam ekran Cevapla/Reddet), görüşme sırasında süre sayacı ve "Aramayı bitir" butonu,
  Android 14'te tam ekran arama izni için yönlendirme.
- **Gelen mesajları sesli oku** (isteğe bağlı, telefon sessizdeyken okumaz).
- **Bildirimi dene** butonu ve telefon bildirim ayarlarına kısayol.
- APK her derlemede Releases'a yüklenir: `releases/latest/download/Qyriptalk.apk`.
- İsteğe bağlı sabit imza: `QT_KEYSTORE_B64`, `QT_KEYSTORE_PASSWORD` secret'ları eklenirse güncellemeler eskisinin üzerine kurulur.
