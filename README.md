# Qyriptalk Android (WebView + localhost)

HTML uygulaması `app/src/main/assets/www/` içinde. Uygulama açılınca cihazda
`http://localhost:38213` üzerinde minik bir sunucu başlatır ve WebView oradan yükler
(secure context → mikrofon, panoya kopyalama vb. çalışır).

## APK alma (GitHub Actions)
1. Bu klasörün içeriğini yeni bir GitHub reposuna push et (kökte `settings.gradle` olmalı).
2. Actions → "Build APK" otomatik çalışır (ya da "Run workflow").
3. Bitince run sayfasında Artifacts → **Qyriptalk-APK** → içinden `app-debug.apk`.

## Web dosyasını güncelleme
`app/src/main/assets/www/` içindeki index.html / script.js / styles.css / i18n.js dosyalarını değiştirip push et.
