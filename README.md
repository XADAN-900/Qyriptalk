# Qyriptalk Android (WebView + localhost)

HTML uygulaması `app/src/main/assets/www/` içinde. Uygulama açılınca cihazda
`http://localhost:38213` üzerinde minik bir sunucu başlatır ve WebView oradan yükler.

- İnternet yoksa "İnternet bağlantısı yok" ekranı / kırmızı şerit gösterilir.
- Mesaj ve gelen arama bildirimleri (zil sesi, Cevapla/Reddet) `android-bridge.js` + `KeepAliveService` ile çalışır.
- Bildirimler uygulama arka plandayken (son uygulamalarda duruyorken) gelir. Uygulama tamamen kapatılırsa
  (son uygulamalardan silinirse) gelmez; bunun için sunucu tarafında FCM gerekir.

## APK alma (GitHub Actions)
1. Bu klasörün içeriğini repoya push et (kökte `settings.gradle` olmalı).
2. Actions → "Build APK" → Artifacts → **Qyriptalk-APK**.
