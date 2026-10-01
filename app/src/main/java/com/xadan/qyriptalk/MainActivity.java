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
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {

    private static final int PREFERRED_PORT = 38213; // sabit port = sabit origin = localStorage kaybolmaz
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_WEB_PERMISSIONS = 2001;

    private WebView webView;
    private LocalServer server;
    private int port = -1;

    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingPermissionRequest;

    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback netCallback;
    private boolean offlinePageShown = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#05001E"));
        setContentView(webView);

        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);

        setupWebView();

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

    /** İnternet varsa uygulamayı, yoksa offline.html hata ekranını yükler. */
    private void loadStart() {
        if (port < 0) return;
        String base = "http://localhost:" + port + "/";
        if (isOnline()) {
            offlinePageShown = false;
            webView.loadUrl(base + "index.html");
        } else {
            offlinePageShown = true;
            webView.loadUrl(base + "offline.html");
        }
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
                    if (!isOnline()) setOfflineBanner(true);
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
        String js = "(function(){var id='qt-offline-banner';var e=document.getElementById(id);"
                + (show
                ? "if(!e){e=document.createElement('div');e.id=id;"
                + "e.textContent='\u0130nternet ba\u011flant\u0131s\u0131 yok';"
                + "e.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;"
                + "background:#d32f2f;color:#fff;text-align:center;font:600 14px sans-serif;"
                + "padding:8px;padding-top:max(8px,env(safe-area-inset-top))';"
                + "document.body.appendChild(e);}"
                : "if(e)e.remove();")
                + "})();";
        webView.evaluateJavascript(js, null);
    }

    private void setupWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

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

    // ---------- Dosya kaydetme köprüsü (blob / data URL -> İndirilenler) ----------

    public class DownloadBridge {
        @JavascriptInterface
        public void retry() {
            runOnUiThread(() -> loadStart());
        }

        @JavascriptInterface
        public void saveFile(String dataUrl, String fileName, String mime) {
            try {
                int comma = dataUrl.indexOf(',');
                if (comma < 0 || !dataUrl.substring(0, comma).contains(";base64")) {
                    throw new IOException("Desteklenmeyen veri biçimi");
                }
                byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);

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
                toast("İndirilenler'e kaydedildi: " + fileName);
            } catch (Exception e) {
                toast("Kaydedilemedi: " + e.getMessage());
            }
        }
    }

    private void toast(final String msg) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show());
    }

    // ---------- Yaşam döngüsü ----------

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
        if (connectivityManager != null && netCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(netCallback);
            } catch (Exception ignored) {
            }
        }
        if (server != null) server.stop();
        if (webView != null) {
            webView.removeJavascriptInterface("QyripAndroid");
            webView.destroy();
        }
        super.onDestroy();
    }
}
