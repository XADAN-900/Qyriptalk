package com.xadan.qyriptalk;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.os.PowerManager;
import android.provider.Settings;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {

    private static final int PREFERRED_PORT = 38213; // sabit port = sabit origin = localStorage kaybolmaz
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_WEB_PERMISSIONS = 2001;
    private static final int REQ_STARTUP = 2002;

    /** Bildirim butonları (Reddet) için çalışan aktiviteye erişim. */
    static volatile MainActivity current;
    /** Uygulama ekranda görünüyor mu? Görünürken native bildirim gösterilmez. */
    static volatile boolean visible = false;

    private WebView webView;
    private LocalServer server;
    private int port = -1;

    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingPermissionRequest;

    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback netCallback;
    private boolean offlinePageShown = false;

    private String bridgeScript;
    private boolean webReady = false;

    // Gerçek internet kontrolü (sadece "Wi-Fi bağlı" değil, sunucuya ulaşılabiliyor mu)
    private static final String PROBE_URL =
            "https://qyriptalk-cdf56-default-rtdb.europe-west1.firebasedatabase.app/.json?shallow=true";
    private final Handler monitorHandler = new Handler(Looper.getMainLooper());
    private int failCount = 0;
    private boolean knownOffline = false;
    private boolean loadBroken = false;
    private boolean checkingOffline = false;
    private final Runnable monitor = new Runnable() {
        @Override
        public void run() {
            if (!visible) return;
            checkConnection();
            monitorHandler.postDelayed(this, 8000);
        }
    };
    private ImageView splashView;
    private long createdAt;
    private long pendingAcceptUntil = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            webView = new WebView(this);
        } catch (Throwable t) {
            // Bazı emülatörlerde WebView sağlayıcısı yok / bozuk olabiliyor
            TextView tv = new TextView(this);
            tv.setText("WebView bulunamadı.\n\nCihazda \"Android System WebView\" veya Chrome "
                    + "yüklü/güncel olmalı.\n\n" + t);
            tv.setTextColor(Color.WHITE);
            tv.setBackgroundColor(Color.parseColor("#05001E"));
            tv.setTextSize(16);
            tv.setPadding(48, 120, 48, 48);
            setContentView(tv);
            return;
        }

        current = this;
        webView.setBackgroundColor(Color.parseColor("#05001E"));

        // Açılış ekranı: sayfa yüklenene kadar logo gösterilir
        createdAt = SystemClock.uptimeMillis();
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#05001E"));
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        splashView = new ImageView(this);
        splashView.setImageResource(R.drawable.splash_logo);
        splashView.setScaleType(ImageView.ScaleType.CENTER);
        splashView.setBackgroundColor(Color.parseColor("#05001E"));
        root.addView(splashView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        new Handler(Looper.getMainLooper()).postDelayed(this::hideSplash, 8000); // güvenlik

        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);

        setupWebView();

        NotificationHelper.createChannels(this);
        requestStartupPermissions();
        KeepAliveService.ensureRunning(this);

        server = new LocalServer(getAssets());
        new Thread(() -> {
            try {
                port = server.start(PREFERRED_PORT);
                runOnUiThread(() -> loadStart());
            } catch (IOException e) {
                runOnUiThread(() -> Toast.makeText(this,
                        "Yerel sunucu başlatılamadı: " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }, "qyriptalk-server-start").start();

        registerNetworkWatcher();
        handleIntent(getIntent());
    }

    // ---------- Başlangıç izinleri (bildirim, mikrofon, eski cihazlarda depolama) ----------

    private void requestStartupPermissions() {
        List<String> need = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            need.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            need.add(Manifest.permission.RECORD_AUDIO);
        }
        if (Build.VERSION.SDK_INT < 29
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            need.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        }
        if (!need.isEmpty()) {
            requestPermissions(need.toArray(new String[0]), REQ_STARTUP);
        }
    }

    // ---------- İnternet kontrolü ----------

    private boolean isOnline() {
        if (connectivityManager == null) {
            connectivityManager = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        }
        Network n = connectivityManager.getActiveNetwork();
        if (n == null) return false;
        NetworkCapabilities c = connectivityManager.getNetworkCapabilities(n);
        return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private interface ProbeCallback {
        void onResult(boolean online);
    }

    /** Sunucuya gerçekten ulaşılabiliyor mu? (Wi-Fi bağlı ama internet yoksa da yakalar) */
    private void probeInternet(final ProbeCallback cb) {
        new Thread(() -> {
            boolean ok = false;
            if (isOnline()) {
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(PROBE_URL).openConnection();
                    c.setConnectTimeout(3500);
                    c.setReadTimeout(3500);
                    c.setUseCaches(false);
                    int code = c.getResponseCode();
                    ok = code >= 100 && code < 600; // herhangi bir HTTP cevabı = sunucuya ulaşıldı
                } catch (Exception e) {
                    ok = false;
                } finally {
                    if (c != null) c.disconnect();
                }
            }
            final boolean res = ok;
            runOnUiThread(() -> cb.onResult(res));
        }, "qyriptalk-probe").start();
    }

    /** Uygulamayı yükler; internet yoksa onPageFinished kırmızı şeridi gösterir. */
    private void loadStart() {
        if (port < 0 || webView == null) return;
        final String base = "http://localhost:" + port + "/";
        probeInternet(online -> {
            if (webView == null) return;
            failCount = 0;
            loadBroken = false;
            // İnternet olsun olmasın uygulama açılır (eski mesajlar okunabilsin).
            // İnternet yoksa sadece üstte kırmızı "İnternet bağlantısı yok" şeridi görünür.
            knownOffline = !online;
            offlinePageShown = false;
            webView.loadUrl(base + "index.html");
        });
    }

    /** Periyodik kontrol: internet gidince şerit, gelince şerit kalkar / sayfa yenilenir. */
    private void checkConnection() {
        if (port < 0 || webView == null) return;
        probeInternet(online -> {
            if (webView == null) return;
            if (online) {
                failCount = 0;
                if (loadBroken || offlinePageShown) {
                    loadStart(); // sayfa eksik yüklenmişti ya da hata ekranındayız
                } else if (knownOffline) {
                    knownOffline = false;
                    setOfflineBanner(false);
                }
            } else {
                failCount++;
                if (failCount >= 2 && !knownOffline) {
                    knownOffline = true;
                    if (!offlinePageShown) setOfflineBanner(true);
                }
            }
        });
    }

    private boolean hasLoggedInUser() {
        try {
            return Session.load(getApplicationContext()).valid();
        } catch (Throwable t) {
            return false;
        }
    }

    /** Eskiden tam ekran hata sayfasına geçerdi; artık sadece kırmızı şerit gösterilir. */
    private void showOfflineIfNeeded() {
        if (port < 0 || webView == null) return;
        probeInternet(online -> {
            if (webView == null || online) return;
            knownOffline = true;
            setOfflineBanner(true);
        });
    }

    private void registerNetworkWatcher() {
        connectivityManager = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        netCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                runOnUiThread(() -> {
                    if (port < 0) return;
                    if (offlinePageShown) {
                        loadStart(); // internet geldi, uygulamayı yükle
                    } else {
                        setOfflineBanner(false);
                    }
                });
            }

            @Override
            public void onLost(Network network) {
                runOnUiThread(() -> {
                    if (port < 0 || offlinePageShown) return;
                    if (!isOnline()) {
                        knownOffline = true;
                        failCount = 2;
                        setOfflineBanner(true);
                    }
                });
            }
        };
        try {
            connectivityManager.registerDefaultNetworkCallback(netCallback);
        } catch (Exception ignored) {
        }
    }

    /** Kullanım sırasında internet giderse üstte kırmızı uyarı şeridi gösterir. */
    private void setOfflineBanner(boolean show) {
        // Şeridi sayfadaki JS (offline-cache.js) çizer; burada sadece durumu bildiririz.
        String js = "window.__qtOffline=" + (show ? "true" : "false") + ";"
                + "if(window.__updateOfflineBanner)window.__updateOfflineBanner();";
        runJs(js);
    }

    /** Açılış logosunu (en az 0.7 sn gösterip) yumuşakça kaldırır. */
    private void hideSplash() {
        final ImageView sv = splashView;
        if (sv == null) return;
        splashView = null;
        long wait = Math.max(0, 700 - (SystemClock.uptimeMillis() - createdAt));
        sv.postDelayed(() -> sv.animate().alpha(0f).setDuration(250).withEndAction(() -> {
            ViewGroup parent = (ViewGroup) sv.getParent();
            if (parent != null) parent.removeView(sv);
        }).start(), wait);
    }

    void runJs(final String js) {
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript(js, null);
        });
    }

    // ---------- WebView ----------

    private void setupWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        if (Build.VERSION.SDK_INT >= 26) {
            // Arka plandayken de JS (Firebase dinleyicileri) çalışmaya devam etsin
            webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }

        CookieManager.getInstance().setAcceptCookie(true);

        webView.addJavascriptInterface(new DownloadBridge(), "QyripAndroid");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                String scheme = uri.getScheme();
                if ("blob".equals(scheme) || "data".equals(scheme) || "about".equals(scheme)) {
                    return false;
                }
                if (host != null && (host.equals("localhost") || host.equals("127.0.0.1"))) {
                    return false; // kendi uygulamamız
                }
                // Harici linkler tarayıcıda / ilgili uygulamada açılsın
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) {
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                Uri u = request.getUrl();
                String host = u.getHost();
                if (host == null || host.equals("localhost") || host.equals("127.0.0.1")) return;
                String path = u.getPath() == null ? "" : u.getPath();
                boolean critical = path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".css");
                int code = error.getErrorCode();
                if (critical && (code == ERROR_HOST_LOOKUP || code == ERROR_CONNECT || code == ERROR_TIMEOUT)) {
                    loadBroken = true;
                    showOfflineIfNeeded();
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                hideSplash();
                if (url != null && url.contains("localhost") && url.contains("index.html")) {
                    webReady = true;
                    injectBridge(view);
                    if (knownOffline) setOfflineBanner(true);
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handleWebPermissionRequest(request));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingPermissionRequest == request) pendingPermissionRequest = null;
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE_CHOOSER);
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            String mime = (mimeType == null || mimeType.isEmpty()) ? "application/octet-stream" : mimeType;
            String fileName = URLUtil.guessFileName(url, contentDisposition, mime);

            if (url.startsWith("blob:")) {
                // blob: bir ağ isteği değil; sayfa içinde okuyup köprü üzerinden kaydediyoruz
                String js = "(function(){var x=new XMLHttpRequest();"
                        + "x.open('GET'," + JSONObject.quote(url) + ",true);"
                        + "x.responseType='blob';"
                        + "x.onload=function(){var r=new FileReader();"
                        + "r.onloadend=function(){QyripAndroid.saveFile(r.result,"
                        + JSONObject.quote(fileName) + "," + JSONObject.quote(mime) + ");};"
                        + "r.readAsDataURL(x.response);};"
                        + "x.send();})();";
                webView.evaluateJavascript(js, null);
            } else if (url.startsWith("data:")) {
                new DownloadBridge().saveFile(url, fileName, mime);
            } else {
                try {
                    DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                    req.setMimeType(mime);
                    req.setNotificationVisibility(
                            DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
                    DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                    dm.enqueue(req);
                    Toast.makeText(this, "İndiriliyor: " + fileName, Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(this, "İndirme başarısız: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
        });
    }

    /** android-bridge.js: bildirim + arama köprüsü. Web dosyalarına dokunmadan enjekte edilir. */
    private void injectBridge(WebView view) {
        try {
            if (bridgeScript == null) {
                try (InputStream in = getAssets().open("android-bridge.js")) {
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) != -1) bos.write(buf, 0, n);
                    bridgeScript = bos.toString("UTF-8");
                }
            }
            view.evaluateJavascript(bridgeScript, null);
        } catch (IOException ignored) {
        }
    }

    // ---------- Bildirimden gelen aksiyonlar (Cevapla / arama ekranı) ----------

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();

        if (intent.getBooleanExtra(NotificationHelper.EXTRA_FROM_CALL, false)
                && Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }

        if (NotificationHelper.ACTION_ACCEPT.equals(action)) {
            NotificationHelper.cancelCall(this);
            if (webReady) {
                runJs("if(typeof acceptIncomingCall==='function'){acceptIncomingCall();}");
            } else {
                // Uygulama kapalıydı: web açılıp davet gelince otomatik cevaplanacak
                pendingAcceptUntil = System.currentTimeMillis() + 30000;
            }
        }
    }

    // ---------- Mikrofon / kamera izinleri (sesli arama, sesli mesaj) ----------

    private static String androidPermissionFor(String webResource) {
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(webResource)) return Manifest.permission.RECORD_AUDIO;
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(webResource)) return Manifest.permission.CAMERA;
        return null;
    }

    private void handleWebPermissionRequest(PermissionRequest request) {
        String host = request.getOrigin().getHost();
        if (host == null || !(host.equals("localhost") || host.equals("127.0.0.1"))) {
            request.deny();
            return;
        }

        List<String> missing = new ArrayList<>();
        for (String res : request.getResources()) {
            String perm = androidPermissionFor(res);
            if (perm != null && checkSelfPermission(perm) != PackageManager.PERMISSION_GRANTED
                    && !missing.contains(perm)) {
                missing.add(perm);
            }
        }

        if (missing.isEmpty()) {
            grantAllowed(request);
        } else {
            if (pendingPermissionRequest != null) pendingPermissionRequest.deny();
            pendingPermissionRequest = request;
            requestPermissions(missing.toArray(new String[0]), REQ_WEB_PERMISSIONS);
        }
    }

    private void grantAllowed(PermissionRequest request) {
        List<String> allowed = new ArrayList<>();
        for (String res : request.getResources()) {
            String perm = androidPermissionFor(res);
            if (perm != null && checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED) {
                allowed.add(res);
            }
        }
        if (allowed.isEmpty()) {
            request.deny();
        } else {
            request.grant(allowed.toArray(new String[0]));
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_WEB_PERMISSIONS && pendingPermissionRequest != null) {
            PermissionRequest req = pendingPermissionRequest;
            pendingPermissionRequest = null;
            grantAllowed(req);
        }
    }

    // ---------- Dosya seçici (profil / oda logosu, görsel gönderme) ----------

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE_CHOOSER && filePathCallback != null) {
            filePathCallback.onReceiveValue(
                    WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            filePathCallback = null;
        }
    }

    // ---------- JS köprüsü: dosya kaydetme, bildirim, arama ----------

    public class DownloadBridge {

        @JavascriptInterface
        public void retry() {
            runOnUiThread(() -> loadStart());
        }

        /** Mesaj bildirimlerini artık yerel dinleyici (ChatWatcher) üretiyor; burası boş. */
        @JavascriptInterface
        public void showNotification(String title, String body, String tag) {
        }

        /** Web'deki giriş bilgisi: yerel dinleyici bu kullanıcı için çalışır. */
        @JavascriptInterface
        public void setSession(String uid, String username, boolean enabled) {
            if (uid == null || uid.isEmpty()) return;
            Session old = Session.load(getApplicationContext());
            Session.save(getApplicationContext(), uid, username == null ? "" : username, enabled);
            KeepAliveService.ensureRunning(getApplicationContext());
            ChatWatcher.get(getApplicationContext()).refresh();
            if (!old.valid()) askBatteryOptimization();
        }

        @JavascriptInterface
        public void clearSession() {
            Session old = Session.load(getApplicationContext());
            if (!old.valid()) return;
            ChatWatcher.get(getApplicationContext()).removeToken(old.uid);
            Session.clear(getApplicationContext());
            ChatWatcher.get(getApplicationContext()).refresh();
            if (current == null) KeepAliveService.stop(getApplicationContext());
        }

        /** Bildirimden "Cevapla"ya basılıp uygulama sıfırdan açıldıysa true döner. */
        @JavascriptInterface
        public boolean consumePendingAccept() {
            boolean ok = System.currentTimeMillis() < pendingAcceptUntil;
            pendingAcceptUntil = 0;
            return ok;
        }

        /** Gelen arama bildirimi (sadece uygulama ekranda değilken). */
        @JavascriptInterface
        public void incomingCall(String callId, String title, String text) {
            if (visible) return;
            NotificationHelper.showIncomingCall(getApplicationContext(), callId, title, text);
        }

        @JavascriptInterface
        public void cancelCall() {
            NotificationHelper.cancelCall(getApplicationContext());
        }

        /** Görüşme başladı/bitti: servis mikrofon tipine yükseltilir / geri alınır. */
        @JavascriptInterface
        public void setInCall(boolean inCall) {
            KeepAliveService.start(getApplicationContext(), inCall);
        }

        @JavascriptInterface
        public void saveFile(String dataUrl, String fileName, String mime) {
            try {
                int comma = dataUrl.indexOf(',');
                if (comma < 0 || !dataUrl.substring(0, comma).contains(";base64")) {
                    throw new IOException("Desteklenmeyen veri biçimi");
                }
                byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);

                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);

                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) throw new IOException("Dosya oluşturulamadı");
                    try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                        if (os == null) throw new IOException("Dosya açılamadı");
                        os.write(bytes);
                    }
                } else {
                    File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    //noinspection ResultOfMethodCallIgnored
                    dir.mkdirs();
                    try (FileOutputStream fos = new FileOutputStream(new File(dir, fileName))) {
                        fos.write(bytes);
                    }
                }
                toast("İndirilenler'e kaydedildi: " + fileName);
            } catch (Exception e) {
                toast("Kaydedilemedi: " + e.getMessage());
            }
        }
    }

    /** Giriş yapılınca bir kez: pil optimizasyonundan muaf tutmayı iste (bildirimler kesilmesin). */
    private void askBatteryOptimization() {
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            try {
                if (!visible || Build.VERSION.SDK_INT < 23) return;
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                if (pm == null || pm.isIgnoringBatteryOptimizations(getPackageName())) return;
                Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                i.setData(Uri.parse("package:" + getPackageName()));
                startActivity(i);
            } catch (Exception ignored) {
            }
        }, 4000);
    }

    private void toast(final String msg) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show());
    }

    // ---------- Yaşam döngüsü ----------

    @Override
    protected void onStart() {
        super.onStart();
        visible = true;
        monitorHandler.removeCallbacks(monitor);
        monitorHandler.postDelayed(monitor, 3000);
    }

    @Override
    protected void onResume() {
        super.onResume();
        NotificationHelper.clearMessages(this);
    }

    @Override
    protected void onStop() {
        visible = false;
        monitorHandler.removeCallbacks(monitor);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(false);
            setTurnScreenOn(false);
        }
        super.onStop();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            moveTaskToBack(true);
        }
    }

    @Override
    protected void onDestroy() {
        visible = false;
        monitorHandler.removeCallbacks(monitor);
        if (current == this) current = null;
        if (connectivityManager != null && netCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(netCallback);
            } catch (Exception ignored) {
            }
        }
        if (server != null) server.stop();
        // Servis çalışmaya devam eder (uygulama kapalıyken de bildirim gelsin);
        // sadece giriş yoksa durdurulur.
        if (!Session.load(this).valid()) KeepAliveService.stop(this);
        if (webView != null) {
            webView.removeJavascriptInterface("QyripAndroid");
            webView.destroy();
        }
        super.onDestroy();
    }
}
