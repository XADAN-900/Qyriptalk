package com.xadan.qyriptalk;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.database.ChildEventListener;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.Query;
import com.google.firebase.database.ServerValue;
import com.google.firebase.database.ValueEventListener;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Uygulama kapalıyken bile (servis çalıştığı sürece) Firebase'i yerel olarak dinler:
 * odalar, özel mesajlar ve gelen aramalar için bildirim üretir.
 */
final class ChatWatcher {

    private static final String DB_URL = "https://qyriptalk-cdf56-default-rtdb.europe-west1.firebasedatabase.app";
    private static final long RESCAN_MS = 60_000;

    private static ChatWatcher instance;

    static synchronized ChatWatcher get(Context c) {
        if (instance == null) instance = new ChatWatcher(c.getApplicationContext());
        return instance;
    }

    private static final class Reg {
        final Query query;
        final ChildEventListener listener;

        Reg(Query q, ChildEventListener l) {
            query = q;
            listener = l;
        }

        void remove() {
            try {
                query.removeEventListener(listener);
            } catch (Exception ignored) {
            }
        }
    }

    private abstract static class ChildAdapter implements ChildEventListener {
        @Override public void onChildChanged(DataSnapshot s, String p) { }
        @Override public void onChildRemoved(DataSnapshot s) { }
        @Override public void onChildMoved(DataSnapshot s, String p) { }
        @Override public void onCancelled(DatabaseError e) { }
    }

    private final Context ctx;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private FirebaseDatabase db;
    private boolean started = false;
    private String uid;
    private String username;
    private boolean enabled = true;
    private boolean dmScanned = false;

    private Reg callReg;
    private DatabaseReference joinedRef;
    private ValueEventListener joinedListener;
    private final Map<String, Reg> convRegs = new HashMap<>();
    private final Map<String, String> roomNames = new HashMap<>();
    private final Set<String> notifiedKeys = new HashSet<>();

    private final Runnable rescan = new Runnable() {
        @Override
        public void run() {
            if (!started) return;
            scanDms();
            handler.postDelayed(this, RESCAN_MS);
        }
    };

    private ChatWatcher(Context c) {
        this.ctx = c;
    }

    // ---------- yaşam döngüsü (hepsi ana thread'de) ----------

    /** Kayıtlı oturuma göre dinlemeyi başlatır / günceller / durdurur. */
    void refresh() {
        handler.post(this::doRefresh);
    }

    void shutdown() {
        handler.post(this::doStop);
    }

    private void doRefresh() {
        Session s = Session.load(ctx);
        if (!s.valid()) {
            doStop();
            return;
        }
        enabled = s.notificationsEnabled;
        username = s.username;
        if (started && s.uid.equals(uid)) {
            scanDms(); // yeni kullanıcılar / yeni DM'ler hemen dinlensin
            return;
        }
        doStop();
        uid = s.uid;
        try {
            ensureDb();
        } catch (Exception e) {
            return;
        }
        started = true;
        dmScanned = false;
        watchCalls();
        watchRooms();
        scanDms();
        registerFcmToken();
        handler.postDelayed(rescan, RESCAN_MS);
    }

    private void doStop() {
        started = false;
        handler.removeCallbacks(rescan);
        if (callReg != null) {
            callReg.remove();
            callReg = null;
        }
        if (joinedRef != null && joinedListener != null) {
            try {
                joinedRef.removeEventListener(joinedListener);
            } catch (Exception ignored) {
            }
        }
        joinedRef = null;
        joinedListener = null;
        for (Reg r : convRegs.values()) r.remove();
        convRegs.clear();
        uid = null;
    }

    private void ensureDb() {
        if (db != null) return;
        if (FirebaseApp.getApps(ctx).isEmpty()) {
            FirebaseOptions o = new FirebaseOptions.Builder()
                    .setApplicationId("1:710550099549:web:30795fe709cca2b9fa5fb4")
                    .setApiKey("AIzaSyCdR7G4TXNyb2wM_OWGJYgpZrgBl8FaWqo")
                    .setDatabaseUrl(DB_URL)
                    .setProjectId("qyriptalk-cdf56")
                    .build();
            FirebaseApp.initializeApp(ctx, o);
        }
        db = FirebaseDatabase.getInstance(DB_URL);
    }

    // ---------- gelen aramalar ----------

    private void watchCalls() {
        DatabaseReference ref = db.getReference("callInvites").child(uid);
        ChildEventListener l = new ChildAdapter() {
            @Override
            public void onChildAdded(DataSnapshot snap, String prev) {
                try {
                    final String callId = snap.getKey();
                    final String callerName = snap.child("callerName").getValue(String.class);
                    final String type = snap.child("type").getValue(String.class);
                    final String title = snap.child("title").getValue(String.class);
                    if (callId == null) return;
                    db.getReference("calls").child(callId).child("status")
                            .addListenerForSingleValueEvent(new ValueEventListener() {
                                @Override
                                public void onDataChange(DataSnapshot s) {
                                    String st = s.getValue(String.class);
                                    if ("ringing".equals(st) || "active".equals(st)) {
                                        postCall(callId, callerName, type, title);
                                    }
                                }

                                @Override
                                public void onCancelled(DatabaseError e) {
                                    postCall(callId, callerName, type, title);
                                }
                            });
                } catch (Exception ignored) {
                }
            }

            @Override
            public void onChildRemoved(DataSnapshot snap) {
                NotificationHelper.cancelCall(ctx);
            }
        };
        ref.addChildEventListener(l);
        callReg = new Reg(ref, l);
    }

    private void postCall(String callId, String callerName, String type, String title) {
        if (MainActivity.visible) return;
        String caller = (callerName == null || callerName.isEmpty()) ? "Qyriptalk" : callerName;
        boolean room = "room".equals(type);
        String t = room ? ((title == null || title.isEmpty()) ? "Oda" : title) : caller;
        String text = room ? (caller + " grup araması başlattı") : "Sesli arıyor...";
        NotificationHelper.showIncomingCall(ctx, callId, t, text);
    }

    // ---------- odalar ----------

    private void watchRooms() {
        joinedRef = db.getReference("users").child(uid).child("joinedRooms");
        joinedListener = new ValueEventListener() {
            @Override
            public void onDataChange(DataSnapshot snap) {
                if (!started) return;
                Set<String> now = new HashSet<>();
                for (DataSnapshot c : snap.getChildren()) {
                    if (c.getKey() != null) now.add(c.getKey());
                }
                Iterator<Map.Entry<String, Reg>> it = convRegs.entrySet().iterator();
                while (it.hasNext()) {
                    Map.Entry<String, Reg> e = it.next();
                    if (e.getKey().startsWith("room:") && !now.contains(e.getKey().substring(5))) {
                        e.getValue().remove();
                        it.remove();
                    }
                }
                for (String rid : now) {
                    if (!convRegs.containsKey("room:" + rid)) attachRoom(rid);
                }
            }

            @Override
            public void onCancelled(DatabaseError e) { }
        };
        joinedRef.addValueEventListener(joinedListener);
    }

    private void attachRoom(final String roomId) {
        db.getReference("rooms").child(roomId).child("name")
                .addListenerForSingleValueEvent(new ValueEventListener() {
                    @Override
                    public void onDataChange(DataSnapshot s) {
                        String n = s.getValue(String.class);
                        if (n != null) roomNames.put(roomId, n);
                    }

                    @Override
                    public void onCancelled(DatabaseError e) { }
                });
        attach("room:" + roomId, "rooms/" + roomId + "/messages", true, roomId, false);
    }

    // ---------- özel mesajlar ----------

    /**
     * Özel sohbetleri bulur. DM kimliği web uygulamasındaki gibi [uid1, uid2] sıralı + "_" ile
     * birleştirilerek üretilir; böylece privateMessages kökü okunamasa bile (veritabanı kuralları
     * kökü kapatıyorsa) tüm kullanıcılarla olan DM'ler dinlenir. Eskiden sadece
     * privateMessages.json?shallow=true sorgusuna güveniliyordu; bu sorgu reddedilince hiçbir
     * DM bildirimi gelmiyordu.
     */
    private void scanDms() {
        final String me = uid;
        if (me == null) return;
        io.execute(() -> {
            final Set<String> ids = new HashSet<>();
            for (String other : shallowKeys("users")) {
                if (other.equals(me)) continue;
                ids.add(me.compareTo(other) < 0 ? me + "_" + other : other + "_" + me);
            }
            ids.addAll(shallowKeys("privateMessages"));
            if (ids.isEmpty()) {
                // REST engelliyse SDK ile kullanıcı listesini al
                handler.post(() -> scanDmsViaSdk(me));
                return;
            }
            final List<String> list = new ArrayList<>(ids);
            handler.post(() -> applyDms(me, list));
        });
    }

    private void scanDmsViaSdk(final String me) {
        if (!started || !me.equals(uid) || db == null) return;
        db.getReference("users").addListenerForSingleValueEvent(new ValueEventListener() {
            @Override
            public void onDataChange(DataSnapshot snap) {
                List<String> ids = new ArrayList<>();
                for (DataSnapshot c : snap.getChildren()) {
                    String other = c.getKey();
                    if (other == null || other.equals(me)) continue;
                    ids.add(me.compareTo(other) < 0 ? me + "_" + other : other + "_" + me);
                }
                applyDms(me, ids);
            }

            @Override
            public void onCancelled(DatabaseError e) { }
        });
    }

    /** Bir düğümün alt anahtarlarını (içeriği indirmeden) döner; hata olursa boş liste. */
    private List<String> shallowKeys(String node) {
        List<String> out = new ArrayList<>();
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(DB_URL + "/" + node + ".json?shallow=true").openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(15000);
            if (c.getResponseCode() != 200) return out;
            StringBuilder sb = new StringBuilder();
            try (BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) {
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
            }
            String body = sb.toString().trim();
            if (!body.startsWith("{")) return out;
            JSONObject o = new JSONObject(body);
            Iterator<String> keys = o.keys();
            while (keys.hasNext()) out.add(keys.next());
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.disconnect();
        }
        return out;
    }

    private void applyDms(String me, List<String> ids) {
        if (ids == null) return;
        if (!started || !me.equals(uid)) return;
        boolean fresh = dmScanned;
        for (String id : ids) {
            String other = null;
            if (id.startsWith(me + "_")) other = id.substring(me.length() + 1);
            else if (id.endsWith("_" + me)) other = id.substring(0, id.length() - me.length() - 1);
            if (other == null || other.isEmpty()) continue;
            String key = "dm:" + id;
            if (!convRegs.containsKey(key)) {
                attach(key, "privateMessages/" + id + "/messages", false, other, fresh);
            }
        }
        dmScanned = true;
    }

    // ---------- ortak: son mesajı dinle ----------

    private void attach(final String key, final String path, final boolean room,
                        final String convId, final boolean fresh) {
        Query q = db.getReference(path).limitToLast(1);
        final boolean[] ready = {false};
        ChildEventListener l = new ChildAdapter() {
            @Override
            public void onChildAdded(DataSnapshot s, String prev) {
                onMessage(s, key, path, room, convId, ready[0], fresh);
            }
        };
        q.addChildEventListener(l);
        q.addListenerForSingleValueEvent(new ValueEventListener() {
            @Override
            public void onDataChange(DataSnapshot x) {
                ready[0] = true;
            }

            @Override
            public void onCancelled(DatabaseError e) {
                ready[0] = true;
            }
        });
        convRegs.put(key, new Reg(q, l));
    }

    private void onMessage(DataSnapshot s, String convKey, String path, boolean room,
                           String convId, boolean ready, boolean fresh) {
        try {
            String senderUid = s.child("senderUid").getValue(String.class);
            String senderName = s.child("sender").getValue(String.class);
            if (uid == null || uid.equals(senderUid)) return;
            // eski mesajlarda senderUid olmayabilir: kendi adımızla gönderilmişse bildirim yok
            if (senderUid == null && username != null && !username.isEmpty() && username.equals(senderName)) return;

            Long ts = s.child("timestamp").getValue(Long.class);
            long now = System.currentTimeMillis();
            boolean isNew = ready || (fresh && ts != null && now - ts < 120_000);
            if (!isNew || !enabled || MainActivity.visible) return;
            if (Session.isMuted(ctx, convKey)) return;

            String msgKey = s.getKey();
            if (msgKey == null) return;
            if (notifiedKeys.size() > 500) notifiedKeys.clear();
            if (!notifiedKeys.add(msgKey)) return;

            String sender = s.child("sender").getValue(String.class);
            if (sender == null || sender.isEmpty()) sender = "Qyriptalk";
            String title = room ? roomNames.containsKey(convId) ? roomNames.get(convId) : "Oda" : sender;

            NotificationHelper.showConversationMessage(ctx, convKey, room, title, path,
                    sender, describe(s), ts != null ? ts : now, msgKey);
        } catch (Exception ignored) {
        }
    }

    private static String describe(DataSnapshot s) {
        String text = s.child("text").getValue(String.class);
        if (text != null && !text.trim().isEmpty()) return text;
        String type = s.child("type").getValue(String.class);
        String caption = s.child("caption").getValue(String.class);
        if ("voice".equals(type)) return "🎤 Sesli mesaj";
        if ("image".equals(type)) {
            return "📷 Fotoğraf" + ((caption != null && !caption.isEmpty()) ? ": " + caption : "");
        }
        if ("file".equals(type)) {
            String fn = s.child("fileName").getValue(String.class);
            return "📎 " + (fn != null ? fn : "Dosya");
        }
        return "Yeni mesaj";
    }

    // ---------- FCM token (sunucu push göndersin diye veritabanına yazılır) ----------

    void registerFcmToken() {
        try {
            ensureDb();
            FirebaseMessaging.getInstance().getToken().addOnSuccessListener(this::saveToken);
        } catch (Throwable ignored) {
        }
    }

    void saveToken(String token) {
        Session s = Session.load(ctx);
        if (!s.valid() || token == null || token.isEmpty()) return;
        try {
            ensureDb();
            db.getReference("fcmTokens").child(s.uid).child(token).setValue(ServerValue.TIMESTAMP);
        } catch (Exception ignored) {
        }
    }

    /** Çıkış yapılınca bu cihazın token'ını sil (başkasının bildirimi bu telefona gelmesin). */
    void removeToken(final String oldUid) {
        try {
            ensureDb();
            FirebaseMessaging.getInstance().getToken().addOnSuccessListener(t -> {
                if (t != null) db.getReference("fcmTokens").child(oldUid).child(t).removeValue();
            });
        } catch (Throwable ignored) {
        }
    }

    // ---------- bildirimden yanıt / okundu ----------

    void sendMessage(String path, String text) {
        Session s = Session.load(ctx);
        if (!s.valid()) return;
        try {
            ensureDb();
            DatabaseReference ref = db.getReference(path).push();
            Map<String, Object> m = new HashMap<>();
            m.put("sender", s.username);
            m.put("senderUid", s.uid);
            m.put("text", text);
            m.put("timestamp", ServerValue.TIMESTAMP);
            m.put("readBy", new HashMap<String, Object>());
            ref.setValue(m);
        } catch (Exception ignored) {
        }
    }

    void markRead(String path, List<String> keys) {
        Session s = Session.load(ctx);
        if (!s.valid()) return;
        try {
            ensureDb();
            for (String k : keys) {
                db.getReference(path).child(k).child("readBy").child(s.uid).setValue(true);
            }
        } catch (Exception ignored) {
        }
    }
}
