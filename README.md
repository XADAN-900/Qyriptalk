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
