// FIREBASE KONFİGÜRASYONU
const firebaseConfig = {
    apiKey: "AIzaSyCdR7G4TXNyb2wM_OWGJYgpZrgBl8FaWqo",
    authDomain: "qyriptalk-cdf56.firebaseapp.com",
    databaseURL: "https://qyriptalk-cdf56-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "qyriptalk-cdf56",
    storageBucket: "qyriptalk-cdf56.firebasestorage.app",
    messagingSenderId: "710550099549",
    appId: "1:710550099549:web:30795fe709cca2b9fa5fb4",
    measurementId: "G-L6FZF5BCRH"
};

// FIREBASE BAŞLAT
const app = firebase.initializeApp(firebaseConfig);
const database = app.database();

// ============================================================================
// Not: "yazıyor..." ve "çevrimiçi/çevrimdışı" sinyalleri zaten aşağıda
// doğrudan Firebase RTDB (database.ref(...).set / .onDisconnect()) ile
// çalışıyor — Socket.io hiç kullanılmıyordu (dinleyicisi yoktu), o yüzden
// backend'siz sürümde tamamen kaldırıldı. identifySocket() eski çağrı
// noktalarını bozmamak için no-op olarak bırakıldı.
// ============================================================================

// ============================================================================
// ANLIK GÜNCELLEME ALTYAPISI
// - messagesRef.off() aynı yola bağlı TÜM dinleyicileri (kenar çubuğundaki
//   "son mesaj" dinleyicisi dahil) söküyordu. Artık sadece kendi
//   dinleyicilerimizi (query + callback) sökeriz.
// ============================================================================
let messageListenerHandles = [];
function attachMessageListener(query, eventType, cb) {
    query.on(eventType, cb);
    messageListenerHandles.push({ query, eventType, cb });
}
function detachMessageListeners() {
    messageListenerHandles.forEach(h => {
        try { h.query.off(h.eventType, h.cb); } catch (e) {}
    });
    messageListenerHandles = [];
}

function buildMessagePreviewText(lastMsg) {
    let t = "";
    if (lastMsg.type === 'file') t = `📎 ${lastMsg.fileName || 'Dosya'}`;
    else if (lastMsg.type === 'image') t = "🖼️ Resim";
    else if (lastMsg.type === 'video') t = "🎬 Video";
    else if (lastMsg.type === 'voice') t = "🎤 Sesli Mesaj";
    else t = lastMsg.text || "Mesaj";
    if (t.length > 25) t = t.substring(0, 25) + '...';
    return t;
}

// Bağlantı takılı kalırsa (WebView arka plandan dönünce, ağ değişince)
// Firebase'i yeniden bağla: mesajlar ve önizlemeler anında akmaya devam etsin.
let fbConnected = true;
database.ref('.info/connected').on('value', (snap) => { fbConnected = snap.val() === true; });
function kickFirebaseConnection() {
    try {
        database.goOnline();
        setTimeout(() => {
            if (!fbConnected) {
                database.goOffline();
                setTimeout(() => database.goOnline(), 200);
            }
        }, 2500);
    } catch (e) {}
}
window.addEventListener('online', kickFirebaseConnection);
document.addEventListener('visibilitychange', () => { if (!document.hidden) kickFirebaseConnection(); });

// ============================================================================
// ÇEVRİMDIŞI DESTEK
// İnternet yokken de odalar, DM listesi ve eski mesajlar okunabilsin.
// Veriler offline-cache.js ile IndexedDB'ye yazılır; internet gelince Firebase
// zaten canlı veriyi getirip bunların üstüne yazar.
// ============================================================================
let __qtRoomsCacheTimer = null;
function cacheRoomsForOffline() {
    if (!currentUser || !currentUser.uid || !window.QTCache) return;
    // Throttle: zamanlayıcı bekliyorsa yenisini kurma (her olayda sıfırlanınca hiç yazılmıyordu)
    if (__qtRoomsCacheTimer) return;
    __qtRoomsCacheTimer = setTimeout(() => {
        __qtRoomsCacheTimer = null;
        try {
            // Odalar henüz sunucudan gelmediyse (boş) önbelleği boşla ezme
            if (!rooms || Object.keys(rooms).length === 0) return;
            const slim = {};
            Object.keys(rooms || {}).forEach(id => {
                if (!joinedRooms.has(id)) return;
                const r = rooms[id];
                if (!r || !r.name) return;
                const copy = {};
                Object.keys(r).forEach(k => { if (k !== 'messages') copy[k] = r[k]; });
                if (copy.password) copy.password = true; // şifreyi cihazda saklama
                slim[id] = copy;
                if (r.messages) QTCache.replaceMessages('room:' + id, r.messages);
            });
            QTCache.put('rooms', slim);
        } catch (e) { console.error('Oda önbelleği yazılamadı:', e); }
    }, 1000);
}

let __qtUsersCacheTimer = null;
function cacheUsersForOffline() {
    if (!currentUser || !currentUser.uid || !window.QTCache) return;
    if (__qtUsersCacheTimer) return; // throttle (debounce sürekli sıfırlanıp hiç yazılmayabiliyordu)
    __qtUsersCacheTimer = setTimeout(() => {
        __qtUsersCacheTimer = null;
        try {
            if (!allUsers || Object.keys(allUsers).length === 0) return;
            const slim = {};
            Object.keys(allUsers || {}).forEach(id => {
                const u = allUsers[id];
                if (!u) return;
                const copy = {};
                Object.keys(u).forEach(k => { if (k !== 'password' && k !== 'joinedRooms') copy[k] = u[k]; });
                copy.isOnline = false; // çevrimdışıyken kimseyi "çevrimiçi" gösterme
                slim[id] = copy;
            });
            QTCache.put('users', slim);
        } catch (e) { console.error('Kullanıcı önbelleği yazılamadı:', e); }
    }, 2000);
}

// Uygulama açılırken (veya internet yokken) önbellekteki oda/DM listesini yükler.
// Firebase canlı veriyi getirirse zaten onun üstüne yazılır.
async function restoreOfflineState() {
    if (!currentUser || !currentUser.uid || !window.QTCache) return;
    try {
        const [cRooms, cUsers, cDms] = await Promise.all([
            QTCache.get('rooms'), QTCache.get('users'), QTCache.get('dmList')
        ]);
        if (cRooms && Object.keys(rooms || {}).length === 0) rooms = cRooms;
        // Önbellekte sadece bu hesabın katıldığı odalar var: joinedRooms (localStorage) boş
        // kaldıysa odalar listede görünmüyordu, önbellekten geri kur.
        if (cRooms && joinedRooms.size === 0) Object.keys(cRooms).forEach(id => joinedRooms.add(id));
        if (cUsers && Object.keys(allUsers || {}).length === 0) allUsers = cUsers;
        if (cDms && (!window.currentDMList || window.currentDMList.length === 0)) window.currentDMList = cDms;

        for (const id of Object.keys(rooms || {})) {
            if (!joinedRooms.has(id) || roomLastMessages[id]) continue;
            const map = await QTCache.getMessages('room:' + id);
            const list = Object.values(map).filter(Boolean).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            const last = list[list.length - 1];
            if (last) roomLastMessages[id] = `${last.sender}: ${buildMessagePreviewText(last)}`;
        }
        updateRoomList();
    } catch (e) {
        console.error('Çevrimdışı durum yüklenemedi:', e);
    }
}

// Sohbet açılınca: internet yoksa (ya da sunucu mesajı gelmiyorsa) önbellekten göster.
function showCachedMessages(chatKey, chatId) {
    const isCurrent = () => selectedRoomId === chatId;
    const run = async () => {
        if (!isCurrent() || !window.QTCache) return;
        const map = await QTCache.getMessages(chatKey);
        if (!isCurrent()) return;
        const entries = Object.entries(map)
            .filter(e => e[1])
            .sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));
        let added = false;
        entries.forEach(([key, msg]) => {
            if (processedMessageIds.has(key)) return;
            processedMessageIds.add(key);
            if (document.querySelector(`.message-wrapper[data-message-id='${key}']`)) return;
            appendMessage(key, msg, true);
            added = true;
        });
        if (added && messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
    };
    if ((window.isOfflineNow && window.isOfflineNow()) || !fbConnected) {
        run();
    } else {
        setTimeout(() => { if (processedMessageIds.size === 0) run(); }, 1500);
    }
}
window.addEventListener('focus', kickFirebaseConnection);

// Fotoğrafı göndermeden önce küçült (5MB base64 yerine ~200KB): hem gönderme
// hem alıcıdaki önizleme/yükleme anında olur.
function compressImageFile(file, maxDim = 1280, quality = 0.8) {
    return new Promise((resolve) => {
        if (!file || !file.type || !file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') {
            return resolve(file);
        }
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            try {
                let { width, height } = img;
                const scale = Math.min(1, maxDim / Math.max(width, height));
                width = Math.round(width * scale);
                height = Math.round(height * scale);
                const canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    URL.revokeObjectURL(url);
                    if (!blob || blob.size >= file.size) return resolve(file);
                    const name = (file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg';
                    resolve(new File([blob], name, { type: 'image/jpeg' }));
                }, 'image/jpeg', quality);
            } catch (e) { URL.revokeObjectURL(url); resolve(file); }
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
    });
}


// Firebase set() sunucu onayını bekler; bağlantı takılırsa arayüz sonsuza dek
// bekliyordu ("mesaj gitmiyor"). Yerel yazma anında görünür; sunucuya gitmesi
// arka planda sürer. En fazla ms kadar bekleyip arayüzü serbest bırakırız,
// geç gelen hata olursa kullanıcıya bildiririz.
function setMessageFast(ref, payload, ms = 4000) {
    let timedOut = false;
    const p = ref.set(payload);
    p.catch((err) => {
        if (timedOut) {
            showToast('Hata', 'Mesaj gönderilemedi, bağlantınızı kontrol edin.', 'error');
            console.error('Geç mesaj gönderme hatası:', err);
        }
    });
    return Promise.race([
        p,
        new Promise((resolve) => setTimeout(() => { timedOut = true; resolve(); }, ms))
    ]);
}

function identifySocket() {
    // Socket.io kaldırıldı - kasıtlı olarak boş.
}

// Dosyayı backend'e/harici bir servise yüklemek yerine doğrudan base64
// data URL'ine çevirir (FileReader), böylece hiçbir sunucu veya üçüncü
// parti hesap gerekmez — mesajın içine gömülüp doğrudan Firebase RTDB'ye
// yazılabilir. Eski uploadFileToBackend ile aynı dönüş şeklini korur:
// { ok, url, name, size, type }. NOT: Firebase RTDB tek node başına ~10MB
// sınırı olduğundan çok büyük dosyalarda (özellikle video) hata alınabilir.
function uploadFileToBackend(file, onProgress) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onprogress = (e) => {
            if (e.lengthComputable && typeof onProgress === 'function') {
                onProgress(Math.round((e.loaded / e.total) * 100));
            }
        };

        reader.onload = () => {
            if (typeof onProgress === 'function') onProgress(100);
            resolve({
                ok: true,
                url: reader.result, // data:<mime>;base64,....
                name: file.name,
                size: file.size,
                type: file.type
            });
        };

        reader.onerror = () => reject(new Error('Dosya okunamadı.'));

        reader.readAsDataURL(file);
    });
}

// DEĞİŞKENLER
let rooms = {};
let currentUser = null;
let selectedRoomId = null;
let typingTimeout = null;
let isTyping = false;
let userStatusRef = null;
let messagesRef = null;
let roomUsersRef = null;
let typingRef = null;
let kickBanRef = null;
let lastMessageDate = null;
let replyingTo = null; // { id, sender, isOwn, previewText } - şu an yanıtlanmakta olan mesaj
let editingMessage = null; // { id } - şu an düzenlenmekte olan mesaj
let messageCache = {}; // msgId -> msg verisi (yanıt önizlemesi, düzenleme, iletme ve "orijinale git" için)
let pinnedMessageRef = null;
let currentPinnedMessageId = null;
let selectionMode = false;
let selectedMessageIds = new Set();
let lastTouchInteractionTs = 0; // sağ tık menüsünü dokunmatik uzun basmadan ayırt etmek için
let isDmChat = false;
let currentDmOtherUserId = null; // split('_') ile dmId'yi ayrıştırmak, uid'lerin içinde '_' olabildiği için güvenilir değil
let roomLastMessages = {};
let joinedRooms = new Set();
let allUsers = {};
let currentRoomType = 'public';
let userProfile = {
    bio: "",
    profilePhoto: null,
    role: 'user',
    settings: {
        enterToSend: true,
        showReadReceipts: true,
        autoTranslate: false,
        messageNotifications: true,
        soundNotifications: true,
        autoTheme: false,
        compactMode: false
    }
};

// MESAJ TEKRARI ÖNLEMEK İÇİN EKLENEN DEĞİŞKENLER
let lastProcessedMessageId = null;
let isInitialLoad = true;
let processedMessageIds = new Set();

// BİLDİRİM DEĞİŞKENLERİ
let notificationCount = 0;
let isWindowVisible = true;
let notificationSound = null;

// ÜST MENÜ ZİL BİLDİRİMLERİ
let globalNotifications = [];
let unreadGlobalNotifications = 0;
let roomNotifyInitialized = new Set();
let roomNotifyListenerAttached = new Set();
let dmNotifyInitialized = new Set();
let dmNotifyListenerAttached = new Set();
const MAX_GLOBAL_NOTIFICATIONS = 30;

// ============================================================
// SES EFEKTLERİ SİSTEMİ (Web Audio API - harici dosyaya gerek yok)
// Arama sesi (giden), çaldırma sesi (gelen), mesaj bildirim sesi
// ============================================================
let sfxAudioCtx = null;
let dialToneTimer = null;      // giden arama "tuut... tuut..." döngüsü
let ringtoneTimer = null;      // gelen arama zil döngüsü

function sfxGetContext() {
    if (!sfxAudioCtx) {
        sfxAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (sfxAudioCtx.state === 'suspended') {
        sfxAudioCtx.resume().catch(() => {});
    }
    return sfxAudioCtx;
}

function sfxSoundsEnabled() {
    return !userProfile || !userProfile.settings || userProfile.settings.soundNotifications !== false;
}

// Tek bir ton çal (freq: frekans Hz, start: başlangıç zamanı (ctx.currentTime'a göre saniye), dur: süre sn)
function sfxPlayTone(ctx, freq, start, dur, type = 'sine', peakVolume = 0.15) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peakVolume, start + 0.02);
    gain.gain.linearRampToValueAtTime(peakVolume, start + dur - 0.03);
    gain.gain.linearRampToValueAtTime(0, start + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
}

// ------- Mesaj geldi sesi (kısa, tatlı iki notalı "ding") -------
function playMessageReceivedSound() {
    if (!sfxSoundsEnabled()) return;
    try {
        const ctx = sfxGetContext();
        const now = ctx.currentTime;
        sfxPlayTone(ctx, 880, now, 0.12, 'sine', 0.18);
        sfxPlayTone(ctx, 1318.5, now + 0.09, 0.16, 'sine', 0.16);
    } catch (e) {
        console.error('[SES] mesaj sesi çalınamadı:', e);
    }
}

// ------- Giden arama sesi: "tuut... tuut..." (çevirme/ringback tonu) -------
function startDialTone() {
    if (!sfxSoundsEnabled() || dialToneTimer) return;
    const cycle = () => {
        try {
            const ctx = sfxGetContext();
            const now = ctx.currentTime;
            sfxPlayTone(ctx, 425, now, 1.0, 'sine', 0.12);
        } catch (e) {
            console.error('[SES] arama sesi çalınamadı:', e);
        }
    };
    cycle();
    dialToneTimer = setInterval(cycle, 3000);
}

function stopDialTone() {
    if (dialToneTimer) {
        clearInterval(dialToneTimer);
        dialToneTimer = null;
    }
}

// ------- Gelen arama çaldırma sesi: klasik telefon zili ritmi -------
function startRingtone() {
    if (!sfxSoundsEnabled() || ringtoneTimer) return;
    const ring = () => {
        try {
            const ctx = sfxGetContext();
            const now = ctx.currentTime;
            // Klasik "ring-ring" ikili darbe
            [0, 0.4].forEach((offset) => {
                sfxPlayTone(ctx, 1000, now + offset, 0.35, 'sine', 0.16);
                sfxPlayTone(ctx, 800, now + offset, 0.35, 'sine', 0.10);
            });
        } catch (e) {
            console.error('[SES] çaldırma sesi çalınamadı:', e);
        }
    };
    ring();
    ringtoneTimer = setInterval(ring, 2000);
}

function stopRingtone() {
    if (ringtoneTimer) {
        clearInterval(ringtoneTimer);
        ringtoneTimer = null;
    }
}

// ------- Arama sona erdi/başarısız sesi (kısa iniş tonu) -------
function playCallEndSound() {
    if (!sfxSoundsEnabled()) return;
    try {
        const ctx = sfxGetContext();
        const now = ctx.currentTime;
        sfxPlayTone(ctx, 500, now, 0.15, 'sine', 0.14);
        sfxPlayTone(ctx, 350, now + 0.13, 0.2, 'sine', 0.14);
    } catch (e) {
        console.error('[SES] arama bitiş sesi çalınamadı:', e);
    }
}

// ============================================================
// SESLİ ARAMA SİSTEMİ (GERÇEK WEBRTC - MESH TOPOLOJİ)
// ============================================================
// DM'de karşı kullanıcıyı, oda içinde odadaki TÜM kullanıcıları
// arar. Sinyalleşme (offer/answer/ICE) Firebase Realtime Database
// üzerinden yapılır. Ses akışı doğrudan tarayıcılar arasında
// (peer-to-peer) akar; Firebase sadece "randevu masası" görevi görür.
//
// NOT: STUN + ücretsiz public TURN (openrelay.metered.ca) kullanılıyor.
// TURN olmadan simetrik NAT / bazı kurumsal ağlarda bağlantı kurulamaz;
// public TURN sınırlı kapasiteli olduğu için yoğun kullanımda düşebilir.
// Bu, WebRTC'nin doğası gereği bir sınırlamadır (kendi TURN sunucumuz
// olmadan aşılamaz), sistemin geri kalanı tamamen gerçek ve çalışır durumda.

const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ]
};

let callLocalStream = null;
let callPeerConnections = {};       // uid -> RTCPeerConnection
let callRemoteAudioEls = {};        // uid -> <audio>
let callIceRestartTimers = {};      // uid -> timeout id (bağlantı zayıflayınca yeniden bağlanma denemesi)
let callId = null;                  // aktif/çalan görüşmenin id'si
let callType = null;                // 'dm' | 'room'
let callTargetId = null;            // dmId veya roomId
let callIsCaller = false;
let callMyJoinedAt = null;
let callParticipantsRef = null;
let callStatusRef = null;
let callInviteWatchRef = null;
let callMuted = false;
let callRingTimeout = null;
let incomingCallData = null;        // {callId, ...} gösterilen gelen arama
let callState = 'idle';             // 'idle' | 'outgoing' | 'incoming' | 'active'
let callStartedAt = null;           // görüşme 'active' olduğunda başlayan süre sayacı
let callDurationInterval = null;

function callGetLocalUid() {
    return currentUser ? currentUser.uid : null;
}

// ------- Mikrofon izni + local stream -------
async function callGetLocalStream() {
    if (callLocalStream) return callLocalStream;
    // WhatsApp kalitesine yakın ses için: yankı iptali, gürültü bastırma,
    // otomatik kazanç kontrolü ve yüksek örnekleme hızı istiyoruz.
    callLocalStream = await navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000,
            channelCount: 1
        },
        video: false
    });
    return callLocalStream;
}

// ------- Aramayı başlat (telefon ikonuna basınca) -------
async function startCall() {
    if (!currentUser || !selectedRoomId) return;

    if (callState !== 'idle') {
        showToast('Uyarı', 'Zaten devam eden bir görüşme var.', 'error');
        return;
    }

    let targetUids = [];
    let title = '';

    if (isDmChat) {
        const otherUserId = currentDmOtherUserId || selectedRoomId.split('_').find(uid => uid !== currentUser.uid);
        if (!otherUserId) {
            showToast('Hata', 'Kullanıcı bulunamadı.', 'error');
            return;
        }
        targetUids = [otherUserId];
        title = (allUsers[otherUserId] && allUsers[otherUserId].username) || document.getElementById('room-title').textContent;
    } else {
        try {
            const snap = await database.ref(`rooms/${selectedRoomId}/users`).once('value');
            const roomUsers = snap.val() || {};
            targetUids = Object.keys(roomUsers).filter(uid => uid !== currentUser.uid);
        } catch (e) {
            console.error(e);
        }
        if (targetUids.length === 0) {
            showToast('Uyarı', 'Odada aranacak başka kullanıcı yok.', 'error');
            return;
        }
        title = rooms[selectedRoomId] ? rooms[selectedRoomId].name : 'Oda';
    }

    try {
        await callGetLocalStream();
    } catch (e) {
        console.error(e);
        showToast('Hata', 'Mikrofona erişilemedi. Lütfen izin verin.', 'error');
        return;
    }

    const newCallRef = database.ref('calls').push();
    callId = newCallRef.key;
    callType = isDmChat ? 'dm' : 'room';
    callTargetId = selectedRoomId;
    callIsCaller = true;
    callMyJoinedAt = Date.now();

    try {
        await newCallRef.set({
            type: callType,
            targetId: callTargetId,
            callerId: currentUser.uid,
            callerName: currentUser.username,
            title: title,
            status: 'ringing',
            createdAt: firebase.database.ServerValue.TIMESTAMP
        });

        await newCallRef.child(`participants/${currentUser.uid}`).set({
            username: currentUser.username,
            joinedAt: callMyJoinedAt,
            status: 'joined'
        });
    } catch (err) {
        console.error('[ARAMA] calls/ kaydı oluşturulamadı (Database Rules izin hatası olabilir):', err);
        showToast('Hata', 'Arama başlatılamadı (veritabanı izin hatası).', 'error');
        callState = 'idle';
        return;
    }

    let inviteFailCount = 0;
    await Promise.all(targetUids.map(uid =>
        database.ref(`callInvites/${uid}/${callId}`).set({
            type: callType,
            targetId: callTargetId,
            callerId: currentUser.uid,
            callerName: currentUser.username,
            title: title,
            createdAt: firebase.database.ServerValue.TIMESTAMP
        }).catch(err => {
            inviteFailCount++;
            console.error(`[ARAMA] ${uid} kullanıcısına çağrı daveti yazılamadı:`, err);
        })
    ));

    if (inviteFailCount === targetUids.length) {
        // Hiçbir davet karşı tarafa ulaşmadı (genelde Firebase Database Rules izin vermiyor)
        showToast('Hata', 'Arama karşı tarafa ulaştırılamadı (izin hatası). Firebase Database Rules ayarlarını kontrol edin.', 'error');
        await newCallRef.remove().catch(() => {});
        callState = 'idle';
        updateCallHeaderBtn(false);
        return;
    } else if (inviteFailCount > 0) {
        showToast('Uyarı', `${inviteFailCount} kişiye arama daveti gönderilemedi.`, 'error');
    }

    callState = 'outgoing';
    openCallModal(title, targetUids.length > 1 ? `${targetUids.length} kişi aranıyor...` : 'Çalıyor...');
    watchCallStatusAndParticipants(callId);
    updateCallHeaderBtn(true);
    startDialTone();

    // Cevap gelmezse belirli sürede aramayı otomatik sonlandır
    const ringTimeoutMs = callType === 'dm' ? 45000 : 60000;
    callRingTimeout = setTimeout(() => {
        database.ref(`calls/${callId}/participants`).once('value').then(s => {
            const parts = s.val() || {};
            const joinedCount = Object.keys(parts).filter(uid => parts[uid].status === 'joined').length;
            if (joinedCount <= 1) {
                showToast('Bilgi', 'Kimse yanıt vermedi.', 'info');
                leaveCall();
            }
        });
    }, ringTimeoutMs);
}

// ------- Gelen aramaları global olarak dinle (login sonrası çağrılır) -------
function listenForIncomingCalls() {
    if (!currentUser || !currentUser.uid) return;
    if (callInviteWatchRef) callInviteWatchRef.off();

    callInviteWatchRef = database.ref(`callInvites/${currentUser.uid}`);
    callInviteWatchRef.on('child_added', (snap) => {
        const invite = snap.val();
        const invCallId = snap.key;
        if (!invite) return;

        database.ref(`calls/${invCallId}/status`).once('value').then(s => {
            const status = s.val();
            if (status === 'ringing' || status === 'active') {
                showIncomingCallUI(invCallId, invite);
            } else {
                database.ref(`callInvites/${currentUser.uid}/${invCallId}`).remove();
            }
        }).catch(err => {
            // calls/{id}/status okunamadıysa (Database Rules izin hatası olabilir),
            // yine de daveti göster: davetin varlığı zaten aramanın devam ettiğini gösterir.
            console.error('[ARAMA] çağrı durumu okunamadı, davet yine de gösteriliyor:', err);
            showIncomingCallUI(invCallId, invite);
        });
    });

    callInviteWatchRef.on('child_removed', (snap) => {
        // Arayan kişi aramayı iptal etti / bitti
        if (incomingCallData && incomingCallData.callId === snap.key) {
            hideIncomingCallUI();
        }
    });
}

function showIncomingCallUI(invCallId, invite) {
    // DM çakışması (glare): ikimiz de tam aynı anda birbirimizi arıyorsak,
    // ikisi de "outgoing" durumda kalıp karşılıklı otomatik reddediliyordu.
    // Bunun yerine deterministik olarak (push id küçük olan kazanır) tek
    // bir görüşmede buluşuyoruz; iki taraf da aynı sonuca varır.
    if (callState === 'outgoing' && invite.type === 'dm' && callType === 'dm' && invite.targetId === callTargetId) {
        if (invCallId < callId) {
            // Karşı tarafın araması kazanıyor: kendi giden aramamızı iptal edip onunkine katılıyoruz.
            leaveCall(false).then(() => {
                incomingCallData = { callId: invCallId, ...invite };
                acceptIncomingCall();
            });
        } else {
            // Bizim aramamız kazanıyor: karşı tarafın daveti yok sayılıyor,
            // o da kendi tarafında aynı karşılaştırmayla bizimkini kabul edecek.
            database.ref(`callInvites/${currentUser.uid}/${invCallId}`).remove();
        }
        return;
    }

    if (callState !== 'idle') {
        // zaten bir görüşmedeyken gelen çağrıyı otomatik reddet
        database.ref(`callInvites/${currentUser.uid}/${invCallId}`).remove();
        return;
    }

    incomingCallData = { callId: invCallId, ...invite };
    callState = 'incoming';

    const banner = document.getElementById('incoming-call-banner');
    const avatar = document.getElementById('incoming-call-avatar');
    const nameEl = document.getElementById('incoming-call-name');
    const subEl = document.getElementById('incoming-call-sub');

    nameEl.textContent = invite.type === 'room' ? `${invite.title || (window.i18n ? window.i18n.t('Oda') : 'Oda')}` : invite.callerName;
    subEl.textContent = invite.type === 'room'
        ? (window.i18n ? window.i18n.t(`${invite.callerName} grup araması başlattı`) : `${invite.callerName} grup araması başlattı`)
        : (window.i18n ? window.i18n.t('Sesli arıyor...') : 'Sesli arıyor...');
    avatar.textContent = (invite.callerName || '?').charAt(0).toUpperCase();
    avatar.style.backgroundImage = (allUsers[invite.callerId] && allUsers[invite.callerId].profilePhoto)
        ? `url(${allUsers[invite.callerId].profilePhoto})` : '';

    banner.classList.remove('hidden');
    startRingtone();
}

function hideIncomingCallUI() {
    document.getElementById('incoming-call-banner').classList.add('hidden');
    stopRingtone();
    if (callState === 'incoming') {
        callState = 'idle';
    }
    incomingCallData = null;
}

async function acceptIncomingCall() {
    if (!incomingCallData) return;
    const invite = incomingCallData;
    hideIncomingCallUI();

    try {
        await callGetLocalStream();
    } catch (e) {
        showToast('Hata', 'Mikrofona erişilemedi. Lütfen izin verin.', 'error');
        database.ref(`callInvites/${currentUser.uid}/${invite.callId}`).remove();
        return;
    }

    callId = invite.callId;
    callType = invite.type;
    callTargetId = invite.targetId;
    callIsCaller = false;
    callMyJoinedAt = Date.now();

    try {
        await database.ref(`calls/${callId}/participants/${currentUser.uid}`).set({
            username: currentUser.username,
            joinedAt: callMyJoinedAt,
            status: 'joined'
        });
        await database.ref(`calls/${callId}/status`).set('active');
    } catch (err) {
        console.error('[ARAMA] görüşmeye katılınamadı (Database Rules izin hatası olabilir):', err);
        showToast('Hata', 'Görüşmeye katılınamadı (veritabanı izin hatası).', 'error');
        database.ref(`callInvites/${currentUser.uid}/${callId}`).remove().catch(() => {});
        callState = 'idle';
        return;
    }
    database.ref(`callInvites/${currentUser.uid}/${callId}`).remove();

    callState = 'active';
    const title = invite.type === 'room' ? invite.title : invite.callerName;
    openCallModal(title, 'Bağlanıyor...');
    watchCallStatusAndParticipants(callId);
    updateCallHeaderBtn(true);
}

function declineIncomingCall() {
    if (!incomingCallData) return;
    const declinedId = incomingCallData.callId;
    database.ref(`callInvites/${currentUser.uid}/${declinedId}`).remove();
    database.ref(`calls/${declinedId}/participants/${currentUser.uid}`).set({
        username: currentUser.username,
        status: 'declined'
    });
    hideIncomingCallUI();
}

// ------- Katılımcı listesini izleyip mesh bağlantıları kur -------
function watchCallStatusAndParticipants(activeCallId) {
    if (callParticipantsRef) callParticipantsRef.off();
    if (callStatusRef) callStatusRef.off();

    callParticipantsRef = database.ref(`calls/${activeCallId}/participants`);
    callStatusRef = database.ref(`calls/${activeCallId}/status`);

    callParticipantsRef.on('value', (snap) => {
        const participants = snap.val() || {};
        renderCallParticipants(participants);

        const joinedUids = Object.keys(participants).filter(uid => participants[uid].status === 'joined');

        if (joinedUids.length > 1) {
            if (callState !== 'active') {
                callState = 'active';
                if (callRingTimeout) { clearTimeout(callRingTimeout); callRingTimeout = null; }
            }
            stopDialTone();
            startCallDurationTimer(); // zaten çalışıyorsa (arayan tarafı) fonksiyon içi guard sayesinde bir şey yapmaz
        }

        joinedUids.forEach(uid => {
            if (uid === currentUser.uid) return;
            if (callPeerConnections[uid]) return; // zaten bağlantı var

            const otherJoinedAt = participants[uid].joinedAt || 0;
            const iAmOfferer = otherJoinedAt < callMyJoinedAt; // benden önce katılana ben teklif gönderirim
            createCallPeerConnection(uid, iAmOfferer, activeCallId);
        });

        // ayrılanları temizle
        Object.keys(callPeerConnections).forEach(uid => {
            if (!joinedUids.includes(uid)) {
                cleanupCallPeer(uid);
            }
        });
    });

    callStatusRef.on('value', (snap) => {
        if (snap.val() === 'ended') {
            leaveCall(true);
        }
    });
}

// ------- Tek bir peer bağlantısı kur (mesh'in bir bacağı) -------
async function createCallPeerConnection(remoteUid, isOfferer, activeCallId) {
    const myUid = currentUser.uid;
    const pc = new RTCPeerConnection(ICE_SERVERS);
    callPeerConnections[remoteUid] = pc;

    // Uzak tanım (remote description) henüz set edilmeden gelen ICE
    // adaylarını kaybetmemek için kuyruğa alıyoruz.
    const pendingCandidates = [];
    let remoteDescSet = false;

    async function flushPendingCandidates() {
        while (pendingCandidates.length) {
            const c = pendingCandidates.shift();
            try {
                await pc.addIceCandidate(new RTCIceCandidate(c));
            } catch (e) {
                console.error('ICE ekleme hatası:', e);
            }
        }
    }

    callLocalStream.getTracks().forEach(track => pc.addTrack(track, callLocalStream));

    pc.ontrack = (event) => {
        playCallRemoteStream(remoteUid, event.streams[0]);
    };

    const pairKey = isOfferer ? `${myUid}_${remoteUid}` : `${remoteUid}_${myUid}`;
    const pairRef = database.ref(`calls/${activeCallId}/peers/${pairKey}`);

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            pairRef.child(`candidates/${myUid}`).push(event.candidate.toJSON());
        }
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected') {
            // Ağ kısa süreliğine koptu olabilir (WiFi<->mobil veri geçişi gibi).
            // Hemen kapatmak yerine birkaç saniye toparlanma şansı ver.
            scheduleIceRestart(remoteUid, isOfferer, activeCallId, pairRef);
        } else if (pc.connectionState === 'failed') {
            scheduleIceRestart(remoteUid, isOfferer, activeCallId, pairRef, true);
        } else if (pc.connectionState === 'connected') {
            clearPendingIceRestart(remoteUid);
        } else if (pc.connectionState === 'closed') {
            cleanupCallPeer(remoteUid);
        }
    };

    pairRef.child(`candidates/${remoteUid}`).on('child_added', (snap) => {
        const candidate = snap.val();
        if (!candidate) return;
        if (remoteDescSet) {
            pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error('ICE ekleme hatası:', e));
        } else {
            pendingCandidates.push(candidate);
        }
    });

    if (isOfferer) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await pairRef.child('offer').set({ sdp: offer.sdp, type: offer.type });

        pairRef.child('answer').on('value', async (snap) => {
            const ans = snap.val();
            if (ans && !pc.currentRemoteDescription) {
                await pc.setRemoteDescription(new RTCSessionDescription(ans));
                remoteDescSet = true;
                flushPendingCandidates();
            }
        });
    } else {
        pairRef.child('offer').on('value', async (snap) => {
            const offer = snap.val();
            if (offer && !pc.currentRemoteDescription) {
                await pc.setRemoteDescription(new RTCSessionDescription(offer));
                remoteDescSet = true;
                flushPendingCandidates();
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                await pairRef.child('answer').set({ sdp: answer.sdp, type: answer.type });
            }
        });
    }
}

// ------- Görüşme süresini "Bağlanıyor..." yerine mm:ss olarak canlı göster -------
function startCallDurationTimer() {
    if (callDurationInterval) return; // zaten çalışıyor
    callStartedAt = Date.now();

    const statusEl = document.getElementById('call-modal-status');
    const tick = () => {
        const elapsed = Math.floor((Date.now() - callStartedAt) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        statusEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    tick();
    callDurationInterval = setInterval(tick, 1000);
}

function stopCallDurationTimer() {
    if (callDurationInterval) {
        clearInterval(callDurationInterval);
        callDurationInterval = null;
    }
    callStartedAt = null;
}

function playCallRemoteStream(uid, stream) {
    let audioEl = callRemoteAudioEls[uid];
    if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.id = `call-remote-audio-${uid}`;
        document.getElementById('call-remote-audios').appendChild(audioEl);
        callRemoteAudioEls[uid] = audioEl;
    }
    audioEl.srcObject = stream;
}

function cleanupCallPeer(uid) {
    clearPendingIceRestart(uid);
    if (callPeerConnections[uid]) {
        try { callPeerConnections[uid].close(); } catch (e) {}
        delete callPeerConnections[uid];
    }
    if (callRemoteAudioEls[uid]) {
        callRemoteAudioEls[uid].remove();
        delete callRemoteAudioEls[uid];
    }
}

// ------- Bağlantı zayıfladığında/koptuğunda otomatik yeniden bağlanma -------
// Mobil ağlarda WiFi<->veri geçişi ya da anlık paket kaybı yüzünden
// WebRTC bağlantısı "disconnected" durumuna düşebilir; bu her zaman
// görüşmenin bittiği anlamına gelmez. Hemen görüşmeden düşürmek yerine
// kısa bir süre bekleyip ICE'i sessizce yeniden başlatıyoruz (trickle ICE
// restart - offer/answer'ı yeniden pazarlığa gerek kalmadan, mevcut
// sinyalleşme kanalı üzerinden yeni ICE adayları akar).
function scheduleIceRestart(remoteUid, isOfferer, activeCallId, pairRef, urgent) {
    if (callIceRestartTimers[remoteUid]) return; // zaten bir deneme planlı
    const delay = urgent ? 800 : 2500;
    callIceRestartTimers[remoteUid] = setTimeout(() => {
        delete callIceRestartTimers[remoteUid];
        const pc = callPeerConnections[remoteUid];
        if (!pc || pc.connectionState === 'connected' || pc.connectionState === 'closed') return;

        console.warn(`[ARAMA] ${remoteUid} ile bağlantı zayıfladı, yeniden bağlanılıyor...`);
        try {
            if (typeof pc.restartIce === 'function') pc.restartIce();
        } catch (e) {
            console.error('[ARAMA] ICE yeniden başlatma hatası:', e);
        }

        // Restart denemesinden makul bir süre sonra hâlâ toparlanmadıysa
        // bu katılımcıyı görüşmeden düşür (sonsuza kadar beklemesin).
        setTimeout(() => {
            const pc2 = callPeerConnections[remoteUid];
            if (pc2 && (pc2.connectionState === 'failed' || pc2.connectionState === 'disconnected')) {
                console.warn(`[ARAMA] ${remoteUid} ile bağlantı kurulamadı, görüşmeden düşürülüyor.`);
                cleanupCallPeer(remoteUid);
            }
        }, 9000);
    }, delay);
}

function clearPendingIceRestart(remoteUid) {
    if (callIceRestartTimers[remoteUid]) {
        clearTimeout(callIceRestartTimers[remoteUid]);
        delete callIceRestartTimers[remoteUid];
    }
}

// ------- Aktif çağrı modalını render et -------
function openCallModal(title, statusText) {
    document.getElementById('call-modal-title').textContent = title || (window.i18n ? window.i18n.t('Görüşme') : 'Görüşme');
    document.getElementById('call-modal-status').textContent = statusText ? (window.i18n ? window.i18n.t(statusText) : statusText) : '';
    document.getElementById('call-modal').classList.add('active');
}

function closeCallModal() {
    document.getElementById('call-modal').classList.remove('active');
    document.getElementById('call-participants-grid').innerHTML = '';
}

function renderCallParticipants(participants) {
    const grid = document.getElementById('call-participants-grid');
    grid.innerHTML = '';

    Object.keys(participants).forEach(uid => {
        const p = participants[uid];
        if (p.status === 'declined' || p.status === 'left') return;

        const div = document.createElement('div');
        div.className = 'call-participant';

        const avatar = document.createElement('div');
        avatar.className = 'call-participant-avatar';
        if (p.status === 'ringing') avatar.classList.add('ringing');

        const photo = allUsers[uid] && allUsers[uid].profilePhoto;
        if (photo) {
            avatar.style.backgroundImage = `url(${photo})`;
        } else {
            avatar.textContent = (p.username || '?').charAt(0).toUpperCase();
        }

        const nameEl = document.createElement('div');
        nameEl.className = 'call-participant-name';
        nameEl.textContent = uid === currentUser.uid ? (window.i18n ? window.i18n.t('Sen') : 'Sen') : (p.username || (window.i18n ? window.i18n.t('Bilinmeyen') : 'Bilinmeyen'));

        div.appendChild(avatar);
        div.appendChild(nameEl);
        grid.appendChild(div);
    });
}

function updateCallHeaderBtn(active) {
    const btn = document.getElementById('call-btn');
    if (!btn) return;
    btn.classList.toggle('in-call', !!active);
    btn.title = active ? (window.i18n ? window.i18n.t('Görüşme Devam Ediyor') : 'Görüşme Devam Ediyor') : (window.i18n ? window.i18n.t('Ara') : 'Ara');
}

function toggleCallMute() {
    if (!callLocalStream) return;
    callMuted = !callMuted;
    callLocalStream.getAudioTracks().forEach(track => track.enabled = !callMuted);

    const btn = document.getElementById('call-mute-btn');
    btn.classList.toggle('active-muted', callMuted);
    btn.querySelector('i').className = callMuted ? 'fas fa-microphone-slash' : 'fas fa-microphone';

    if (callId && currentUser) {
        database.ref(`calls/${callId}/participants/${currentUser.uid}/muted`).set(callMuted);
    }
}

// ------- Görüşmeden ayrıl / sonlandır -------
async function leaveCall(remote) {
    if (callState === 'idle') return;

    if (callRingTimeout) { clearTimeout(callRingTimeout); callRingTimeout = null; }
    stopCallDurationTimer();
    stopDialTone();
    stopRingtone();
    playCallEndSound();

    Object.keys(callPeerConnections).forEach(uid => cleanupCallPeer(uid));
    callPeerConnections = {};

    if (callLocalStream) {
        callLocalStream.getTracks().forEach(track => track.stop());
        callLocalStream = null;
    }

    if (callParticipantsRef) { callParticipantsRef.off(); callParticipantsRef = null; }
    if (callStatusRef) { callStatusRef.off(); callStatusRef = null; }

    if (callId && currentUser && !remote) {
        const partSnap = await database.ref(`calls/${callId}/participants`).once('value');
        const participants = partSnap.val() || {};
        const stillJoined = Object.keys(participants).filter(uid => uid !== currentUser.uid && participants[uid].status === 'joined');

        await database.ref(`calls/${callId}/participants/${currentUser.uid}`).set({
            username: currentUser.username,
            status: 'left'
        });

        if (stillJoined.length === 0) {
            // görüşmede kimse kalmadı, tamamen kapat
            await database.ref(`calls/${callId}/status`).set('ended');
            database.ref(`calls/${callId}`).remove();
            const invitesSnap = await database.ref(`callInvites`).once('value');
            const allInvites = invitesSnap.val() || {};
            Object.keys(allInvites).forEach(uid => {
                if (allInvites[uid] && allInvites[uid][callId]) {
                    database.ref(`callInvites/${uid}/${callId}`).remove();
                }
            });
        }
    }

    closeCallModal();
    updateCallHeaderBtn(false);

    callState = 'idle';
    callId = null;
    callType = null;
    callTargetId = null;
    callIsCaller = false;
    callMuted = false;
}

// MEDYA DEĞİŞKENLERİ
let audioChunks = [];
let mediaRecorder = null;
let audioStream = null;
let recordStartTime = null;
let recordTimer = null;
let audioBlob = null;
let imagePreviewFile = null;
let imagePreviewData = null;
let videoPreviewFile = null;
let videoPreviewData = null;
let filePreviewFile = null;
let filePreviewData = null;
let currentPreviewRoomId = null;

// CUSTOM MODAL DEĞİŞKENLERİ
let confirmResolve = null;
let alertResolve = null;

// MESSAGES CONTAINER REFERANSI
const messagesContainer = document.getElementById('messages-container');

// EMOJİ LİSTESİ
const emojiCategories = {
    'frequent': ['😀', '😂', '😊', '❤️', '👍', '👋', '🔥', '🌟'],
    'faces': ['😀', '😃', '😄', '😁', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾'],
    'objects': ['⌚', '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🖲️', '🕹️', '🗜️', '💽', '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽️', '🎞️', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏱️', '⏲️', '⏰', '🕰️', '⌛', '⏳', '📡', '🔋', '🔌', '💡', '🔦', '🕯️', '🪔', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '💰', '💳', '💎', '⚖️', '🧰', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🔩', '⚙️', '🧱', '⛓️', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡️', '⚔️', '🛡️', '🚬', '⚰️', '⚱️', '🏺', '🔮', '📿', '🧿', '💈', '⚗️', '🔭', '🔬', '🕳️', '🩹', '🩺', '💊', '💉', '🩸', '🧬', '🦠', '🧫', '🧪', '🌡️', '🧹', '🧺', '🧻', '🚽', '🚰', '🚿', '🛁', '🛀', '🧼', '🪒', '🧽', '🧴', '🛎️', '🔑', '🗝️', '🚪', '🪑', '🛋️', '🛌', '🧸', '🖼️', '🛍️', '🛒', '🎁', '🎈', '🎏', '🎀', '🎊', '🎉', '🎎', '🏮', '🎐', '🧧', '✉️', '📩', '📨', '📧', '💌', '📥', '📤', '📦', '🏷️', '📪', '📫', '📬', '📭', '📮', '📯', '📜', '📃', '📄', '📑', '🧾', '📊', '📈', '📉', '🗒️', '🗓️', '📆', '📅', '🗑️', '📇', '🗃️', '🗳️', '🗄️', '📋', '📁', '📂', '🗂️', '🗞️', '📰', '📓', '📔', '📒', '📕', '📗', '📘', '📙', '📚', '📖', '🔖', '🧷', '🔗', '📎', '🖇️', '📐', '📏', '🧮', '📌', '📍', '✂️', '🖊️', '🖋️', '✒️', '🖌️', '🖍️', '📝', '✏️', '🔍', '🔎', '🔏', '🔐', '🔒', '🔓']
};

// ============= %100 ÇALIŞAN ÇEVİRİ FONKSİYONU (MyMemory API) =============
// targetLang verilmezse, arayüz için seçilen dile göre otomatik belirlenir:
// arayüz İngilizce ise mesajlar İngilizce'ye, Türkçe ise Türkçe'ye çevrilir.
async function translateMessage(text, targetLang) {
    try {
        if (!text || text.trim().length === 0) {
            return text;
        }

        const onlyEmojis = /^[\p{Emoji}\s]+$/u.test(text);
        if (onlyEmojis) {
            return text;
        }

        if (!targetLang) {
            targetLang = (window.i18n && window.i18n.getLang() === 'en') ? 'en' : 'tr';
        }
        const sourceLang = targetLang === 'en' ? 'tr' : 'en';

        console.log("🌐 Çeviri isteği gönderiliyor:", text);

        const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${targetLang}`);

        if (!response.ok) {
            throw new Error(`HTTP hata! status: ${response.status}`);
        }

        const data = await response.json();
        console.log("✅ Çeviri yanıtı:", data);
        
        if (data && data.responseData && data.responseData.translatedText) {
            if (data.responseData.translatedText === text) {
                return text;
            }
            return data.responseData.translatedText;
        } else {
            console.warn("⚠️ Çeviri yanıtı beklenen formatta değil:", data);
            return text;
        }

    } catch (error) {
        console.error("❌ Çeviri API hatası:", error);
        showToast('Çeviri Hatası', 'Çeviri yapılamadı, internet bağlantınızı kontrol edin.', 'error');
        return text;
    }
}

// ============= KULLANICI ROL ROZETİ =============
function updateUserRoleBadge() {
    const badge = document.getElementById('user-role-badge');
    
    if (!badge) {
        return;
    }
    
    if (userProfile.role === 'admin') {
        badge.className = 'user-role-badge admin';
        badge.title = window.i18n ? window.i18n.t('Admin') : 'Admin';
        badge.innerHTML = 'A';
        badge.style.display = 'flex';
    } else if (userProfile.role === 'moderator') {
        badge.className = 'user-role-badge moderator';
        badge.title = window.i18n ? window.i18n.t('Moderatör') : 'Moderatör';
        badge.innerHTML = 'M';
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

// CUSTOM MODAL FONKSİYONLARI
function customConfirm(title, message, options = {}) {
    return new Promise((resolve) => {
        confirmResolve = resolve;
        
        const modal = document.getElementById('confirm-modal');
        const icon = document.getElementById('confirm-icon');
        const titleEl = document.getElementById('confirm-title');
        const messageEl = document.getElementById('confirm-message');
        const buttonsEl = document.getElementById('confirm-buttons');
        
        titleEl.textContent = window.i18n ? window.i18n.t(title) : title;
        messageEl.textContent = window.i18n ? window.i18n.t(message) : message;
        
        const iconType = options.icon || 'question';
        const iconClasses = {
            'question': 'fas fa-question-circle info',
            'warning': 'fas fa-exclamation-triangle warning',
            'error': 'fas fa-times-circle error',
            'info': 'fas fa-info-circle info',
            'success': 'fas fa-check-circle success'
        };
        
        icon.className = 'confirm-icon';
        icon.innerHTML = `<i class="${iconClasses[iconType].split(' ')[0]} ${iconClasses[iconType].split(' ')[1]}"></i>`;
        
        buttonsEl.innerHTML = '';
        
        const cancelText = window.i18n ? window.i18n.t(options.cancelText || 'Hayır') : (options.cancelText || 'Hayır');
        const okText = window.i18n ? window.i18n.t(options.okText || 'Evet') : (options.okText || 'Evet');
        const okType = options.okType || 'primary';
        const cancelType = options.cancelType || 'secondary';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.className = `confirm-btn ${cancelType}`;
        cancelBtn.id = 'confirm-cancel';
        cancelBtn.textContent = cancelText;
        cancelBtn.onclick = () => {
            modal.classList.remove('active');
            resolve(false);
        };
        
        const okBtn = document.createElement('button');
        okBtn.className = `confirm-btn ${okType}`;
        okBtn.id = 'confirm-ok';
        okBtn.textContent = okText;
        okBtn.onclick = () => {
            modal.classList.remove('active');
            resolve(true);
        };
        
        buttonsEl.appendChild(cancelBtn);
        buttonsEl.appendChild(okBtn);
        
        modal.classList.add('active');
        
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                modal.classList.remove('active');
                resolve(false);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
                resolve(false);
                document.removeEventListener('keydown', escHandler);
            }
        });
    });
}

function customAlert(title, message, options = {}) {
    return new Promise((resolve) => {
        alertResolve = resolve;
        
        const modal = document.getElementById('alert-modal');
        const icon = document.getElementById('alert-icon');
        const titleEl = document.getElementById('alert-title');
        const messageEl = document.getElementById('alert-message');
        const okBtn = document.getElementById('alert-ok');
        
        titleEl.textContent = window.i18n ? window.i18n.t(title) : title;
        messageEl.textContent = window.i18n ? window.i18n.t(message) : message;
        
        const iconType = options.icon || 'info';
        const iconClasses = {
            'question': 'fas fa-question-circle info',
            'warning': 'fas fa-exclamation-triangle warning',
            'error': 'fas fa-times-circle error',
            'info': 'fas fa-info-circle info',
            'success': 'fas fa-check-circle success'
        };
        
        icon.className = 'confirm-icon';
        icon.innerHTML = `<i class="${iconClasses[iconType].split(' ')[0]} ${iconClasses[iconType].split(' ')[1]}"></i>`;
        
        okBtn.textContent = window.i18n ? window.i18n.t(options.okText || 'Tamam') : (options.okText || 'Tamam');
        
        modal.classList.add('active');
        
        const handleOk = () => {
            modal.classList.remove('active');
            resolve(true);
            okBtn.removeEventListener('click', handleOk);
        };
        okBtn.addEventListener('click', handleOk);
        
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                modal.classList.remove('active');
                resolve(true);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
                resolve(true);
                document.removeEventListener('keydown', escHandler);
            }
        });
    });
}

// TEMEL FONKSİYONLAR
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

function showMobileScreen(screen) {
    const sidebar = document.querySelector('.sidebar');
    const chatArea = document.querySelector('.chat-area');
    
    if (screen === 'chat') {
        sidebar.classList.remove('active');
        chatArea.classList.add('active');
    } else {
        sidebar.classList.add('active');
        chatArea.classList.remove('active');
    }
}

function showModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function hideModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        if (!modal.id.includes('confirm-modal') && !modal.id.includes('alert-modal')) {
            modal.classList.remove('active');
        }
    });
}

function showToast(title, message, type = 'success') {
    const toast = document.getElementById('toast');
    const toastTitle = document.getElementById('toast-title');
    const toastMessage = document.getElementById('toast-message');
    
    toastTitle.textContent = window.i18n ? window.i18n.t(title) : title;
    toastMessage.textContent = window.i18n ? window.i18n.t(message) : message;
    
    toast.className = `toast ${type}`;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// BİLDİRİM SİSTEMİ
function updateNotificationBadge() {
    const badge = document.getElementById('notification-badge');
    if (!badge) return;
    
    if (notificationCount > 0) {
        badge.textContent = notificationCount > 9 ? '9+' : notificationCount.toString();
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

function showNotification(title, body, tag = 'message') {
    if (!isWindowVisible && userProfile.settings.messageNotifications) {
        if (Notification.permission === 'granted') {
            const notification = new Notification(title, {
                body: body,
                icon: 'https://cdn-icons-png.flaticon.com/512/733/733585.png',
                tag: tag,
                requireInteraction: false
            });
            
            notification.onclick = () => {
                window.focus();
                notification.close();
            };
            
            if (userProfile.settings.soundNotifications && !notificationSound) {
                notificationSound = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-correct-answer-tone-2870.mp3');
                notificationSound.volume = 0.3;
                notificationSound.play().then(() => {
                    setTimeout(() => {
                        notificationSound = null;
                    }, 1000);
                });
            }
        }
    }
    
    notificationCount++;
    updateNotificationBadge();
}

function resetNotificationCount() {
    notificationCount = 0;
    updateNotificationBadge();
}

// ÜST MENÜ ZİL BİLDİRİMLERİ
// - Liste cihazda saklanır (uygulama kapanınca kaybolmaz)
// - Her sohbet için "son görülen mesaj" tutulur: düzenleme / okundu işareti / silme gibi
//   değişiklikler yeni bildirim sayılmaz, uygulama kapalıyken gelen mesajlar ise açılışta bildirilir
// - Çıkışta / hesap değişince dinleyiciler sökülür
const NOTIF_STORE_PREFIX = 'qt-notifs:';
const NOTIF_SEEN_PREFIX = 'qt-notif-seen:';
let notifSeen = {};              // chatId -> { key, ts }
let notifLoadedFor = null;       // hangi hesabın verisi yüklü
const roomNotifyHandles = {};    // roomId -> { query, cb }
const dmNotifyHandles = {};      // dmId -> { query, cb }

function notifUid() {
    return (currentUser && currentUser.uid) ? currentUser.uid : null;
}

function persistGlobalNotifications() {
    const uid = notifUid();
    if (!uid) return;
    try { localStorage.setItem(NOTIF_STORE_PREFIX + uid, JSON.stringify(globalNotifications)); } catch (e) {}
}

function persistNotifSeen() {
    const uid = notifUid();
    if (!uid) return;
    try { localStorage.setItem(NOTIF_SEEN_PREFIX + uid, JSON.stringify(notifSeen)); } catch (e) {}
}

function recountUnreadGlobalNotifications() {
    unreadGlobalNotifications = globalNotifications.filter(n => n && !n.read).length;
}

// Giriş yapan hesabın kayıtlı bildirimlerini (ve son görülen mesaj bilgisini) yükler.
function loadGlobalNotifications() {
    const uid = notifUid();
    if (!uid || notifLoadedFor === uid) return;
    notifLoadedFor = uid;
    try {
        const saved = JSON.parse(localStorage.getItem(NOTIF_STORE_PREFIX + uid) || '[]');
        globalNotifications = Array.isArray(saved) ? saved.filter(n => n && typeof n === 'object').slice(0, MAX_GLOBAL_NOTIFICATIONS) : [];
    } catch (e) { globalNotifications = []; }
    try {
        const seen = JSON.parse(localStorage.getItem(NOTIF_SEEN_PREFIX + uid) || '{}');
        notifSeen = (seen && typeof seen === 'object') ? seen : {};
    } catch (e) { notifSeen = {}; }
    recountUnreadGlobalNotifications();
    updateGlobalNotificationBadge();
    renderGlobalNotifications();
}

// Çıkış / hesap değişimi: eski hesabın dinleyicilerini sök, bellekteki durumu sıfırla.
// clearStored=true ise cihazdaki bildirim kayıtları da silinir (çıkışta).
function resetNotificationState(clearStored) {
    const uid = notifUid();
    [roomNotifyHandles, dmNotifyHandles].forEach(handles => {
        Object.keys(handles).forEach(id => {
            try { handles[id].query.off('value', handles[id].cb); } catch (e) {}
            delete handles[id];
        });
    });
    roomNotifyInitialized.clear();
    roomNotifyListenerAttached.clear();
    dmNotifyInitialized.clear();
    dmNotifyListenerAttached.clear();
    try { Object.keys(dmLastMessageCache).forEach(k => delete dmLastMessageCache[k]); } catch (e) {}
    try { dmPrefetched.clear(); } catch (e) {}
    roomLastMessages = {};
    if (clearStored && uid) {
        try {
            localStorage.removeItem(NOTIF_STORE_PREFIX + uid);
            localStorage.removeItem(NOTIF_SEEN_PREFIX + uid);
        } catch (e) {}
    }
    globalNotifications = [];
    unreadGlobalNotifications = 0;
    notifSeen = {};
    notifLoadedFor = null;
    updateGlobalNotificationBadge();
    renderGlobalNotifications();
}

// Bir sohbetin "son mesajı" değiştiğinde çağrılır. Gerçekten YENİ ve BAŞKASINDAN gelen
// bir mesajsa zil listesine ekler.
function handleBellForMessage(chatId, lastMsgKey, lastMsg, notifBase) {
    if (!notifUid() || !lastMsg || !lastMsgKey) return;
    loadGlobalNotifications();

    const ts = typeof lastMsg.timestamp === 'number' ? lastMsg.timestamp : Date.now();
    const prev = notifSeen[chatId];
    const next = { key: lastMsgKey, ts: Math.max(ts, prev && prev.ts ? prev.ts : 0) };
    const changed = !prev || prev.key !== next.key || prev.ts !== next.ts;
    notifSeen[chatId] = next;
    if (changed) persistNotifSeen();

    if (!prev) return;                         // bu sohbeti ilk kez görüyoruz: sadece kaydet
    if (prev.key === lastMsgKey) return;       // aynı mesaj güncellendi (okundu işareti, düzenleme, tepki)
    if (ts <= (prev.ts || 0)) return;          // son mesaj silindi, eski mesaj "son" oldu
    const mine = (lastMsg.senderUid && lastMsg.senderUid === currentUser.uid) ||
                 (lastMsg.sender && lastMsg.sender === currentUser.username);
    if (mine) return;

    const viewing = !document.hidden && selectedRoomId === chatId;   // şu an o sohbeti okuyorsa rozet şişmesin
    addGlobalNotification(Object.assign({}, notifBase, {
        msgKey: lastMsgKey,
        timestamp: ts,
        read: !!viewing
    }));
}

function addGlobalNotification(notif) {
    loadGlobalNotifications();
    if (notif.msgKey && globalNotifications.some(n => n && n.msgKey === notif.msgKey && n.id === notif.id)) return;

    const dd = document.getElementById('notifications-dropdown');
    if (dd && dd.classList.contains('active')) notif.read = true; // liste açıkken gelen zaten görünüyor

    globalNotifications.unshift(notif);
    if (globalNotifications.length > MAX_GLOBAL_NOTIFICATIONS) {
        globalNotifications = globalNotifications.slice(0, MAX_GLOBAL_NOTIFICATIONS);
    }
    recountUnreadGlobalNotifications();
    persistGlobalNotifications();
    updateGlobalNotificationBadge();
    renderGlobalNotifications();
}

function updateGlobalNotificationBadge() {
    const badge = document.getElementById('global-notification-badge');
    if (!badge) return;

    if (unreadGlobalNotifications > 0) {
        badge.textContent = unreadGlobalNotifications > 9 ? '9+' : unreadGlobalNotifications.toString();
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

function renderGlobalNotifications() {
    const list = document.getElementById('notifications-list');
    const empty = document.getElementById('notifications-empty');
    if (!list) return;

    list.querySelectorAll('.notification-item').forEach(el => el.remove());

    if (globalNotifications.length === 0) {
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';

    globalNotifications.forEach((notif) => {
        // Tek bir bozuk kayıt (isimsiz kullanıcı vb.) tüm listeyi çökertmesin
        try {
            const name = String(notif.name || 'Sohbet');
            const item = document.createElement('div');
            item.className = 'notification-item' + (notif.read ? '' : ' unread');

            let timeStr = '';
            try {
                timeStr = new Date(notif.timestamp).toLocaleTimeString((window.i18n && window.i18n.getLocale ? window.i18n.getLocale() : 'tr-TR'), { hour: '2-digit', minute: '2-digit' });
            } catch (e) {}

            // textContent: mesajdaki "<" gibi karakterler listeyi bozmasın
            const avatar = document.createElement('div');
            avatar.className = 'notification-item-avatar';
            avatar.textContent = name.charAt(0).toUpperCase();

            const body = document.createElement('div');
            body.className = 'notification-item-body';

            const title = document.createElement('div');
            title.className = 'notification-item-title';
            const nameSpan = document.createElement('span');
            nameSpan.textContent = (notif.isDM ? 'Özel Mesaj: ' : '') + name;
            const timeSpan = document.createElement('span');
            timeSpan.className = 'notification-item-time';
            timeSpan.textContent = timeStr;
            title.appendChild(nameSpan);
            title.appendChild(timeSpan);

            const text = document.createElement('div');
            text.className = 'notification-item-text';
            text.textContent = `${notif.sender || ''}: ${notif.text || ''}`;

            body.appendChild(title);
            body.appendChild(text);
            item.appendChild(avatar);
            item.appendChild(body);

            item.onclick = () => {
                document.getElementById('notifications-dropdown').classList.remove('active');
                document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));

                if (notif.isDM) {
                    startDM(notif.userId, notif.name);
                } else {
                    const roomItem = document.querySelector(`.room-item[data-room-id="${notif.id}"]`);
                    if (roomItem) roomItem.classList.add('active');
                    enterRoom(notif.id);
                }

                const idx = globalNotifications.indexOf(notif);
                if (idx >= 0) globalNotifications.splice(idx, 1);
                recountUnreadGlobalNotifications();
                persistGlobalNotifications();
                updateGlobalNotificationBadge();
                renderGlobalNotifications();
            };

            list.appendChild(item);
        } catch (e) {
            console.error('Bildirim satırı çizilemedi:', e, notif);
        }
    });
}

function markAllGlobalNotificationsRead() {
    unreadGlobalNotifications = 0;
    globalNotifications.forEach(n => n.read = true);
    persistGlobalNotifications();
    updateGlobalNotificationBadge();
    renderGlobalNotifications();
}

function clearAllGlobalNotifications() {
    globalNotifications = [];
    unreadGlobalNotifications = 0;
    persistGlobalNotifications();
    updateGlobalNotificationBadge();
    renderGlobalNotifications();
}

document.addEventListener('visibilitychange', () => {
    isWindowVisible = !document.hidden;
    if (isWindowVisible) {
        resetNotificationCount();
    }
});

if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => {
        Notification.requestPermission();
    }, 2000);
}

async function logout() {
    if (callState !== 'idle') {
        await leaveCall();
    }
    hideIncomingCallUI();
    if (callInviteWatchRef) {
        callInviteWatchRef.off();
        callInviteWatchRef = null;
    }

    if (userStatusRef) {
        userStatusRef.set({
            username: currentUser.username,
            online: false
        });
        userStatusRef.onDisconnect().cancel();
    }
    if (currentUser) {
        database.ref(`users/${currentUser.uid}/isOnline`).set(false);
        database.ref(`users/${currentUser.uid}/lastSeen`).set(Date.now());
    }
    
    resetNotificationState(true); // eski hesabın bildirim dinleyicilerini sök + kayıtlarını sil
    currentUser = null;
    selectedRoomId = null;
    joinedRooms.clear();
    clearUserData();
    showScreen('login-screen');
    showToast('Başarılı', 'Başarıyla çıkış yapıldı.', 'success');
}

async function logoutWithConfirm() {
    const result = await customConfirm(
        'Çıkış Yap',
        'Hesabınızdan çıkış yapmak istediğinize emin misiniz?',
        {
            icon: 'question',
            okText: 'Çıkış Yap',
            cancelText: 'İptal',
            okType: 'danger'
        }
    );
    
    if (result) {
        logout();
    }
}

function showUploadProgress(fileName) {
    const progress = document.getElementById('upload-progress');
    if (!progress) return;
    
    const fileNameElement = document.getElementById('upload-file-name');
    const percentageElement = document.getElementById('upload-percentage');
    const progressFill = document.getElementById('progress-fill');
    
    fileNameElement.textContent = fileName;
    percentageElement.textContent = '%0';
    progressFill.style.width = '0%';
    progress.classList.add('active');
}

function updateUploadProgress(percentage) {
    const percentageElement = document.getElementById('upload-percentage');
    const progressFill = document.getElementById('progress-fill');
    
    percentageElement.textContent = `%${percentage}`;
    progressFill.style.width = `${percentage}%`;
}

function hideUploadProgress() {
    const progress = document.getElementById('upload-progress');
    if (progress) {
        progress.classList.remove('active');
    }
}

function showRoomPreview(roomId, room) {
    currentPreviewRoomId = roomId;
    
    const previewCard = document.getElementById('room-preview-card');
    previewCard.classList.remove('hidden');
    
    document.getElementById('room-preview-name').textContent = room.name || 'Bilinmeyen Oda';
    document.getElementById('room-preview-type').textContent = (window.i18n ? window.i18n.t((room.isPrivate ? 'Özel/Gizli Oda' : 'Herkese Açık Oda')) : (room.isPrivate ? 'Özel/Gizli Oda' : 'Herkese Açık Oda'));
    const previewAvatar = document.getElementById('room-preview-avatar');
    if (room.logo) {
        previewAvatar.style.backgroundImage = `url(${room.logo})`;
        previewAvatar.style.backgroundSize = 'cover';
        previewAvatar.style.backgroundPosition = 'center';
        previewAvatar.textContent = '';
    } else {
        previewAvatar.style.backgroundImage = '';
        previewAvatar.textContent = room.name ? room.name.charAt(0).toUpperCase() : 'O';
    }
    
    if (room.createdBy) {
        database.ref(`users/${room.createdBy}`).once('value').then(snapshot => {
            const creator = snapshot.val();
            document.getElementById('room-preview-creator').textContent = creator ? creator.username : (window.i18n ? window.i18n.t('Bilinmeyen') : 'Bilinmeyen');
        });
    }
    
    database.ref(`rooms/${roomId}/users`).once('value').then(snapshot => {
        const users = snapshot.val() || {};
        const memberCount = Object.keys(users).length;
        document.getElementById('room-preview-members').textContent = (window.i18n ? window.i18n.t(`${memberCount} üye`) : `${memberCount} üye`);
    });
    
    database.ref(`rooms/${roomId}/messages`).once('value').then(snapshot => {
        const messages = snapshot.val() || {};
        const messageCount = Object.keys(messages).length;
        document.getElementById('room-preview-messages').textContent = (window.i18n ? window.i18n.t(`${messageCount} mesaj`) : `${messageCount} mesaj`);
    });
    
    const hasJoined = joinedRooms.has(roomId);
    document.getElementById('room-preview-status').textContent = (window.i18n ? window.i18n.t(hasJoined ? 'Katıldınız' : 'Katılmadınız') : (hasJoined ? 'Katıldınız' : 'Katılmadınız'));
    document.getElementById('room-preview-status').style.color = hasJoined ? 'var(--success-color)' : 'var(--error-color)';
    
    const joinBtn = document.getElementById('room-preview-join-btn');
    if (hasJoined) {
        joinBtn.textContent = (window.i18n ? window.i18n.t('Odaya Git') : 'Odaya Git');
        joinBtn.style.backgroundColor = 'var(--success-color)';
    } else {
        joinBtn.textContent = (window.i18n ? window.i18n.t(room.password ? 'Şifre ile Katıl' : 'Katıl') : (room.password ? 'Şifre ile Katıl' : 'Katıl'));
        joinBtn.style.backgroundColor = '';
    }
}

function hideRoomPreview() {
    const previewCard = document.getElementById('room-preview-card');
    previewCard.classList.add('hidden');
    currentPreviewRoomId = null;
}

function extractRoomIdAndNameFromUrl(url) {
    try {
        const qyriptalkIndex = url.indexOf('Qyriptalk/');
        if (qyriptalkIndex === -1) {
            return null;
        }
        
        const afterQyriptalk = url.substring(qyriptalkIndex + 'Qyriptalk/'.length);
        const lastSlashIndex = afterQyriptalk.lastIndexOf('/');
        if (lastSlashIndex === -1) {
            return null;
        }
        
        const roomId = afterQyriptalk.substring(lastSlashIndex + 1);
        const roomName = afterQyriptalk.substring(0, lastSlashIndex);
        const cleanRoomName = roomName.replace(/\s+/g, '');
        
        if (roomId && roomId.length === 20) {
            return {
                id: roomId,
                name: cleanRoomName,
                originalName: roomName
            };
        }
        
        return null;
    } catch (e) {
        console.error("URL parse hatası:", e);
        return null;
    }
}

function joinRoomByInviteUrl(inviteUrl) {
    const roomInfo = extractRoomIdAndNameFromUrl(inviteUrl);
    
    if (!roomInfo) {
        showToast('Hata', 'Geçersiz davet URL\'si. Format: Qyriptalk/OdaAdı/OdaID', 'error');
        return;
    }
    
    const roomId = roomInfo.id;
    const roomName = roomInfo.originalName;
    
    if (rooms[roomId]) {
        showRoomPreview(roomId, rooms[roomId]);
    } else {
        database.ref(`rooms/${roomId}`).once('value').then(snapshot => {
            const roomData = snapshot.val();
            if (roomData) {
                rooms[roomId] = roomData;
                showRoomPreview(roomId, roomData);
            } else {
                showToast('Hata', 'Oda bulunamadı.', 'error');
            }
        });
    }
}

function showInviteFriendModal() {
    if (!selectedRoomId || isDmChat) {
        showToast('Uyarı', 'Bu özellik sadece odalar için geçerlidir.', 'error');
        return;
    }

    const room = rooms[selectedRoomId];
    if (!room) {
        showToast('Hata', 'Oda bulunamadı.', 'error');
        return;
    }

    const cleanRoomName = room.name.replace(/\s+/g, '');
    const inviteUrl = `Qyriptalk/${cleanRoomName}/${selectedRoomId}`;
    
    document.getElementById('invite-url-input').value = inviteUrl;
    showModal('invite-friend-modal');
}

function setupEmojiPicker() {
    const emojiPicker = document.getElementById('emoji-picker');
    const frequentEmojis = document.getElementById('frequent-emojis');
    const faceEmojis = document.getElementById('face-emojis');
    const objectEmojis = document.getElementById('object-emojis');

    emojiCategories.frequent.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'emoji-btn';
        btn.textContent = emoji;
        btn.onclick = () => insertEmoji(emoji);
        frequentEmojis.appendChild(btn);
    });

    emojiCategories.faces.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'emoji-btn';
        btn.textContent = emoji;
        btn.onclick = () => insertEmoji(emoji);
        faceEmojis.appendChild(btn);
    });

    emojiCategories.objects.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'emoji-btn';
        btn.textContent = emoji;
        btn.onclick = () => insertEmoji(emoji);
        objectEmojis.appendChild(btn);
    });

    document.addEventListener('click', (e) => {
        if (!emojiPicker.contains(e.target) && e.target.id !== 'emoji-input-btn') {
            emojiPicker.classList.remove('active');
        }
    });
}

function insertEmoji(emoji) {
    const messageInput = document.getElementById('message-input');
    const cursorPos = messageInput.selectionStart;
    const textBefore = messageInput.value.substring(0, cursorPos);
    const textAfter = messageInput.value.substring(cursorPos);
    
    messageInput.value = textBefore + emoji + textAfter;
    messageInput.focus();
    messageInput.setSelectionRange(cursorPos + emoji.length, cursorPos + emoji.length);
    
    messageInput.style.height = 'auto';
    messageInput.style.height = (messageInput.scrollHeight) + 'px';
    
    if (!currentUser || !selectedRoomId) return;
    
    const path = isDmChat ? `privateMessages/${selectedRoomId}/typing` : `rooms/${selectedRoomId}/typing`;
    const userTypingRef = database.ref(`${path}/${currentUser.uid}`);

    if (messageInput.value.length > 0) {
        if (!isTyping) {
            isTyping = true;
            userTypingRef.set({
                username: currentUser.username
            });
        }
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        isTyping = false;
        userTypingRef.set(null);
    }, 3000);
}

function toggleTheme() {
    if (userProfile.settings.autoTheme) {
        showToast('Bilgi', 'Otomatik tema açıkken manuel değiştirme kullanılamaz.', 'warning');
        return;
    }
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    const icon = document.querySelector('#theme-toggle-btn i');
    icon.className = newTheme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
}

// OTOMATİK TEMA - sistem tercihine göre temayı ayarlar ve değişiklikleri dinler
const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

function applySystemTheme() {
    const systemTheme = systemThemeQuery.matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', systemTheme);
    localStorage.setItem('theme', systemTheme);

    const icon = document.querySelector('#theme-toggle-btn i');
    if (icon) {
        icon.className = systemTheme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
    }
}

function updateAutoThemeState() {
    const themeToggleBtn = document.getElementById('theme-toggle-btn');

    if (userProfile.settings.autoTheme) {
        applySystemTheme();
        systemThemeQuery.addEventListener('change', applySystemTheme);
        if (themeToggleBtn) {
            themeToggleBtn.classList.add('disabled-btn');
            themeToggleBtn.title = (window.i18n ? window.i18n.t('Otomatik tema aktifken manuel değiştirme kapalı') : 'Otomatik tema aktifken manuel değiştirme kapalı');
        }
    } else {
        systemThemeQuery.removeEventListener('change', applySystemTheme);
        if (themeToggleBtn) {
            themeToggleBtn.classList.remove('disabled-btn');
            themeToggleBtn.title = (window.i18n ? window.i18n.t('Tema Değiştir') : 'Tema Değiştir');
        }
    }
}

function saveUserData() {
    if (currentUser) {
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        localStorage.setItem('joinedRooms', JSON.stringify(Array.from(joinedRooms)));
        localStorage.setItem('userProfile', JSON.stringify(userProfile));
        // joinedRooms değişti (giriş, odaya katılma, sunucu senkronu): oda önbelleğini de yaz.
        // Eskiden sadece 'rooms' ağacı değişince yazılıyordu, girişten sonra hiç yazılmayabiliyordu.
        cacheRoomsForOffline();
    }
}

// Katılınan tek bir odayı sunucuda (hesaba bağlı) kalıcı hale getirir.
function persistJoinedRoomToServer(roomId) {
    if (currentUser && currentUser.uid) {
        database.ref(`users/${currentUser.uid}/joinedRooms/${roomId}`).set(true);
    }
}

// Bir odadan ayrılma/silinme durumunda sunucudaki kaydı da temizler.
function removeJoinedRoomFromServer(roomId) {
    if (currentUser && currentUser.uid) {
        database.ref(`users/${currentUser.uid}/joinedRooms/${roomId}`).remove();
    }
}

function loadUserData() {
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        const savedRooms = localStorage.getItem('joinedRooms');
        if (savedRooms) {
            joinedRooms = new Set(JSON.parse(savedRooms));
        }
        const savedProfile = localStorage.getItem('userProfile');
        if (savedProfile) {
            userProfile = JSON.parse(savedProfile);
        }
        return true;
    }
    return false;
}

function clearUserData() {
    if (window.QTCache) QTCache.clearAll(); // çıkış yapınca cihazdaki mesaj önbelleği de silinsin
    localStorage.removeItem('currentUser');
    localStorage.removeItem('joinedRooms');
    localStorage.removeItem('userProfile');
}

// Bir hesabın katıldığı odaları Firebase'den çekip yerel joinedRooms setine ekler.
// localStorage tek bir global anahtar olduğu için, başka bir hesapla giriş
// yapıldığında önceki hesabın (ya da hiçbir şeyin) odaları görünüyordu.
// Bu fonksiyon, giriş yapan hesabın gerçek oda listesini sunucudan tazeler.
function syncJoinedRoomsFromServer() {
    if (!currentUser || !currentUser.uid) return Promise.resolve();

    return database.ref(`users/${currentUser.uid}/joinedRooms`).once('value').then(snapshot => {
        const serverRooms = snapshot.val() || {};
        Object.keys(serverRooms).forEach(roomId => joinedRooms.add(roomId));
        saveUserData();
        updateRoomList();
    }).catch(error => {
        console.error('Oda listesi senkronizasyon hatası:', error);
    });
}

async function uploadProfilePhoto(file) {
    if (!currentUser) return;
    
    showUploadProgress(file.name);
    
    try {
        const uploadResult = await uploadFileToBackend(file, (pct) => updateUploadProgress(Math.round(pct * 0.9)));
        const photoUrl = uploadResult.url;
        updateUploadProgress(95);

        await database.ref(`users/${currentUser.uid}/profilePhoto`).set(photoUrl);
        
        userProfile.profilePhoto = photoUrl;
        saveUserData();
        
        updateUserAvatar(photoUrl);
        
        updateUploadProgress(100);
        setTimeout(() => {
            hideUploadProgress();
            showToast('Başarılı', 'Profil fotoğrafı güncellendi.', 'success');
        }, 500);
        
    } catch (error) {
        hideUploadProgress();
        showToast('Hata', 'Fotoğraf yüklenirken hata oluştu.', 'error');
        console.error('Fotoğraf yükleme hatası:', error);
    }
}

function updateUserAvatar(photoData) {
    const sidebarAvatar = document.getElementById('sidebar-avatar');
    const profileAvatar = document.getElementById('profile-avatar-large');
    
    if (!sidebarAvatar || !profileAvatar) return;
    
    if (photoData) {
        sidebarAvatar.style.backgroundImage = `url(${photoData})`;
        sidebarAvatar.textContent = '';
        
        profileAvatar.style.backgroundImage = `url(${photoData})`;
        profileAvatar.textContent = '';
    } else {
        sidebarAvatar.style.backgroundImage = '';
        sidebarAvatar.textContent = currentUser.username.charAt(0).toUpperCase();
        
        profileAvatar.style.backgroundImage = '';
        profileAvatar.textContent = currentUser.username.charAt(0).toUpperCase();
    }
    
    const chatAvatar = document.getElementById('chat-avatar');
    if (!chatAvatar) return;
    
    if (isDmChat && selectedRoomId) {
        const otherUserId = currentDmOtherUserId || selectedRoomId.split('_').find(uid => uid !== currentUser.uid);
        if (otherUserId && allUsers[otherUserId] && allUsers[otherUserId].profilePhoto) {
            chatAvatar.style.backgroundImage = `url(${allUsers[otherUserId].profilePhoto})`;
            chatAvatar.textContent = '';
        } else {
            chatAvatar.style.backgroundImage = '';
            chatAvatar.textContent = document.getElementById('room-title').textContent.charAt(0).toUpperCase();
        }
    } else if (selectedRoomId && rooms[selectedRoomId]) {
        chatAvatar.style.backgroundImage = '';
        chatAvatar.textContent = rooms[selectedRoomId].name.charAt(0).toUpperCase();
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileIcon(fileType, fileName) {
    if (!fileType && fileName) {
        const ext = fileName.split('.').pop().toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) return '🖼️';
        if (ext === 'pdf') return '📄';
        if (['doc', 'docx'].includes(ext)) return '📝';
        if (['xls', 'xlsx'].includes(ext)) return '📊';
        if (['zip', 'rar', '7z'].includes(ext)) return '📦';
        if (['mp3', 'wav', 'ogg'].includes(ext)) return '🎵';
        if (['mp4', 'avi', 'mov', 'mkv', 'webm'].includes(ext)) return '🎬';
        return '📎';
    }
    
    if (fileType && fileType.includes('image/')) return '🖼️';
    if (fileType && fileType.includes('pdf')) return '📄';
    if (fileType && (fileType.includes('word') || fileType.includes('doc'))) return '📝';
    if (fileType && (fileType.includes('excel') || fileType.includes('xls'))) return '📊';
    if (fileType && (fileType.includes('zip') || fileType.includes('rar'))) return '📦';
    if (fileType && fileType.includes('audio/')) return '🎵';
    if (fileType && fileType.includes('video/')) return '🎬';
    return '📎';
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

function loadProfileSettings() {
    if (currentUser) {
        database.ref(`users/${currentUser.uid}`).once('value').then(snapshot => {
            const userData = snapshot.val();
            if (userData) {
                if (userData.profilePhoto) {
                    userProfile.profilePhoto = userData.profilePhoto;
                    updateUserAvatar(userData.profilePhoto);
                }
                
                if (userData.bio) {
                    userProfile.bio = userData.bio;
                }
                
                if (userData.role) {
                    userProfile.role = userData.role;
                    updateUserRoleBadge();
                }
                
                if (userData.settings) {
                    userProfile.settings = { ...userProfile.settings, ...userData.settings };
                }
                
                saveUserData();
            }
            updateAutoThemeState();
            applyCompactMode();
            updateProfileModal();
        });
    }
}

function updateProfileModal() {
    document.getElementById('profile-username').textContent = currentUser.username;
    document.getElementById('profile-username-input').value = currentUser.username;
    document.getElementById('profile-bio-input').value = userProfile.bio || '';
    
    const profileAvatar = document.getElementById('profile-avatar-large');
    if (userProfile.profilePhoto) {
        profileAvatar.style.backgroundImage = `url(${userProfile.profilePhoto})`;
        profileAvatar.textContent = '';
    } else {
        profileAvatar.style.backgroundImage = '';
        profileAvatar.textContent = currentUser.username.charAt(0).toUpperCase();
    }
}

function loadAppSettings() {
    document.getElementById('enter-to-send').checked = userProfile.settings.enterToSend;
    document.getElementById('show-read-receipts').checked = userProfile.settings.showReadReceipts;
    document.getElementById('auto-translate').checked = userProfile.settings.autoTranslate;
    document.getElementById('message-notifications').checked = userProfile.settings.messageNotifications;
    document.getElementById('sound-notifications').checked = userProfile.settings.soundNotifications;
    document.getElementById('auto-theme-switch').checked = userProfile.settings.autoTheme;
    document.getElementById('compact-mode').checked = userProfile.settings.compactMode;
}

// KOMPAKT MOD - mesaj/oda listelerinde daha az boşluk kullanan sıkışık görünüm
function applyCompactMode() {
    document.body.classList.toggle('compact-mode', !!userProfile.settings.compactMode);
}

function enterRoom(roomId) {
    const room = rooms[roomId];
    if (!room) {
        showToast('Hata', 'Oda bulunamadı.', 'error');
        return;
    }
    
    if (room.bannedUsers && currentUser && room.bannedUsers[currentUser.uid]) {
        showToast('Hata', 'Bu odaya erişiminiz kısıtlanmış.', 'error');
        return;
    }
    
    selectedRoomId = roomId;
    isDmChat = false;
    
    const hasJoined = joinedRooms.has(roomId);
    
    if (room.password && !hasJoined) {
        showJoinRoomModal(room);
    } else {
        joinRoom(room);
    }
    
    if (window.innerWidth <= 768) {
        showMobileScreen('chat');
    }
}

function updateRoomList() {
    const sidebarRoomsList = document.getElementById('sidebar-rooms-list');
    sidebarRoomsList.innerHTML = '';
    
    let hasRooms = false;
    
    if (window.currentDMList && window.currentDMList.length > 0) {
        window.currentDMList.forEach(dm => {
            if (!dm || !dm.name) {
                console.error('[UYARI] İsmi olmayan/bozuk DM kaydı atlandı:', dm);
                return;
            }
            hasRooms = true;
            
            const roomItem = document.createElement('div');
            roomItem.className = 'room-item dm';
            roomItem.dataset.roomId = dm.id;
            
            const avatarLetter = dm.name.charAt(0).toUpperCase();
            const dmUser = allUsers && allUsers[dm.userId];
            const dmPhoto = dmUser && dmUser.profilePhoto;
            const dmAvatarStyle = dmPhoto
                ? `style="background-image: url(${dmPhoto}); background-size: cover; background-position: center;"`
                : '';

            roomItem.innerHTML = `
                <div class="room-avatar" ${dmAvatarStyle}>${dmPhoto ? '' : avatarLetter}</div>
                <div class="room-info">
                    <div class="room-header">
                        <div class="room-name">${dm.name}</div>
                    </div>
                    <div class="room-last-message">${dm.lastMessage || 'Özel Mesaj'}</div>
                </div>
            `;
            
            roomItem.onclick = () => {
                document.querySelectorAll('.room-item').forEach(item => item.classList.remove('active'));
                roomItem.classList.add('active');
                startDM(dm.userId, dm.name);
            };
            
            sidebarRoomsList.appendChild(roomItem);
        });
    }
    
    for (const roomId in rooms) {
        const room = rooms[roomId];
        const hasJoined = joinedRooms.has(roomId);
        
        // WhatsApp mantığı: sadece katıldığımız/konuştuğumuz odalar sidebar'da görünür.
        // Katılınmamış odalar (herkese açık dahil) yalnızca arama kutusuyla bulunur.
        if (!hasJoined) continue;
        
        // Bozuk/isimsiz oda kaydı (name alanı olmayan) tüm listeyi çökertip
        // sonraki odaların render edilmesini engelliyordu. Böyle bir kayıt
        // varsa atla, listenin geri kalanı yine de görünsün.
        if (!room || !room.name) {
            console.error('[UYARI] İsmi olmayan/bozuk oda kaydı atlandı:', roomId, room);
            continue;
        }
        
        hasRooms = true;
        
        const roomItem = document.createElement('div');
        roomItem.className = 'room-item';
        if (room.isDM) roomItem.classList.add('dm');
        if (room.isPrivate) roomItem.classList.add('private-room');
        
        if (room.invited || room.createdBy === 'invite') {
            roomItem.classList.add('invited-room');
        }
        
        roomItem.dataset.roomId = roomId;
        
        const avatarLetter = room.name.charAt(0).toUpperCase();
        const roomAvatarStyle = getRoomAvatarStyle(room);
        const lockIcon = room.password ? ' <span class="room-lock"><i class="fas fa-lock"></i></span>' : '';
        
        const lastMessage = hasJoined ? (roomLastMessages[roomId] || (window.i18n ? window.i18n.t("Henüz mesaj yok") : "Henüz mesaj yok")) : (room.isPrivate ? (window.i18n ? window.i18n.t("Özel Oda") : "Özel Oda") : (window.i18n ? window.i18n.t("Sohbet Odası") : "Sohbet Odası"));
        
        let displayMessage = lastMessage;
        if (room.invited || room.createdBy === 'invite') {
            displayMessage = '<span style="color: var(--invite-color); font-weight: 500;"><i class="fas fa-link"></i> Davet ile katıldınız</span>';
        }
        
        roomItem.innerHTML = `
            <div class="room-avatar" ${roomAvatarStyle}>${room.logo ? '' : avatarLetter}</div>
            <div class="room-info">
                <div class="room-header">
                    <div class="room-name">${room.name}${lockIcon}</div>
                </div>
                <div class="room-last-message">${displayMessage}</div>
            </div>
        `;
        
        roomItem.onclick = () => {
            document.querySelectorAll('.room-item').forEach(item => item.classList.remove('active'));
            roomItem.classList.add('active');
            enterRoom(roomId);
        };
        
        sidebarRoomsList.appendChild(roomItem);
        
        if (hasJoined && !roomNotifyListenerAttached.has(roomId)) {
            roomNotifyListenerAttached.add(roomId);
            listenToRoomLastMessage(roomId);
        }
    }
    
    if (!hasRooms && (!window.currentDMList || window.currentDMList.length === 0)) {
        const emptyMessage = document.createElement('div');
        emptyMessage.style.textAlign = 'center';
        emptyMessage.style.padding = '20px';
        emptyMessage.style.color = 'var(--text-color)';
        emptyMessage.style.opacity = '0.7';
        emptyMessage.textContent = (window.i18n ? window.i18n.t('Henüz bir sohbetiniz yok. Yeni oda oluşturun veya üstteki arama kutusuyla oda/kullanıcı arayın.') : 'Henüz bir sohbetiniz yok. Yeni oda oluşturun veya üstteki arama kutusuyla oda/kullanıcı arayın.');
        sidebarRoomsList.appendChild(emptyMessage);
    }
}

function listenToRoomLastMessage(roomId) {
    const query = database.ref(`rooms/${roomId}/messages`).limitToLast(1);
    if (roomNotifyHandles[roomId]) return; // çift bağlamayı önle

    const cb = (snapshot) => {
        const messages = snapshot.val();
        roomNotifyInitialized.add(roomId);

        if (!messages) {
            // Son mesaj silindi / oda boş: önizlemeyi de anında güncelle
            roomLastMessages[roomId] = (window.i18n ? window.i18n.t("Henüz mesaj yok") : "Henüz mesaj yok");
            updateRoomItemLastMessage(roomId, roomLastMessages[roomId]);
            return;
        }

        const lastMsgKey = Object.keys(messages)[0];
        const lastMsg = messages[lastMsgKey];
        if (!lastMsg) return;

        const lastMessageText = buildMessagePreviewText(lastMsg);
        roomLastMessages[roomId] = `${lastMsg.sender}: ${lastMessageText}`;
        updateRoomItemLastMessage(roomId, roomLastMessages[roomId]);

        // Çıkılmış / silinmiş odalar için zil bildirimi üretme
        if (!currentUser || !joinedRooms.has(roomId)) return;
        const room = rooms[roomId];
        handleBellForMessage(roomId, lastMsgKey, lastMsg, {
            id: roomId,
            isDM: false,
            name: (room && room.name) ? room.name : 'Sohbet Odası',
            sender: lastMsg.sender,
            text: lastMessageText
        });
    };

    roomNotifyHandles[roomId] = { query, cb };
    query.on('value', cb);
}

function updateRoomItemLastMessage(roomId, lastMessage) {
    const roomItem = document.querySelector(`.room-item[data-room-id="${roomId}"]`);
    if (roomItem) {
        const lastMessageEl = roomItem.querySelector('.room-last-message');
        if (lastMessageEl) {
            if (!roomItem.classList.contains('invited-room')) {
                lastMessageEl.textContent = lastMessage;
            }
        }
    }
}

function showJoinRoomModal(room) {
    document.getElementById('join-room-name-text').textContent = (window.i18n ? window.i18n.t(`"${room.name}" odasına katılmak için şifre girin:`) : `"${room.name}" odasına katılmak için şifre girin:`);
    showModal('join-room-modal');
    
    setTimeout(() => {
        document.getElementById('join-room-password-input').focus();
    }, 300);
}

function joinRoomByInviteUrlAndShow(inviteUrl) {
    const roomInfo = extractRoomIdAndNameFromUrl(inviteUrl);
    
    if (!roomInfo) {
        showToast('Hata', 'Geçersiz davet URL\'si.', 'error');
        return;
    }
    
    const roomId = roomInfo.id;
    const roomName = roomInfo.originalName;
    
    showToast('Davet', `${roomName} odasına davet edildiniz!`, 'info');
    
    if (rooms[roomId]) {
        selectedRoomId = roomId;
        const room = rooms[roomId];
        
        if (!document.querySelector(`.room-item[data-room-id="${roomId}"]`)) {
            addRoomToSidebar(roomId, roomName, room, true);
        }
        
        if (room.isPrivate) {
            if (room.password && !joinedRooms.has(roomId)) {
                showJoinRoomModal(room);
            } else {
                joinRoom(room);
                showToast('Başarılı', `${roomName} odasına katıldınız!`, 'success');
            }
        } else {
            joinRoom(room);
            showToast('Başarılı', `${roomName} odasına katıldınız!`, 'success');
        }
    } else {
        const tempRoom = {
            name: roomName,
            isPrivate: true,
            password: null,
            createdBy: 'invite',
            invited: true
        };
        
        rooms[roomId] = tempRoom;
        addRoomToSidebar(roomId, roomName, tempRoom, true);
        selectedRoomId = roomId;
        showJoinRoomModal(tempRoom);
    }
}

function addRoomToSidebar(roomId, roomName, room, isInvited = true) {
    const existingItem = document.querySelector(`.room-item[data-room-id="${roomId}"]`);
    if (existingItem) {
        existingItem.classList.add('active', 'invited-room');
        return;
    }
    
    const sidebarRoomsList = document.getElementById('sidebar-rooms-list');
    
    const roomItem = document.createElement('div');
    roomItem.className = 'room-item active';
    roomItem.classList.add('invited-room');
    
    if (room.isDM) roomItem.classList.add('dm');
    if (room.isPrivate) roomItem.classList.add('private-room');
    roomItem.dataset.roomId = roomId;
    
    const avatarLetter = roomName.charAt(0).toUpperCase();
    const roomAvatarStyle = room.logo ? `background-image: url(${room.logo}); background-size: cover; background-position: center;` : `background-color: ${room.isPrivate ? 'var(--private-color)' : 'var(--primary-color)'};`;
    
    roomItem.innerHTML = `
        <div class="room-avatar" style="${roomAvatarStyle}">
            ${room.logo ? '' : avatarLetter}
        </div>
        <div class="room-info">
            <div class="room-header">
                <div class="room-name">
                    ${roomName}
                </div>
                <div style="font-size: 10px; color: var(--invite-color); background: rgba(156, 39, 176, 0.2); padding: 2px 6px; border-radius: 10px;">
                    DAVET
                </div>
            </div>
            <div class="room-last-message">
                <span style="color: var(--invite-color); font-weight: 500;">
                    <i class="fas fa-link"></i> Davet ile katıldınız
                </span>
            </div>
        </div>
    `;
    
    roomItem.onclick = () => {
        document.querySelectorAll('.room-item').forEach(item => item.classList.remove('active'));
        roomItem.classList.add('active');
        enterRoom(roomId);
    };
    
    sidebarRoomsList.insertBefore(roomItem, sidebarRoomsList.firstChild);
    
    setTimeout(() => {
        roomItem.style.transform = 'scale(1.02)';
        roomItem.style.boxShadow = '0 4px 12px rgba(156, 39, 176, 0.3)';
        setTimeout(() => {
            roomItem.style.transform = 'scale(1)';
            roomItem.style.boxShadow = 'none';
        }, 300);
    }, 100);
    
    joinedRooms.add(roomId);
    saveUserData();
    persistJoinedRoomToServer(roomId);
}

function startDM(userId, username) {
    const dmId = [currentUser.uid, userId].sort().join('_');
    isDmChat = true;
    currentDmOtherUserId = userId;
    selectedRoomId = dmId;
    
    const dmRoom = {
        name: username,
        isDM: true,
        hasJoined: true,
        userId: userId
    };
    
    document.getElementById('search-results').classList.remove('active');
    document.getElementById('search-input').value = '';
    
    setupChatScreen(dmRoom);
    
    document.getElementById('dm-indicator').classList.remove('hidden');
    
    showToast('Özel Mesaj', `${username} ile özel mesajlaşma başlatıldı`, 'info');
    
    listenToDMMessages(dmId);
    
    if (window.innerWidth <= 768) {
        showMobileScreen('chat');
    }
}

// DÜZELTİLMİŞ MESAJ DİNLEME - TEKRAR SORUNU ÇÖZÜLDÜ
function listenToDMMessages(dmId) {
    detachMessageListeners();
    
    const path = `privateMessages/${dmId}/messages`;
    messagesRef = database.ref(path);
    const chatCacheKey = 'dm:' + dmId;
    
    // Mesaj ID'lerini takip etmek için Set
    processedMessageIds.clear();
    isInitialLoad = true;

    document.getElementById('messages-container').innerHTML = '';
    lastMessageDate = null;
    cancelReply();
    cancelEdit();
    exitSelectionMode();
    listenToPinnedMessage();

    // Sadece child_added ile dinle, once kullanma
    attachMessageListener(messagesRef.limitToLast(50), 'child_added', (childSnapshot) => {
        const key = childSnapshot.key;
        const msg = childSnapshot.val();
        
        // Aynı mesajı iki kez eklemeyi engelle
        if (processedMessageIds.has(key)) {
            return;
        }
        
        processedMessageIds.add(key);
        if (window.QTCache) QTCache.saveMessage(chatCacheKey, key, msg);
        
        // Eğer mesaj zaten DOM'da varsa ekleme
        if (document.querySelector(`.message-wrapper[data-message-id='${key}']`)) {
            return;
        }
        
        if (msg.senderUid !== currentUser.uid) {
            if (!isWindowVisible) {
                showNotification(msg.sender, msg.text || 'Yeni mesaj');
            }
            if (!isInitialLoad) {
                playMessageReceivedSound();
            }
        }
        
        appendMessage(key, msg, isInitialLoad);
        
        if (msg.senderUid !== currentUser.uid) {
            updateDMReadStatus(key, dmId);
        }
    });

    // child_changed ile mesaj düzenlemelerini canlı yansıt
    attachMessageListener(messagesRef, 'child_changed', (childSnapshot) => {
        if (window.QTCache) QTCache.saveMessage(chatCacheKey, childSnapshot.key, childSnapshot.val());
        updateMessageDomAfterEdit(childSnapshot.key, childSnapshot.val());
    });
    
    // İlk yükleme tamamlandı
    setTimeout(() => {
        isInitialLoad = false;
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }, 500);

    showCachedMessages(chatCacheKey, dmId);
}

// DÜZELTİLMİŞ ODA MESAJ DİNLEME - TEKRAR SORUNU ÇÖZÜLDÜ
function listenToRoomMessages() {
    if (!selectedRoomId || isDmChat) return;

    const path = `rooms/${selectedRoomId}/messages`;
    const chatCacheKey = 'room:' + selectedRoomId;
    const chatCacheId = selectedRoomId;
    
    detachMessageListeners();
    messagesRef = database.ref(path);
    
    // Mesaj ID'lerini takip etmek için Set
    processedMessageIds.clear();
    isInitialLoad = true;

    document.getElementById('messages-container').innerHTML = '';
    lastMessageDate = null;
    cancelReply();
    cancelEdit();
    exitSelectionMode();
    listenToPinnedMessage();

    // Sadece child_added ile dinle
    attachMessageListener(messagesRef.limitToLast(50), 'child_added', (childSnapshot) => {
        const key = childSnapshot.key;
        const msg = childSnapshot.val();
        
        // Aynı mesajı iki kez eklemeyi engelle
        if (processedMessageIds.has(key)) {
            return;
        }
        
        processedMessageIds.add(key);
        if (window.QTCache) QTCache.saveMessage(chatCacheKey, key, msg);
        
        // Eğer mesaj zaten DOM'da varsa ekleme
        if (document.querySelector(`.message-wrapper[data-message-id='${key}']`)) {
            return;
        }
        
        if (msg.senderUid !== currentUser.uid) {
            if (!isWindowVisible) {
                showNotification(msg.sender, msg.text || 'Yeni mesaj', selectedRoomId);
            }
            if (!isInitialLoad) {
                playMessageReceivedSound();
            }
        }
        
        appendMessage(key, msg, isInitialLoad);
        
        if (msg.senderUid !== currentUser.uid) {
            database.ref(`${path}/${key}`).transaction((message) => {
                if (message) {
                    if (!message.readBy) message.readBy = {};
                    message.readBy[currentUser.uid] = true;
                }
                return message;
            });
        }
    });

    // child_changed ile mesaj düzenlemelerini canlı yansıt
    attachMessageListener(messagesRef, 'child_changed', (childSnapshot) => {
        if (window.QTCache) QTCache.saveMessage(chatCacheKey, childSnapshot.key, childSnapshot.val());
        updateMessageDomAfterEdit(childSnapshot.key, childSnapshot.val());
    });

    // child_removed için dinleme
    attachMessageListener(messagesRef, 'child_removed', (childSnapshot) => {
        const key = childSnapshot.key;
        if (window.QTCache) QTCache.removeMessage(chatCacheKey, key);
        const existingMsg = document.querySelector(`.message-wrapper[data-message-id='${key}']`);
        if (existingMsg) {
            existingMsg.remove();
        }
        
        // Silinen mesajı processedSet'ten çıkar
        processedMessageIds.delete(key);
        updateRoomLastMessages(selectedRoomId);
    });
    
    // İlk yükleme tamamlandı
    setTimeout(() => {
        isInitialLoad = false;
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }, 500);

    showCachedMessages(chatCacheKey, chatCacheId);
}

function updateDMReadStatus(msgId, dmId) {
    database.ref(`privateMessages/${dmId}/messages/${msgId}`).transaction((message) => {
        if (message) {
            if (!message.readBy) message.readBy = {};
            message.readBy[currentUser.uid] = true;
        }
        return message;
    });
}

function setupChatScreen(room) {
    document.getElementById('empty-chat').classList.add('hidden');
    
    document.getElementById('chat-header').classList.remove('hidden');
    document.getElementById('messages-container').classList.remove('hidden');
    document.getElementById('typing-indicator').classList.remove('hidden');
    document.getElementById('message-input-container').classList.remove('hidden');
    
    document.getElementById('room-title').textContent = room.name;
    
    const chatAvatar = document.getElementById('chat-avatar');
    if (room.isDM && room.userId && allUsers[room.userId] && allUsers[room.userId].profilePhoto) {
        chatAvatar.style.backgroundImage = `url(${allUsers[room.userId].profilePhoto})`;
        chatAvatar.textContent = '';
    } else if (room.isDM && selectedRoomId) {
        const otherUserId = currentDmOtherUserId || selectedRoomId.split('_').find(uid => uid !== currentUser.uid);
        if (otherUserId && allUsers[otherUserId] && allUsers[otherUserId].profilePhoto) {
            chatAvatar.style.backgroundImage = `url(${allUsers[otherUserId].profilePhoto})`;
            chatAvatar.textContent = '';
        } else {
            chatAvatar.style.backgroundImage = '';
            chatAvatar.textContent = room.name.charAt(0).toUpperCase();
        }
    } else {
        chatAvatar.style.backgroundImage = room.logo ? `url(${room.logo})` : '';
        chatAvatar.textContent = room.logo ? '' : room.name.charAt(0).toUpperCase();
    }
    
    if (room.isDM) {
        document.getElementById('dm-indicator').classList.remove('hidden');
        document.getElementById('online-count-btn').style.display = 'none';
    } else {
        document.getElementById('dm-indicator').classList.add('hidden');
        document.getElementById('online-count-btn').style.display = 'inline';
    }
    
    document.getElementById('message-input').focus();
}

function showEmptyChat() {
    document.getElementById('empty-chat').classList.remove('hidden');
    document.getElementById('chat-header').classList.add('hidden');
    document.getElementById('messages-container').classList.add('hidden');
    document.getElementById('typing-indicator').classList.add('hidden');
    document.getElementById('message-input-container').classList.add('hidden');
    
    selectedRoomId = null;
    isDmChat = false;
    
    detachMessageListeners();
    if (roomUsersRef) roomUsersRef.off();
    if (typingRef) typingRef.off();
    if (pinnedMessageRef) { pinnedMessageRef.off(); pinnedMessageRef = null; }
    currentPinnedMessageId = null;
    document.getElementById('pinned-message-banner').classList.add('hidden');
    cancelReply();
    cancelEdit();
    exitSelectionMode();
    if (kickBanRef) {
        kickBanRef.membershipRef.off();
        kickBanRef.banRef.off();
        kickBanRef = null;
    }
    
    // Temizlik
    processedMessageIds.clear();
    
    document.getElementById('dm-indicator').classList.add('hidden');
    document.querySelectorAll('.room-item').forEach(item => item.classList.remove('active'));
    
    if (window.innerWidth <= 768) {
        showMobileScreen('sidebar');
    }
}

function createVoiceMessageElement(msg) {
    const voiceMessage = document.createElement('div');
    voiceMessage.className = 'voice-message';
    
    const voiceIcon = document.createElement('div');
    voiceIcon.className = 'voice-icon';
    voiceIcon.innerHTML = '🎤';
    
    const voiceInfo = document.createElement('div');
    voiceInfo.className = 'voice-info';
    
    const voiceDuration = document.createElement('div');
    voiceDuration.className = 'voice-duration';
    
    const duration = msg.duration || 0;
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    voiceDuration.textContent = `Sesli Mesaj (${minutes}:${seconds.toString().padStart(2, '0')})`;
    
    const voiceSize = document.createElement('div');
    voiceSize.className = 'voice-size';
    voiceSize.textContent = msg.fileSize ? formatFileSize(msg.fileSize) : '';
    
    voiceInfo.appendChild(voiceDuration);
    voiceInfo.appendChild(voiceSize);
    
    const voiceControls = document.createElement('div');
    voiceControls.className = 'voice-controls';
    
    const playButton = document.createElement('button');
    playButton.className = 'voice-play-btn';
    playButton.innerHTML = '<i class="fas fa-play"></i>';
    playButton.title = 'Oynat';
    
    let isPlaying = false;
    let audioElement = null;
    
    playButton.onclick = (e) => {
        e.stopPropagation();
        
        if (!isPlaying) {
            if (!audioElement) {
                audioElement = new Audio(msg.fileData);
            }
            
            audioElement.play();
            playButton.innerHTML = '<i class="fas fa-pause"></i>';
            playButton.title = 'Durdur';
            isPlaying = true;
            
            audioElement.onended = () => {
                playButton.innerHTML = '<i class="fas fa-play"></i>';
                playButton.title = 'Oynat';
                isPlaying = false;
            };
        } else {
            if (audioElement) {
                audioElement.pause();
                playButton.innerHTML = '<i class="fas fa-play"></i>';
                playButton.title = 'Oynat';
                isPlaying = false;
            }
        }
    };
    
    const downloadButton = document.createElement('a');
    downloadButton.className = 'voice-play-btn';
    downloadButton.innerHTML = '<i class="fas fa-download"></i>';
    downloadButton.title = (window.i18n ? window.i18n.t('İndir') : 'İndir');
    downloadButton.style.textDecoration = 'none';
    downloadButton.target = '_blank';
    downloadButton.rel = 'noopener noreferrer';

    const voiceBlobUrl = msg.fileData ? dataURLtoBlobURL(msg.fileData) : null;
    if (voiceBlobUrl) {
        downloadButton.href = voiceBlobUrl;
        downloadButton.download = msg.fileName || 'sesli_mesaj.webm';
    }
    downloadButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        // Uygulama içi WebView'lerde (ör. AppCreator24) <a download>
        // çoğu zaman hiçbir şey yapmaz; bu yüzden linkin varsayılan
        // davranışını durdurup paylaş/indir zincirini kendimiz yürütüyoruz.
        e.preventDefault();
        if (!msg.fileData) return;
        const blob = await dataURLtoBlob(msg.fileData);
        saveOrShareFile(blob, msg.fileName || 'sesli_mesaj.webm');
    });
    
    voiceControls.appendChild(playButton);
    voiceControls.appendChild(downloadButton);
    
    voiceMessage.appendChild(voiceIcon);
    voiceMessage.appendChild(voiceInfo);
    voiceMessage.appendChild(voiceControls);
    
    return voiceMessage;
}

function createVideoMessageElement(msg) {
    const videoMessage = document.createElement('div');
    videoMessage.className = 'video-message';
    
    const videoContainer = document.createElement('div');
    videoContainer.style.position = 'relative';
    
    const video = document.createElement('video');
    video.src = msg.fileData;
    video.style.width = '100%';
    video.style.height = 'auto';
    video.style.maxHeight = '300px';
    video.style.borderRadius = '8px';
    video.controls = true;
    video.preload = 'metadata';
    
    const videoIcon = document.createElement('div');
    videoIcon.className = 'video-icon';
    videoIcon.innerHTML = '<i class="fas fa-play-circle"></i>';
    videoIcon.style.position = 'absolute';
    videoIcon.style.top = '50%';
    videoIcon.style.left = '50%';
    videoIcon.style.transform = 'translate(-50%, -50%)';
    videoIcon.style.fontSize = '40px';
    videoIcon.style.color = 'var(--video-color)';
    videoIcon.style.opacity = '0.8';
    videoIcon.style.background = 'rgba(0, 0, 0, 0.5)';
    videoIcon.style.borderRadius = '50%';
    videoIcon.style.padding = '10px';
    videoIcon.style.cursor = 'pointer';
    
    videoIcon.onclick = (e) => {
        e.stopPropagation();
        if (video.paused) {
            video.play();
            videoIcon.style.display = 'none';
        } else {
            video.pause();
        }
    };
    
    video.onplay = () => {
        videoIcon.style.display = 'none';
    };
    
    video.onpause = () => {
        videoIcon.style.display = 'block';
    };
    
    videoContainer.appendChild(video);
    videoContainer.appendChild(videoIcon);
    videoMessage.appendChild(videoContainer);
    
    if (msg.caption && msg.caption.trim()) {
        const caption = document.createElement('div');
        caption.className = 'video-caption';
        caption.style.padding = '8px 12px';
        caption.style.background = 'rgba(0, 0, 0, 0.1)';
        caption.style.borderRadius = '0 0 8px 8px';
        caption.style.fontSize = '13px';
        caption.style.color = 'var(--text-color)';
        caption.style.opacity = '0.9';
        caption.textContent = msg.caption;
        videoMessage.appendChild(caption);
    }
    
    videoMessage.style.cursor = 'pointer';
    videoMessage.onclick = () => {
        video.pause();
        openMediaLightbox({
            type: 'video',
            src: msg.fileData,
            fileName: msg.fileName || 'video.mp4',
            caption: msg.caption
        });
    };
    
    return videoMessage;
}

function createImageMessageElement(msg) {
    const imageMessage = document.createElement('div');
    imageMessage.className = 'image-message';
    
    const img = document.createElement('img');
    img.src = msg.imageData || msg.fileData;
    img.alt = msg.fileName || 'Resim';
    img.style.cursor = 'pointer';
    img.onclick = () => {
        if (msg.imageData || msg.fileData) {
            openMediaLightbox({
                type: 'image',
                src: msg.imageData || msg.fileData,
                fileName: msg.fileName || 'resim.jpg',
                caption: msg.caption
            });
        }
    };
    
    imageMessage.appendChild(img);
    
    if (msg.caption && msg.caption.trim()) {
        const caption = document.createElement('div');
        caption.className = 'image-caption';
        caption.style.padding = '8px 12px';
        caption.style.background = 'rgba(0, 0, 0, 0.1)';
        caption.style.borderRadius = '0 0 8px 8px';
        caption.style.fontSize = '13px';
        caption.style.color = 'var(--text-color)';
        caption.style.opacity = '0.9';
        caption.textContent = msg.caption;
        imageMessage.appendChild(caption);
    }
    
    return imageMessage;
}

// NOT: Dosyalar artık Firebase'e base64 "data:" URL olarak değil, kendi
// backend sunucumuza yükleniyor ve mesajda sadece sunucu URL'i (örn.
// "/uploads/xxxx.png") tutuluyor. Bu yüzden aşağıdaki iki fonksiyon hem
// eski base64 "data:" URL'lerini (geriye dönük uyumluluk) hem de yeni
// düz sunucu URL'lerini destekleyecek şekilde ayrı ayrı ele alınıyor.
// Eski sürümden kalan base64 "data:" URL'leri bazen bozuk/eksik geliyor
// (boşluk/satır sonu karışmış, yanlışlıkla URI-encode edilmiş ya da Firebase'e
// yazılırken kesilmiş olabiliyor). atob() bunlara çok toleranssız davranıp
// direkt hata fırlatıyor. Bu fonksiyon elden geldiğince temizleyip kurtarmaya
// çalışıyor; gerçekten kurtarılamıyorsa null döndürüyor (hata fırlatmıyor).
function sanitizeBase64(str) {
    if (!str) return null;
    let cleaned = String(str).replace(/\s/g, '');
    if (/%[0-9A-Fa-f]{2}/.test(cleaned)) {
        try { cleaned = decodeURIComponent(cleaned); } catch (e) { /* yoksay, olduğu gibi devam */ }
    }
    // Boşluk temizleme ve padding düzeltmesi güvenli "kozmetik" onarımlardır.
    // Ama içerikte base64 alfabesi dışında karakter varsa bu gerçek bir
    // bozulmadır - o karakterleri sessizce silip "kurtarmaya" çalışmak
    // farklı bir dosyaya dönüşen çöp veri üretebilir. Böyle durumda
    // kurtarmayı reddediyoruz (null) ki kullanıcı temiz bir hata görsün,
    // bozuk/yanlış bir dosya indirmesin.
    if (!/^[A-Za-z0-9+/]*=*$/.test(cleaned)) {
        return null;
    }
    const remainder = cleaned.length % 4;
    if (remainder > 0) {
        cleaned += '='.repeat((4 - remainder) % 4);
    }
    return cleaned;
}

function safeAtobToBytes(base64Data) {
    const cleaned = sanitizeBase64(base64Data);
    if (cleaned === null || cleaned === '') return null;
    try {
        const binary = atob(cleaned);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    } catch (err) {
        // Temizlemeye rağmen çözülemedi - kayıt gerçekten kurtarılamaz derecede bozuk.
        return null;
    }
}

// Bu URL'lerin bozuk/kurtarılamaz olduğunu bir kere loglayıp bir daha aynı
// hatayı konsola basmamak, tıklanınca da sessizce anlamlı bir uyarı vermek için.
const knownBrokenLegacyFileData = new Set();

function dataURLtoBlobURL(dataUrl) {
    if (!dataUrl) return null;
    if (!dataUrl.startsWith('data:')) {
        // Zaten kullanılabilir bir sunucu URL'i - blob'a çevirmeye gerek yok.
        return dataUrl;
    }
    try {
        const [header, base64Data] = dataUrl.split(',');
        const mimeMatch = header.match(/data:(.*?);base64/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
        const bytes = safeAtobToBytes(base64Data);
        if (!bytes) {
            if (!knownBrokenLegacyFileData.has(dataUrl)) {
                knownBrokenLegacyFileData.add(dataUrl);
                console.warn('Bu mesajın dosya verisi eski formatta ve bozuk, kurtarılamadı (bir kere loglanıyor).');
            }
            return null;
        }
        const blob = new Blob([bytes], { type: mimeType });
        return URL.createObjectURL(blob);
    } catch (err) {
        if (!knownBrokenLegacyFileData.has(dataUrl)) {
            knownBrokenLegacyFileData.add(dataUrl);
            console.error('dataURLtoBlobURL hatası:', err);
        }
        return null;
    }
}

async function dataURLtoBlob(dataUrl) {
    if (!dataUrl) return null;
    try {
        if (!dataUrl.startsWith('data:')) {
            // Sunucudan gelen normal bir URL - dosyayı fetch ile indirip Blob'a çevir.
            const res = await fetch(dataUrl);
            if (!res.ok) throw new Error('Dosya indirilemedi (HTTP ' + res.status + ')');
            return await res.blob();
        }
        const [header, base64Data] = dataUrl.split(',');
        const mimeMatch = header.match(/data:(.*?);base64/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
        const bytes = safeAtobToBytes(base64Data);
        if (!bytes) {
            if (!knownBrokenLegacyFileData.has(dataUrl)) {
                knownBrokenLegacyFileData.add(dataUrl);
                console.warn('Bu mesajın dosya verisi eski formatta ve bozuk, kurtarılamadı (bir kere loglanıyor).');
            }
            return null;
        }
        return new Blob([bytes], { type: mimeType });
    } catch (err) {
        if (!knownBrokenLegacyFileData.has(dataUrl)) {
            knownBrokenLegacyFileData.add(dataUrl);
            console.error('dataURLtoBlob hatası:', err);
        }
        return null;
    }
}

// AppCreator24 gibi paket/WebView uygulamalarda blob: URL'ye tıklamak
// tarayıcının indirme yöneticisini TETİKLEMEZ (WebView bunu ancak gerçek
// bir ağ isteği + Content-Disposition başlığı geldiğinde yakalar; blob:
// bir ağ isteği değildir). Bu yüzden önce cihazın yerel "Paylaş" sayfasını
// açan Web Share API deneniyor (kaydet/paylaş WebView dışına çıkar,
// çoğu sarmalayıcı uygulamada çalışır); o yoksa yeni sekmede blob URL
// açmaya, o da olmazsa klasik <a download> tıklamasına düşülüyor.
async function saveOrShareFile(blob, fileName) {
    if (!blob) {
        showToast('Hata', 'Bu dosya eski/bozuk bir kayıt olduğu için açılamıyor. Dosyayı tekrar göndermeyi deneyin.', 'error');
        return;
    }

    try {
        const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: fileName });
            return;
        }
    } catch (err) {
        // Kullanıcı paylaşım penceresini iptal etmiş olabilir, bu durumda
        // tekrar indirmeye zorlamıyoruz.
        if (err && err.name === 'AbortError') return;
        console.warn('navigator.share başarısız, alternatif deneniyor:', err);
    }

    const url = URL.createObjectURL(blob);
    try {
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        // URL'yi hemen iptal etmek bazı WebView'lerde indirme başlamadan
        // linki geçersiz kılıyordu; kısa bir gecikmeyle serbest bırakılıyor.
        setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
}

// MEDYA ÖNİZLEME (WhatsApp tarzı tam ekran resim/video görüntüleyici)
// Eskiden window.open() ile yeni sekme açılıyordu; bu hem çok sade/çirkin
// görünüyordu hem de AppCreator24 gibi WebView sarmalayıcılarda "geri"
// tuşuyla önizlemeden çıkılamıyordu (yeni sekme uygulamanın kendi geçmişinde
// değil). Bunun yerine uygulama içinde tam ekran bir katman açılıyor ve
// history.pushState ile telefonun fiziksel/gesture geri tuşu da bu katmanı
// kapatacak şekilde yakalanıyor.
let mediaLightboxOpen = false;
let mediaLightboxCurrent = null; // { blob veya null, fileName }

function openMediaLightbox({ type, src, fileName, caption }) {
    if (!src) return;
    const lightbox = document.getElementById('media-lightbox');
    const imgEl = document.getElementById('media-lightbox-img');
    const videoEl = document.getElementById('media-lightbox-video');
    const captionEl = document.getElementById('media-lightbox-caption');
    const filenameEl = document.getElementById('media-lightbox-filename');

    videoEl.pause();
    videoEl.removeAttribute('src');
    videoEl.load();
    imgEl.src = '';

    if (type === 'video') {
        videoEl.src = src;
        videoEl.classList.remove('hidden');
        imgEl.classList.add('hidden');
    } else {
        imgEl.src = src;
        imgEl.classList.remove('hidden');
        videoEl.classList.add('hidden');
    }

    captionEl.textContent = caption || '';
    filenameEl.textContent = fileName || '';
    mediaLightboxCurrent = { type, src, fileName };

    lightbox.classList.remove('hidden');

    if (!mediaLightboxOpen) {
        mediaLightboxOpen = true;
        history.pushState({ mediaLightbox: true }, '');
    }
}

function closeMediaLightbox(fromPopstate) {
    const lightbox = document.getElementById('media-lightbox');
    if (lightbox.classList.contains('hidden')) return;

    const videoEl = document.getElementById('media-lightbox-video');
    videoEl.pause();

    lightbox.classList.add('hidden');
    mediaLightboxCurrent = null;

    if (mediaLightboxOpen) {
        mediaLightboxOpen = false;
        if (!fromPopstate) history.back();
    }
}

window.addEventListener('popstate', () => {
    if (mediaLightboxOpen) closeMediaLightbox(true);
});

document.getElementById('media-lightbox-close-btn').addEventListener('click', () => closeMediaLightbox(false));

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mediaLightboxOpen) closeMediaLightbox(false);
});

document.getElementById('media-lightbox-download-btn').addEventListener('click', async () => {
    if (!mediaLightboxCurrent) return;
    const blob = await dataURLtoBlob(mediaLightboxCurrent.src);
    if (!blob) {
        showToast('Hata', 'Bu dosya eski/bozuk bir kayıt olduğu için indirilemiyor.', 'error');
        return;
    }
    const fallbackName = mediaLightboxCurrent.type === 'video' ? 'video.mp4' : 'resim.jpg';
    saveOrShareFile(blob, mediaLightboxCurrent.fileName || fallbackName);
});

function linkifyToElement(container, text) {
    if (!text) return;
    const urlRegex = /((?:https?:\/\/|www\.)[^\s<>"]+)/gi;
    let lastIndex = 0;
    let match;
    while ((match = urlRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        let rawUrl = match[0];
        let trailing = '';
        while (rawUrl.length > 0 && /[.,!?;:)\]]$/.test(rawUrl)) {
            trailing = rawUrl.slice(-1) + trailing;
            rawUrl = rawUrl.slice(0, -1);
        }
        const href = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
        const anchor = document.createElement('a');
        anchor.href = href;
        anchor.textContent = rawUrl;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer nofollow';
        anchor.className = 'message-link';
        anchor.onclick = (e) => e.stopPropagation();
        container.appendChild(anchor);
        if (trailing) {
            container.appendChild(document.createTextNode(trailing));
        }
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
        container.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
}

// ================= YANIT (REPLY) ÖZELLİĞİ =================

// Bir mesaj için, alıntı kutusunda gösterilecek kısa önizleme metnini üretir.
function getMessagePreviewText(msg) {
    if (!msg) return '';
    switch (msg.type) {
        case 'image':
            return '📷 ' + (window.i18n ? window.i18n.t('Fotoğraf') : 'Fotoğraf');
        case 'video':
            return '🎥 ' + (window.i18n ? window.i18n.t('Video') : 'Video');
        case 'voice':
            return '🎤 ' + (window.i18n ? window.i18n.t('Sesli mesaj') : 'Sesli mesaj');
        case 'file':
            return '📎 ' + (msg.fileName || (window.i18n ? window.i18n.t('Dosya') : 'Dosya'));
        default:
            return (msg.text || '').trim();
    }
}

// Yanıtlama modunu başlatır: giriş kutusunun üstünde önizleme çubuğunu gösterir.
function startReply(msgId, msg) {
    if (!msg) return;
    cancelEdit();
    replyingTo = {
        id: msgId,
        sender: msg.senderUid === currentUser.uid ? (window.i18n ? window.i18n.t('Siz') : 'Siz') : msg.sender,
        previewText: getMessagePreviewText(msg)
    };

    const bar = document.getElementById('reply-preview-bar');
    bar.classList.remove('edit-mode');
    document.getElementById('reply-preview-icon').innerHTML = '<i class="fas fa-reply"></i>';
    document.getElementById('reply-preview-sender').textContent = replyingTo.sender;
    document.getElementById('reply-preview-text').textContent = replyingTo.previewText || '';
    bar.classList.remove('hidden');

    const input = document.getElementById('message-input');
    if (input) input.focus();
}

// Yanıtlama modunu iptal eder / gönderim sonrası temizler.
function cancelReply() {
    if (editingMessage) return; // düzenleme çubuğu açıkken yanıt çubuğunu ezme
    replyingTo = null;
    const bar = document.getElementById('reply-preview-bar');
    if (bar) bar.classList.add('hidden');
}

// Bir mesajı gönderirken database'e yazılacak replyTo alanını üretir (yoksa null).
function buildReplyPayload() {
    if (!replyingTo) return null;
    return {
        id: replyingTo.id,
        sender: replyingTo.sender,
        previewText: replyingTo.previewText || ''
    };
}

// ================= MESAJ DÜZENLEME (EDIT) =================

// Düzenleme modunu başlatır: giriş kutusuna mevcut metni doldurur, aynı
// çubuğu (reply çubuğuyla ortak) "düzenleniyor" görünümüne çevirir.
function startEdit(msgId, msg) {
    if (!msg || msg.type) {
        showToast('Uyarı', (window.i18n ? window.i18n.t('Sadece metin mesajları düzenlenebilir.') : 'Sadece metin mesajları düzenlenebilir.'), 'error');
        return;
    }
    replyingTo = null;
    editingMessage = { id: msgId };

    const bar = document.getElementById('reply-preview-bar');
    bar.classList.add('edit-mode');
    document.getElementById('reply-preview-icon').innerHTML = '<i class="fas fa-pencil-alt"></i>';
    document.getElementById('reply-preview-sender').textContent = (window.i18n ? window.i18n.t('Mesajı Düzenle') : 'Mesajı Düzenle');
    document.getElementById('reply-preview-text').textContent = msg.text || '';
    bar.classList.remove('hidden');

    const input = document.getElementById('message-input');
    input.value = msg.text || '';
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
    input.focus();
}

// Düzenleme modunu iptal eder.
function cancelEdit() {
    if (!editingMessage) return;
    editingMessage = null;
    const bar = document.getElementById('reply-preview-bar');
    bar.classList.remove('edit-mode');
    document.getElementById('reply-preview-icon').innerHTML = '<i class="fas fa-reply"></i>';
    bar.classList.add('hidden');
}

// Düzenlenen mesajın yeni metnini veritabanına yazar.
async function saveMessageEdit(newText) {
    if (!editingMessage) return;
    const path = isDmChat
        ? `privateMessages/${selectedRoomId}/messages/${editingMessage.id}`
        : `rooms/${selectedRoomId}/messages/${editingMessage.id}`;

    try {
        await database.ref(path).update({
            text: newText,
            edited: true,
            editedAt: firebase.database.ServerValue.TIMESTAMP
        });

        const input = document.getElementById('message-input');
        input.value = '';
        input.style.height = 'auto';
        cancelEdit();
    } catch (error) {
        showToast('Hata', 'Mesaj düzenlenirken bir hata oluştu.', 'error');
        console.error('Mesaj düzenleme hatası:', error);
    }
}

// Başka bir istemcide düzenlenen bir mesaj Firebase'den child_changed ile
// geldiğinde, o mesajı yeniden oluşturmadan (sırasını bozmadan) DOM'da günceller.
function updateMessageDomAfterEdit(msgId, msg) {
    messageCache[msgId] = msg;
    const wrapper = document.querySelector(`.message-wrapper[data-message-id='${msgId}']`);
    if (!wrapper) return;

    if (!msg.type && typeof msg.text === 'string' && msg.text.length > 0) {
        const textEl = wrapper.querySelector('.message-text');
        if (textEl) {
            textEl.innerHTML = '';
            linkifyToElement(textEl, msg.text);
        }
    }

    if (msg.edited) {
        let tag = wrapper.querySelector('.message-edited-tag');
        if (!tag) {
            tag = document.createElement('span');
            tag.className = 'message-edited-tag';
            tag.textContent = (window.i18n ? window.i18n.t('düzenlendi') : 'düzenlendi');
            const meta = wrapper.querySelector('.message-meta');
            if (meta) meta.insertBefore(tag, meta.firstChild);
        }
    }

    // Sabitlenmiş mesajın önizleme metni de güncel kalsın
    if (currentPinnedMessageId === msgId) {
        const path = isDmChat ? `privateMessages/${selectedRoomId}/pinnedMessage` : `rooms/${selectedRoomId}/pinnedMessage`;
        database.ref(path).update({ previewText: getMessagePreviewText(msg) }).catch(() => {});
    }
}

// ================= MESAJ KOPYALAMA =================

function legacyCopyText(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
    } catch (e) {
        // sessizce yut - kopyalama desteklenmiyorsa yapılacak fazla bir şey yok
    }
    document.body.removeChild(ta);
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch (e) {
            // WebView'lerde clipboard API bazen reddedilir - eski yönteme düş
        }
    }
    legacyCopyText(text);
}

// ================= SABİTLENMİŞ MESAJ (PIN) =================

function pinMessage(msgId, msg) {
    const path = isDmChat ? `privateMessages/${selectedRoomId}/pinnedMessage` : `rooms/${selectedRoomId}/pinnedMessage`;
    database.ref(path).set({
        id: msgId,
        sender: msg.senderUid === currentUser.uid ? (window.i18n ? window.i18n.t('Siz') : 'Siz') : msg.sender,
        previewText: getMessagePreviewText(msg),
        pinnedBy: currentUser.username,
        pinnedAt: firebase.database.ServerValue.TIMESTAMP
    }).then(() => {
        showToast('Başarılı', 'Mesaj sabitlendi.', 'success');
    }).catch((error) => {
        showToast('Hata', 'Mesaj sabitlenirken bir hata oluştu.', 'error');
        console.error('Sabitleme hatası:', error);
    });
}

function unpinMessage() {
    const path = isDmChat ? `privateMessages/${selectedRoomId}/pinnedMessage` : `rooms/${selectedRoomId}/pinnedMessage`;
    database.ref(path).remove();
}

// Sabitlenmiş mesaj değiştikçe (veya kaldırılınca) üstteki çubuğu günceller.
function updatePinnedBanner(pinnedData) {
    const banner = document.getElementById('pinned-message-banner');
    if (!banner) return;

    document.querySelectorAll('.message-wrapper.pinned-message').forEach(el => el.classList.remove('pinned-message'));

    if (!pinnedData || !pinnedData.id) {
        currentPinnedMessageId = null;
        banner.classList.add('hidden');
        return;
    }

    currentPinnedMessageId = pinnedData.id;
    document.getElementById('pinned-message-sender').textContent = pinnedData.sender || '';
    document.getElementById('pinned-message-text').textContent = pinnedData.previewText || '';
    banner.classList.remove('hidden');

    const wrapper = document.querySelector(`.message-wrapper[data-message-id='${pinnedData.id}']`);
    if (wrapper) wrapper.classList.add('pinned-message');
}

// Oda/DM değişince (veya bağlantı kesilince) pin dinleyicisini bağlar/temizler.
function listenToPinnedMessage() {
    if (pinnedMessageRef) pinnedMessageRef.off();
    currentPinnedMessageId = null;
    document.getElementById('pinned-message-banner').classList.add('hidden');

    if (!selectedRoomId) return;
    const path = isDmChat ? `privateMessages/${selectedRoomId}/pinnedMessage` : `rooms/${selectedRoomId}/pinnedMessage`;
    pinnedMessageRef = database.ref(path);
    pinnedMessageRef.on('value', (snapshot) => {
        updatePinnedBanner(snapshot.val());
    });
}

// ================= ÇOKLU SEÇİM + TOPLU SİLME/İLETME =================

function enterSelectionMode() {
    if (!selectedRoomId) return;
    cancelReply();
    cancelEdit();
    selectionMode = true;
    selectedMessageIds.clear();
    document.getElementById('messages-container').classList.add('selection-mode');
    document.getElementById('chat-header').classList.add('hidden');
    document.getElementById('selection-toolbar').classList.remove('hidden');
    updateSelectionCount();
}

function exitSelectionMode() {
    selectionMode = false;
    selectedMessageIds.clear();
    document.querySelectorAll('.message-wrapper.selected').forEach(el => el.classList.remove('selected'));
    document.getElementById('messages-container').classList.remove('selection-mode');
    // Sadece aktif bir oda/DM varken header'ı geri göster - yoksa boş sohbet
    // ekranında (odaya girmeden önce) header'ı yanlışlıkla açık bırakmayalım.
    if (selectedRoomId) {
        document.getElementById('chat-header').classList.remove('hidden');
    }
    document.getElementById('selection-toolbar').classList.add('hidden');
}

function toggleMessageSelection(msgId, wrapperEl) {
    if (selectedMessageIds.has(msgId)) {
        selectedMessageIds.delete(msgId);
        wrapperEl.classList.remove('selected');
    } else {
        selectedMessageIds.add(msgId);
        wrapperEl.classList.add('selected');
    }
    updateSelectionCount();
}

function updateSelectionCount() {
    const el = document.getElementById('selection-count');
    if (el) el.textContent = String(selectedMessageIds.size);
}

// ================= SAĞ TIK MESAJ MENÜSÜ (MASAÜSTÜ) =================
// Mesajlar sık/yan yana olduğunda hover butonları üst üste binip
// tıklanamaz hale geldiği için, masaüstünde tüm aksiyonlar (yanıtla,
// kopyala, sabitle, düzenle, sil) tek bir sağ-tık menüsünde toplanır.

function ensureContextMenuElement() {
    let menu = document.getElementById('message-context-menu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'message-context-menu';
        menu.className = 'message-context-menu hidden';
        document.body.appendChild(menu);
    }
    return menu;
}

function hideMessageContextMenu() {
    const menu = document.getElementById('message-context-menu');
    if (menu) menu.classList.add('hidden');
}

function showMessageContextMenu(x, y, msgId, msg, isOwnMessage, align, flipY) {
    // Her zaman en güncel mesaj verisini kullan (msg closure'ı, mesaj
    // düzenlendiğinde bayatlayabiliyor - messageCache child_changed ile
    // sürekli tazeleniyor).
    msg = messageCache[msgId] || msg;

    const menu = ensureContextMenuElement();
    menu.innerHTML = '';

    const addItem = (icon, label, onClick, danger) => {
        const item = document.createElement('div');
        item.className = 'context-menu-item' + (danger ? ' danger' : '');
        item.innerHTML = `<i class="fas ${icon}"></i><span>${label}</span>`;
        item.onclick = (e) => {
            e.stopPropagation();
            hideMessageContextMenu();
            onClick();
        };
        menu.appendChild(item);
    };

    addItem('fa-reply', (window.i18n ? window.i18n.t('Yanıtla') : 'Yanıtla'), () => startReply(msgId, msg));

    if (!msg.type && msg.text) {
        addItem('fa-copy', (window.i18n ? window.i18n.t('Kopyala') : 'Kopyala'), async () => {
            await copyTextToClipboard(msg.text);
            showToast('Başarılı', 'Mesaj kopyalandı.', 'success');
        });
    }

    addItem('fa-thumbtack', (window.i18n ? window.i18n.t('Sabitle') : 'Sabitle'), () => pinMessage(msgId, msg));

    if (isOwnMessage && !msg.type) {
        addItem('fa-pencil-alt', (window.i18n ? window.i18n.t('Düzenle') : 'Düzenle'), () => startEdit(msgId, msg));
    }

    addItem('fa-share', (window.i18n ? window.i18n.t('İlet') : 'İlet'), () => forwardSingleMessage(msgId));

    if (isOwnMessage) {
        addItem('fa-trash', (window.i18n ? window.i18n.t('Bu mesajı sil') : 'Bu mesajı sil'), async () => {
            const result = await customConfirm(
                'Mesajı Sil',
                'Bu mesajı silmek istediğinize emin misiniz?',
                { icon: 'warning', okText: 'Sil', cancelText: 'İptal', okType: 'danger' }
            );
            if (result) deleteMessage(msgId);
        }, true);
    }

    // Önce görünür yap ki gerçek boyutu ölçebilelim, sonra ekran dışına
    // taşmayacak şekilde konumlandır.
    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.classList.remove('hidden');

    const menuRect = menu.getBoundingClientRect();
    // align: 'right' verilirse x, menünün sol değil sağ kenarının hizalanacağı
    // noktadır (kendi mesajlarımız sağda olduğu için menü de sola doğru açılır).
    let left = align === 'right' ? (x - menuRect.width) : x;
    let top = y;
    if (left + menuRect.width > window.innerWidth) left = window.innerWidth - menuRect.width - 8;
    if (left < 8) left = 8;
    // Mesajın altına sığmıyorsa (ekranın en altına yakınsa), flipY verilmişse
    // menüyü mesajın üstüne aç; yoksa ekran içine sıkıştır (sağ tık davranışı).
    if (top + menuRect.height > window.innerHeight - 8) {
        top = (typeof flipY === 'number') ? (flipY - menuRect.height) : (window.innerHeight - menuRect.height - 8);
    }
    if (top < 8) top = 8;

    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
}

document.addEventListener('click', () => hideMessageContextMenu());
document.addEventListener('scroll', () => hideMessageContextMenu(), true);
window.addEventListener('resize', () => hideMessageContextMenu());

// Seçili mesajları (yetkisi olanları) tek onayla toplu siler.
async function bulkDeleteSelectedMessages() {
    if (selectedMessageIds.size === 0) return;

    const idsArray = Array.from(selectedMessageIds);
    const deletable = idsArray.filter(id => {
        const m = messageCache[id];
        return m && (m.senderUid === currentUser.uid || userProfile.role === 'admin');
    });
    const skipped = idsArray.length - deletable.length;

    if (deletable.length === 0) {
        showToast('Uyarı', 'Seçili mesajları silme yetkiniz yok.', 'error');
        return;
    }

    const result = await customConfirm(
        'Mesajları Sil',
        `${deletable.length} mesajı silmek istediğinize emin misiniz?`,
        {
            icon: 'warning',
            okText: 'Sil',
            cancelText: 'İptal',
            okType: 'danger'
        }
    );
    if (!result) return;

    const basePath = isDmChat ? `privateMessages/${selectedRoomId}/messages` : `rooms/${selectedRoomId}/messages`;

    for (const id of deletable) {
        try {
            await database.ref(`${basePath}/${id}`).remove();
        } catch (err) {
            console.error('Toplu silme hatası:', err);
            continue;
        }
        const el = document.querySelector(`.message-wrapper[data-message-id='${id}']`);
        if (el) el.remove();
        delete messageCache[id];
        processedMessageIds.delete(id);
    }

    if (!isDmChat) updateRoomLastMessages(selectedRoomId);

    showToast('Başarılı', `${deletable.length} mesaj silindi.${skipped ? ' ' + skipped + ' mesaj atlandı.' : ''}`, 'success');
    exitSelectionMode();
}

// İletme hedefi olarak, mevcut sohbet hariç katılınmış odaları listeler.
// Sağ tık menüsünden tek bir mesajı iletmek için: seçim moduna girmeden,
// mevcut toplu iletme altyapısını (oda listesi + gönderim) tek mesajla kullanır.
function forwardSingleMessage(msgId) {
    selectedMessageIds = new Set([msgId]);
    populateForwardRoomList();
    showModal('forward-message-modal');
}

function populateForwardRoomList() {
    const container = document.getElementById('forward-room-list');
    container.innerHTML = '';

    const roomTargets = Array.from(joinedRooms)
        .filter(rid => isDmChat || rid !== selectedRoomId)
        .map(rid => ({ id: rid, room: rooms[rid] }))
        .filter(entry => entry.room);

    const userTargets = currentUser
        ? Object.entries(allUsers || {})
            .filter(([uid]) => uid !== currentUser.uid)
            .filter(([uid]) => !isDmChat || [currentUser.uid, uid].sort().join('_') !== selectedRoomId)
        : [];

    if (roomTargets.length === 0 && userTargets.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:12px; text-align:center; opacity:0.7; font-size:13px;';
        empty.textContent = (window.i18n ? window.i18n.t('İletilecek kimse veya oda yok.') : 'İletilecek kimse veya oda yok.');
        container.appendChild(empty);
        return;
    }

    if (roomTargets.length > 0) {
        const header = document.createElement('div');
        header.className = 'forward-list-header';
        header.textContent = (window.i18n ? window.i18n.t('Odalar') : 'Odalar');
        container.appendChild(header);

        roomTargets.forEach(({ id, room }) => {
            const item = document.createElement('div');
            item.className = 'forward-room-item';
            const letter = (room.name || id || '?').charAt(0).toUpperCase();
            const avatarStyle = room.logo
                ? `style="background-image: url(${room.logo}); background-size: cover; background-position: center;"`
                : '';
            item.innerHTML = `<div class="forward-item-avatar" ${avatarStyle}>${room.logo ? '' : letter}</div><span>${room.name || id}</span>`;
            item.onclick = () => forwardSelectedMessagesTo(id, false);
            container.appendChild(item);
        });
    }

    if (userTargets.length > 0) {
        const header = document.createElement('div');
        header.className = 'forward-list-header';
        header.textContent = (window.i18n ? window.i18n.t('Kullanıcılar') : 'Kullanıcılar');
        container.appendChild(header);

        userTargets.forEach(([uid, user]) => {
            const dmId = [currentUser.uid, uid].sort().join('_');
            const item = document.createElement('div');
            item.className = 'forward-room-item';
            const uname = (user && user.username) || uid;
            const letter = uname.charAt(0).toUpperCase();
            const photo = user && user.profilePhoto;
            const avatarStyle = photo
                ? `style="background-image: url(${photo}); background-size: cover; background-position: center;"`
                : '';
            item.innerHTML = `<div class="forward-item-avatar" ${avatarStyle}>${photo ? '' : letter}</div><span>${uname}</span>`;
            item.onclick = () => forwardSelectedMessagesTo(dmId, true);
            container.appendChild(item);
        });
    }
}

// Seçili mesajları hedef odaya/kullanıcıya (DM), gönderen olarak mevcut
// kullanıcıyla, yeni mesajlar halinde kopyalar (orijinal tip/içerik korunur,
// "iletildi" işaretlenir). targetIsDm true ise targetId bir dmId'dir.
async function forwardSelectedMessagesTo(targetId, targetIsDm) {
    const idsArray = Array.from(selectedMessageIds);
    if (idsArray.length === 0) return;

    const path = targetIsDm ? `privateMessages/${targetId}/messages` : `rooms/${targetId}/messages`;
    let successCount = 0;

    for (const id of idsArray) {
        const original = messageCache[id];
        if (!original) continue;

        const payload = {
            sender: currentUser.username,
            senderUid: currentUser.uid,
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            readBy: {},
            forwarded: true
        };
        if (original.type !== undefined) payload.type = original.type;
        if (original.text !== undefined) payload.text = original.text;
        if (original.fileName !== undefined) payload.fileName = original.fileName;
        if (original.fileSize !== undefined) payload.fileSize = original.fileSize;
        if (original.fileType !== undefined) payload.fileType = original.fileType;
        if (original.fileData !== undefined) payload.fileData = original.fileData;
        if (original.imageData !== undefined) payload.imageData = original.imageData;
        if (original.caption !== undefined) payload.caption = original.caption;
        if (original.duration !== undefined) payload.duration = original.duration;

        try {
            await database.ref(path).push().set(payload);
            successCount++;
        } catch (err) {
            console.error('İletme hatası:', err);
        }
    }

    showToast('Başarılı', `${successCount} mesaj iletildi.`, 'success');
    hideModals();
    exitSelectionMode();
}

// Alıntıya tıklanınca orijinal mesaja kaydırır ve kısaca vurgular.
function scrollToAndHighlightMessage(msgId) {
    const target = document.querySelector(`.message-wrapper[data-message-id='${msgId}']`);
    if (!target) {
        showToast('Bilgi', (window.i18n ? window.i18n.t('Orijinal mesaj bulunamadı') : 'Orijinal mesaj bulunamadı'), 'error');
        return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('highlight-flash');
    // reflow ile animasyonu yeniden tetikle
    void target.offsetWidth;
    target.classList.add('highlight-flash');
    setTimeout(() => target.classList.remove('highlight-flash'), 1500);
}

// Bir mesaj balonuna, WhatsApp'taki gibi sağa kaydırınca yanıtlama tetikleyen
// dokunmatik akış ekler. Akışkan olması için transform anlık uygulanır,
// bırakınca eşiği geçtiyse yanıt başlar, geçmediyse balon yumuşakça geri döner.
function attachSwipeToReply(messageWrapper, messageBubble, msgId, msg) {
    const THRESHOLD = 56;
    const MAX_DRAG = 80;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let directionLocked = null; // 'h' | 'v' | null

    const hint = document.createElement('div');
    hint.className = 'swipe-reply-hint';
    hint.innerHTML = '<i class="fas fa-reply"></i>';
    messageBubble.appendChild(hint);

    const onStart = (x, y) => {
        startX = x;
        startY = y;
        dragging = true;
        directionLocked = null;
        messageBubble.style.transition = 'none';
    };

    const onMove = (x, y, e) => {
        if (!dragging) return;
        const dx = x - startX;
        const dy = y - startY;

        if (!directionLocked) {
            if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
            directionLocked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
        }
        if (directionLocked !== 'h') return; // dikey kaydırma ise mesaj listesini kaydır, biz karışmayalım
        if (dx <= 0) return; // sadece sağa kaydırma

        if (e && e.cancelable) e.preventDefault();
        const clamped = Math.min(dx, MAX_DRAG);
        messageBubble.style.transform = `translateX(${clamped}px)`;
        messageWrapper.classList.toggle('swipe-active', clamped > THRESHOLD * 0.5);
    };

    const onEnd = () => {
        if (!dragging) return;
        dragging = false;
        messageBubble.style.transition = '';
        const matrix = new DOMMatrixReadOnly(getComputedStyle(messageBubble).transform);
        const movedX = matrix.m41;
        messageBubble.style.transform = '';
        messageWrapper.classList.remove('swipe-active');

        if (directionLocked === 'h' && movedX > THRESHOLD) {
            startReply(msgId, messageCache[msgId] || msg);
        }
        directionLocked = null;
    };

    messageBubble.addEventListener('touchstart', (e) => {
        if (selectionMode) return;
        const t = e.touches[0];
        onStart(t.clientX, t.clientY);
    }, { passive: true });

    messageBubble.addEventListener('touchmove', (e) => {
        if (selectionMode) return;
        const t = e.touches[0];
        onMove(t.clientX, t.clientY, e);
    }, { passive: false });

    messageBubble.addEventListener('touchend', onEnd);
    messageBubble.addEventListener('touchcancel', onEnd);
}

// Bir mesaja uzun basınca (mobilde dokunma, masaüstünde fare basılı tutma)
// çoklu seçim modunu görünür bir buton olmadan başlatır.
function attachLongPressToSelect(messageWrapper, messageBubble, msgId) {
    const LONG_PRESS_MS = 480;
    const MOVE_CANCEL_PX = 10;
    let pressTimer = null;
    let startX = 0;
    let startY = 0;

    const clearTimer = () => {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    };

    const trigger = () => {
        pressTimer = null;
        if (selectionMode) return;
        if (navigator.vibrate) navigator.vibrate(15);
        enterSelectionMode();
        toggleMessageSelection(msgId, messageWrapper);
    };

    const start = (x, y) => {
        if (selectionMode) return;
        startX = x;
        startY = y;
        clearTimer();
        pressTimer = setTimeout(trigger, LONG_PRESS_MS);
    };

    const move = (x, y) => {
        if (!pressTimer) return;
        if (Math.abs(x - startX) > MOVE_CANCEL_PX || Math.abs(y - startY) > MOVE_CANCEL_PX) {
            clearTimer();
        }
    };

    messageBubble.addEventListener('touchstart', (e) => {
        lastTouchInteractionTs = Date.now();
        const t = e.touches[0];
        start(t.clientX, t.clientY);
    }, { passive: true });

    messageBubble.addEventListener('touchmove', (e) => {
        lastTouchInteractionTs = Date.now();
        const t = e.touches[0];
        move(t.clientX, t.clientY);
    }, { passive: true });

    messageBubble.addEventListener('touchend', clearTimer);
    messageBubble.addEventListener('touchcancel', clearTimer);

    messageBubble.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        start(e.clientX, e.clientY);
    });
    messageBubble.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
    messageBubble.addEventListener('mouseup', clearTimer);
    messageBubble.addEventListener('mouseleave', clearTimer);
}

function appendMessage(msgId, msg, isInitialLoadFlag = false) {
    messageCache[msgId] = msg;
    const isOwnMessage = msg.senderUid === currentUser.uid;

    const messageWrapper = document.createElement('div');
    messageWrapper.className = `message-wrapper ${isOwnMessage ? 'outgoing' : 'incoming'}`;
    messageWrapper.dataset.messageId = msgId;

    const messageBubble = document.createElement('div');
    messageBubble.className = 'message-bubble';

    if (!isOwnMessage) {
        const senderName = document.createElement('div');
        senderName.className = 'message-sender';
        senderName.textContent = msg.sender;
        messageBubble.appendChild(senderName);
    }

    // Yanıtlanan mesaj varsa, bubble içine tıklanabilir alıntı bloğu ekle
    if (msg.replyTo && msg.replyTo.id) {
        const quote = document.createElement('div');
        quote.className = 'message-quote';

        const quoteAccent = document.createElement('div');
        quoteAccent.className = 'message-quote-accent';

        const quoteBody = document.createElement('div');
        quoteBody.className = 'message-quote-body';

        const quoteSender = document.createElement('div');
        quoteSender.className = 'message-quote-sender';
        quoteSender.textContent = msg.replyTo.sender || '';

        const quoteText = document.createElement('div');
        quoteText.className = 'message-quote-text';
        quoteText.textContent = msg.replyTo.previewText || '';

        quoteBody.appendChild(quoteSender);
        quoteBody.appendChild(quoteText);
        quote.appendChild(quoteAccent);
        quote.appendChild(quoteBody);

        quote.addEventListener('click', (e) => {
            e.stopPropagation();
            scrollToAndHighlightMessage(msg.replyTo.id);
        });

        messageBubble.appendChild(quote);
    }

    // İletilen mesajlarda küçük bir "İletildi" etiketi göster
    if (msg.forwarded) {
        const forwardedTag = document.createElement('div');
        forwardedTag.className = 'message-forwarded-tag';
        forwardedTag.innerHTML = `<i class="fas fa-share"></i> ${window.i18n ? window.i18n.t('İletildi') : 'İletildi'}`;
        messageBubble.appendChild(forwardedTag);
    }

    if (msg.type === 'file') {
        const fileMessage = document.createElement('div');
        fileMessage.className = 'file-message';
        
        const fileIcon = document.createElement('div');
        fileIcon.className = 'file-icon';
        fileIcon.textContent = getFileIcon(msg.fileType, msg.fileName);
        
        const fileInfo = document.createElement('div');
        fileInfo.className = 'file-info';
        
        const fileName = document.createElement('div');
        fileName.className = 'file-name';
        fileName.textContent = msg.fileName || 'Dosya';
        
        const fileSize = document.createElement('div');
        fileSize.className = 'file-size';
        fileSize.textContent = msg.fileSize ? formatFileSize(msg.fileSize) : '';
        
        fileInfo.appendChild(fileName);
        fileInfo.appendChild(fileSize);
        fileMessage.appendChild(fileIcon);
        fileMessage.appendChild(fileInfo);

        const fileActions = document.createElement('div');
        fileActions.className = 'file-actions';

        const downloadBtn = document.createElement('a');
        downloadBtn.className = 'file-action-btn file-download-btn';
        downloadBtn.title = (window.i18n ? window.i18n.t('İndir') : 'İndir');
        downloadBtn.innerHTML = '<i class="fas fa-download"></i>';
        downloadBtn.style.textDecoration = 'none';
        downloadBtn.target = '_blank';
        downloadBtn.rel = 'noopener noreferrer';
        // href, adres uzun basınca da açılabilsin diye tutuluyor; ama
        // gerçek indirme/paylaşma işini click handler'daki saveOrShareFile
        // yürütüyor çünkü AppCreator24 gibi WebView sarmalayıcılarda
        // <a download> + blob: URL genelde hiçbir şey yapmıyor.
        const fileBlobUrl = msg.fileData ? dataURLtoBlobURL(msg.fileData) : null;
        if (fileBlobUrl) {
            downloadBtn.href = fileBlobUrl;
            downloadBtn.download = msg.fileName || 'dosya';
        }
        downloadBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (!msg.fileData) return;
            const blob = await dataURLtoBlob(msg.fileData);
            saveOrShareFile(blob, msg.fileName || 'dosya');
        });

        fileActions.appendChild(downloadBtn);
        fileMessage.appendChild(fileActions);
        fileMessage.style.cursor = 'pointer';
        fileMessage.onclick = () => downloadBtn.click();

        messageBubble.appendChild(fileMessage);

        if (msg.caption && msg.caption.trim()) {
            const fileCaption = document.createElement('div');
            fileCaption.className = 'file-caption';
            fileCaption.style.padding = '4px 12px 8px 12px';
            fileCaption.style.fontSize = '13px';
            fileCaption.style.color = 'var(--text-color)';
            fileCaption.style.opacity = '0.9';
            fileCaption.textContent = msg.caption;
            messageBubble.appendChild(fileCaption);
        }

    } else if (msg.type === 'image') {
        const imageMessage = createImageMessageElement(msg);
        messageBubble.appendChild(imageMessage);
        
    } else if (msg.type === 'video') {
        const videoMessage = createVideoMessageElement(msg);
        messageBubble.appendChild(videoMessage);
        
    } else if (msg.type === 'voice') {
        const voiceMessage = createVoiceMessageElement(msg);
        messageBubble.appendChild(voiceMessage);
        
    } else {
        const messageText = document.createElement('div');
        messageText.className = 'message-text';
        linkifyToElement(messageText, msg.text);
        messageBubble.appendChild(messageText);
        
        // ÇEVİRİ BUTONU - SADECE GELEN MESAJLARDA
        if (!isOwnMessage && msg.text && msg.text.length > 0) {
            const translateBtn = document.createElement('button');
            translateBtn.className = 'message-translate-btn';
            translateBtn.innerHTML = '🔤';
            translateBtn.title = (window.i18n ? window.i18n.t("Türkçe'ye Çevir") : "Türkçe'ye Çevir");
            
            translateBtn.onclick = async (e) => {
                e.stopPropagation();
                
                try {
                    translateBtn.disabled = true;
                    translateBtn.innerHTML = '⏳';
                    
                    const translated = await translateMessage(msg.text);
                    
                    let existingTranslation = messageBubble.querySelector('.translated-text');
                    if (!existingTranslation) {
                        existingTranslation = document.createElement('div');
                        existingTranslation.className = 'translated-text';
                        messageBubble.appendChild(existingTranslation);
                    }
                    
                    existingTranslation.textContent = translated;
                    translateBtn.innerHTML = '✅';
                    
                    setTimeout(() => {
                        translateBtn.innerHTML = '🔤';
                        translateBtn.disabled = false;
                    }, 2000);
                    
                } catch (error) {
                    showToast('Hata', 'Çeviri yapılamadı', 'error');
                    translateBtn.innerHTML = '🔤';
                    translateBtn.disabled = false;
                }
            };
            
            messageText.appendChild(translateBtn);

            if (userProfile.settings.autoTranslate) {
                translateBtn.click();
            }
        }
        
        if (msg.translated) {
            const translatedText = document.createElement('div');
            translatedText.className = 'translated-text';
            translatedText.textContent = msg.translated;
            messageBubble.appendChild(translatedText);
        }
    }

    const messageMeta = document.createElement('div');
    messageMeta.className = 'message-meta';

    if (msg.edited) {
        const editedTag = document.createElement('span');
        editedTag.className = 'message-edited-tag';
        editedTag.textContent = (window.i18n ? window.i18n.t('düzenlendi') : 'düzenlendi');
        messageMeta.appendChild(editedTag);
    }

    const date = new Date(msg.timestamp);
    const timeStr = date.toLocaleTimeString((window.i18n ? window.i18n.getLocale() : 'tr-TR'), {
        hour: '2-digit',
        minute: '2-digit'
    });

    const messageTime = document.createElement('span');
    messageTime.className = 'message-time';
    messageTime.textContent = timeStr;
    messageMeta.appendChild(messageTime);

    if (isOwnMessage && userProfile.settings.showReadReceipts) {
        const readStatus = document.createElement('span');
        readStatus.className = 'message-read-status';
        readStatus.id = `read-status-${msgId}`;
        
        const updateTickStatus = () => {
            if (isDmChat) {
                const otherUserId = currentDmOtherUserId || selectedRoomId.split('_').find(uid => uid !== currentUser.uid);
                
                if (msg.readBy && msg.readBy[otherUserId]) {
                    readStatus.innerHTML = '<span class="tick-icon double-blue">✓✓</span>';
                } else if (msg.readBy && Object.keys(msg.readBy).length > 0) {
                    readStatus.innerHTML = '<span class="tick-icon double-grey">✓✓</span>';
                } else {
                    readStatus.innerHTML = '<span class="tick-icon single">✓</span>';
                }
            } else if (selectedRoomId) {
                if (msg.readBy) {
                    const readCount = Object.keys(msg.readBy).length;
                    
                    database.ref(`rooms/${selectedRoomId}/users`).once('value').then(snapshot => {
                        const users = snapshot.val() || {};
                        delete users[currentUser.uid];
                        const totalOtherUsers = Object.keys(users).length;
                        
                        if (readCount === 0) {
                            readStatus.innerHTML = '<span class="tick-icon single">✓</span>';
                        } else if (readCount < totalOtherUsers) {
                            readStatus.innerHTML = '<span class="tick-icon double-grey">✓✓</span>';
                        } else if (readCount >= totalOtherUsers && totalOtherUsers > 0) {
                            readStatus.innerHTML = '<span class="tick-icon double-blue">✓✓</span>';
                        }
                    });
                } else {
                    readStatus.innerHTML = '<span class="tick-icon single">✓</span>';
                }
            }
        };
        
        updateTickStatus();
        
        const path = isDmChat 
            ? `privateMessages/${selectedRoomId}/messages/${msgId}`
            : `rooms/${selectedRoomId}/messages/${msgId}`;
        
        attachMessageListener(database.ref(path + '/readBy'), 'value', (snapshot) => {
            const liveReadBy = snapshot.val();
            if (liveReadBy) {
                msg.readBy = liveReadBy;
                updateTickStatus();
            }
        });
        
        messageMeta.appendChild(readStatus);
    }

    messageWrapper.appendChild(messageBubble);
    messageWrapper.appendChild(messageMeta);

    // Sabitlenmiş mesaj bu ise (banner henüz bu mesajdan önce yüklendiyse) işaretle
    if (currentPinnedMessageId === msgId) {
        messageWrapper.classList.add('pinned-message');
    }

    // Masaüstü: sağ tık ile yanıtla/kopyala/sabitle/düzenle/sil menüsü açılır
    // (mesajlar yan yana/sıkışık olduğunda hover butonları çakışmasın diye)
    messageWrapper.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (selectionMode) {
            toggleMessageSelection(msgId, messageWrapper);
            return;
        }
        // Dokunmatik uzun basma zaten seçim modunu tetikliyor - o durumda
        // tarayıcının/dokunmatığın ürettiği contextmenu olayını sessizce yut.
        if (Date.now() - lastTouchInteractionTs < 900) return;
        showMessageContextMenu(e.clientX, e.clientY, msgId, msg, isOwnMessage);
    });

    // Çoklu seçim modu: mod açıkken mesaja tıklamak normal davranışları
    // (indirme, lightbox, çeviri vb.) geçersiz kılıp seçimi değiştirir.
    messageWrapper.addEventListener('click', (e) => {
        if (!selectionMode) return;
        e.preventDefault();
        e.stopPropagation();
        toggleMessageSelection(msgId, messageWrapper);
    }, true);

    // Normal tek tıklama/dokunma (seçim modu kapalıyken): mesajın kendi özel
    // tıklama davranışı olan alt öğelerine (resim, video, dosya, sesli mesaj,
    // alıntı, çeviri butonu, link) dokunulmadıysa, sağ-tık menüsüyle aynı
    // eylem menüsünü açar. Böylece mobilde ve masaüstünde mesaja tıklamak
    // menüyü açar; uzun basma hâlâ çoklu seçimi başlatır.
    messageWrapper.addEventListener('click', (e) => {
        if (selectionMode) return;
        const skipSelector = 'img, video, audio, a, button, .image-message, .video-message, .file-message, .voice-message, .message-quote, .translate-btn';
        if (e.target.closest(skipSelector)) return;
        e.preventDefault();
        e.stopPropagation();
        // Menü tıklanan noktada değil, mesajın (baloncuk + saat/görüldü satırı
        // dahil tüm mesaj bloğunun) hemen altında açılsın; sadece baloncuğu
        // baz alırsak saat/tik işaretlerinin üstüne biner.
        const bubbleRect = messageBubble.getBoundingClientRect();
        const wrapperRect = messageWrapper.getBoundingClientRect();
        const menuX = isOwnMessage ? bubbleRect.right : bubbleRect.left;
        const belowY = wrapperRect.bottom + 6;
        const aboveY = wrapperRect.top - 6;
        showMessageContextMenu(menuX, belowY, msgId, messageCache[msgId] || msg, isOwnMessage, isOwnMessage ? 'right' : 'left', aboveY);
    });

    // WhatsApp tarzı akışkan kaydırarak yanıtlama (mobil dokunmatik)
    attachSwipeToReply(messageWrapper, messageBubble, msgId, msg);

    // Uzun basınca çoklu seçim moduna gir (mobil/masaüstü, gizli - buton yok)
    attachLongPressToSelect(messageWrapper, messageBubble, msgId);

    const messageDate = new Date(msg.timestamp);
    const messageDateStr = messageDate.toLocaleDateString((window.i18n ? window.i18n.getLocale() : 'tr-TR'), {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
    
    if (lastMessageDate !== messageDateStr) {
        const dateSeparator = document.createElement('div');
        dateSeparator.className = 'date-separator';
        dateSeparator.innerHTML = `<span class="date-label">${messageDateStr}</span>`;
        document.getElementById('messages-container').appendChild(dateSeparator);
        lastMessageDate = messageDateStr;
    }

    document.getElementById('messages-container').appendChild(messageWrapper);

    if (!isInitialLoadFlag && messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

async function deleteMessage(msgId) {
    if (!selectedRoomId || !currentUser) {
        showToast('Hata', 'Mesaj silme için giriş yapmalısınız.', 'error');
        return;
    }
    
    const path = isDmChat 
        ? `privateMessages/${selectedRoomId}/messages/${msgId}`
        : `rooms/${selectedRoomId}/messages/${msgId}`;
    
    database.ref(path).once('value').then(snapshot => {
        const message = snapshot.val();
        if (!message) {
            showToast('Hata', 'Mesaj bulunamadı.', 'error');
            return;
        }
        
        if (message.senderUid !== currentUser.uid && userProfile.role !== 'admin') {
            showToast('Hata', 'Sadece kendi mesajlarınızı silebilirsiniz.', 'error');
            return;
        }
        
        database.ref(path).remove()
            .then(() => {
                showToast('Başarılı', 'Mesaj silindi.', 'success');
                
                const messageElement = document.querySelector(`.message-wrapper[data-message-id='${msgId}']`);
                if (messageElement) {
                    messageElement.remove();
                }
                
                processedMessageIds.delete(msgId);
                delete messageCache[msgId];
                
                if (!isDmChat) {
                    updateRoomLastMessages(selectedRoomId);
                }
            })
            .catch(error => {
                showToast('Hata', 'Mesaj silinirken bir hata oluştu.', 'error');
                console.error('Mesaj silme hatası:', error);
            });
    }).catch(error => {
        showToast('Hata', 'Mesaj kontrol edilirken hata oluştu.', 'error');
        console.error('Mesaj kontrol hatası:', error);
    });
}

function updateRoomLastMessages(roomId) {
    if (isDmChat) return;
    
    database.ref(`rooms/${roomId}/messages`).limitToLast(1).once('value').then(snapshot => {
        const messages = snapshot.val();
        if (messages) {
            const lastMsgKey = Object.keys(messages)[0];
            const lastMsg = messages[lastMsgKey];
            roomLastMessages[roomId] = `${lastMsg.sender}: ${buildMessagePreviewText(lastMsg)}`;
            updateRoomItemLastMessage(roomId, roomLastMessages[roomId]);
        } else {
            roomLastMessages[roomId] = "Henüz mesaj yok";
            updateRoomItemLastMessage(roomId, roomLastMessages[roomId]);
        }
    });
}

async function startVoiceRecording() {
    try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(audioStream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const audioUrl = URL.createObjectURL(audioBlob);
            
            const audioPreview = document.getElementById('voice-record-audio');
            audioPreview.src = audioUrl;
            
            document.getElementById('voice-record-preview').style.display = 'block';
            document.getElementById('voice-record-send-btn').disabled = false;
            
            const animation = document.getElementById('voice-record-animation');
            animation.innerHTML = '<i class="fas fa-check-circle"></i>';
            animation.style.color = 'var(--success-color)';
            
            if (recordTimer) {
                clearInterval(recordTimer);
                recordTimer = null;
            }
        };

        mediaRecorder.start();
        recordStartTime = Date.now();
        
        updateRecordTimer();
        recordTimer = setInterval(updateRecordTimer, 1000);
        
        document.getElementById('voice-record-start-btn').disabled = true;
        document.getElementById('voice-record-stop-btn').disabled = false;
        document.getElementById('voice-record-status').textContent = (window.i18n ? window.i18n.t('Kayıt yapılıyor...') : 'Kayıt yapılıyor...');
        document.getElementById('voice-record-status').style.color = 'var(--error-color)';
        
        const animation = document.getElementById('voice-record-animation');
        animation.innerHTML = '<i class="fas fa-microphone"></i>';
        animation.style.color = 'var(--error-color)';
        animation.style.animation = 'pulse 1.5s infinite';
        
        document.getElementById('voice-record-btn').classList.add('recording');
        
    } catch (error) {
        console.error('Ses kaydı hatası:', error);
        showToast('Hata', 'Mikrofon erişimi reddedildi.', 'error');
    }
}

function stopVoiceRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        
        if (audioStream) {
            audioStream.getTracks().forEach(track => track.stop());
        }
        
        document.getElementById('voice-record-start-btn').disabled = false;
        document.getElementById('voice-record-stop-btn').disabled = true;
        document.getElementById('voice-record-status').textContent = (window.i18n ? window.i18n.t('Kayıt tamamlandı.') : 'Kayıt tamamlandı.');
        document.getElementById('voice-record-status').style.color = 'var(--success-color)';
        
        const animation = document.getElementById('voice-record-animation');
        animation.style.animation = 'none';
        
        document.getElementById('voice-record-btn').classList.remove('recording');
    }
}

function updateRecordTimer() {
    if (recordStartTime) {
        const elapsed = Date.now() - recordStartTime;
        const seconds = Math.floor(elapsed / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        
        const timeStr = `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        document.getElementById('voice-record-time').textContent = timeStr;
        
        if (seconds >= 300) {
            stopVoiceRecording();
            showToast('Uyarı', 'Maksimum kayıt süresi (5 dakika) doldu.', 'warning');
        }
    }
}

function resetVoiceRecording() {
    audioChunks = [];
    mediaRecorder = null;
    audioStream = null;
    audioBlob = null;
    recordStartTime = null;
    
    if (recordTimer) {
        clearInterval(recordTimer);
        recordTimer = null;
    }
    
    document.getElementById('voice-record-time').textContent = '00:00';
    document.getElementById('voice-record-status').textContent = (window.i18n ? window.i18n.t('Kayıt başlatmak için mikrofon butonuna basılı tutun') : 'Kayıt başlatmak için mikrofon butonuna basılı tutun');
    document.getElementById('voice-record-status').style.color = 'var(--text-color)';
    document.getElementById('voice-record-preview').style.display = 'none';
    document.getElementById('voice-record-audio').src = '';
    document.getElementById('voice-record-start-btn').disabled = false;
    document.getElementById('voice-record-stop-btn').disabled = true;
    document.getElementById('voice-record-send-btn').disabled = true;
    
    const animation = document.getElementById('voice-record-animation');
    animation.innerHTML = '<i class="fas fa-microphone"></i>';
    animation.style.color = 'var(--primary-color)';
    animation.style.animation = 'none';
    
    document.getElementById('voice-record-btn').classList.remove('recording');
}

async function sendVoiceMessage() {
    if (!audioBlob || !selectedRoomId || !currentUser) {
        showToast('Uyarı', 'Önce bir ses kaydı yapın.', 'error');
        return;
    }

    showUploadProgress('Sesli mesaj');

    try {
        const audioFile = new File([audioBlob], `sesli_mesaj_${Date.now()}.webm`, { type: 'audio/webm' });
        const uploadResult = await uploadFileToBackend(audioFile, (pct) => updateUploadProgress(Math.round(pct * 0.9)));
        updateUploadProgress(95);

        const path = isDmChat 
            ? `privateMessages/${selectedRoomId}/messages`
            : `rooms/${selectedRoomId}/messages`;
        
        const newMessageRef = database.ref(path).push();
        const replyPayload = buildReplyPayload();
        
        await setMessageFast(newMessageRef, {
            sender: currentUser.username,
            senderUid: currentUser.uid,
            type: 'voice',
            fileName: uploadResult.name,
            fileSize: uploadResult.size,
            fileType: uploadResult.type || 'audio/webm',
            fileData: uploadResult.url,
            duration: Math.floor((Date.now() - recordStartTime) / 1000),
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            readBy: {},
            ...(replyPayload ? { replyTo: replyPayload } : {})
        });
        
        updateUploadProgress(100);
        
        setTimeout(() => {
            hideUploadProgress();
            showToast('Başarılı', 'Sesli mesaj gönderildi.', 'success');
            hideModals();
            resetVoiceRecording();
            cancelReply();
        }, 500);
        
    } catch (error) {
        hideUploadProgress();
        showToast('Hata', 'Sesli mesaj gönderilirken bir hata oluştu.', 'error');
        console.error('Sesli mesaj gönderme hatası:', error);
    }
}

async function showImagePreview(file) {
    if (!selectedRoomId || !currentUser) {
        showToast('Uyarı', 'Önce bir sohbete katılın.', 'error');
        return;
    }

    if (file.size > 25 * 1024 * 1024) {
        showToast('Uyarı', 'Görsel boyutu 25MB\'dan küçük olmalıdır.', 'error');
        return;
    }

    try {
        showUploadProgress(file.name);
        updateUploadProgress(30);

        // Küçült: ~200KB'lık JPEG hem hızlı gider hem anında yüklenir
        const compressed = await compressImageFile(file);
        if (compressed.size > 5 * 1024 * 1024) {
            hideUploadProgress();
            showToast('Uyarı', 'Görsel boyutu 5MB\'dan küçük olmalıdır.', 'error');
            return;
        }
        
        imagePreviewData = await fileToBase64(compressed);
        imagePreviewFile = compressed;
        
        updateUploadProgress(100);
        setTimeout(() => {
            hideUploadProgress();
            
            document.getElementById('image-preview-img').src = imagePreviewData;
            document.getElementById('image-caption-input').value = '';
            showModal('image-preview-modal');
        }, 500);
        
    } catch (error) {
        hideUploadProgress();
        showToast('Hata', 'Görsel yüklenirken bir hata oluştu.', 'error');
        console.error('Görsel önizleme hatası:', error);
    }
}

async function sendImageWithCaption(caption = '') {
    if (!imagePreviewData || !imagePreviewFile || !selectedRoomId || !currentUser) {
        showToast('Uyarı', 'Önce bir görsel seçin.', 'error');
        return;
    }

    showUploadProgress(imagePreviewFile.name);
    
    try {
        const uploadResult = await uploadFileToBackend(imagePreviewFile, (pct) => updateUploadProgress(Math.round(pct * 0.9)));
        updateUploadProgress(95);

        const path = isDmChat 
            ? `privateMessages/${selectedRoomId}/messages`
            : `rooms/${selectedRoomId}/messages`;
        
        const newMessageRef = database.ref(path).push();
        const replyPayload = buildReplyPayload();
        
        await setMessageFast(newMessageRef, {
            sender: currentUser.username,
            senderUid: currentUser.uid,
            type: 'image',
            fileName: uploadResult.name,
            fileSize: uploadResult.size,
            fileType: uploadResult.type,
            fileData: uploadResult.url,
            imageData: uploadResult.url,
            caption: caption.trim(),
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            readBy: {},
            ...(replyPayload ? { replyTo: replyPayload } : {})
        });
        
        updateUploadProgress(100);
        
        setTimeout(() => {
            hideUploadProgress();
            showToast('Başarılı', 'Görsel gönderildi.', 'success');
            hideModals();
            
            imagePreviewFile = null;
            imagePreviewData = null;
            document.getElementById('image-preview-img').src = '';
            document.getElementById('image-caption-input').value = '';
            cancelReply();
        }, 500);
        
    } catch (error) {
        hideUploadProgress();
        showToast('Hata', 'Görsel gönderilirken bir hata oluştu.', 'error');
        console.error('Görsel gönderme hatası:', error);
    }
}

async function showVideoPreview(file) {
    if (!selectedRoomId || !currentUser) {
        showToast('Uyarı', 'Önce bir sohbete katılın.', 'error');
        return;
    }

    const maxSize = 7 * 1024 * 1024;
    if (file.size > maxSize) {
        showToast('Uyarı', 'Video boyutu 7MB\'dan küçük olmalıdır.', 'error');
        return;
    }

    try {
        showUploadProgress(file.name);
        updateUploadProgress(30);
        
        videoPreviewData = await fileToBase64(file);
        videoPreviewFile = file;
        
        updateUploadProgress(100);
        setTimeout(() => {
            hideUploadProgress();
            
            const videoPreview = document.getElementById('video-preview-video');
            videoPreview.src = videoPreviewData;
            document.getElementById('video-caption-input').value = '';
            showModal('video-preview-modal');
        }, 500);
        
    } catch (error) {
        hideUploadProgress();
        showToast('Hata', 'Video yüklenirken bir hata oluştu.', 'error');
        console.error('Video önizleme hatası:', error);
    }
}

async function sendVideoWithCaption(caption = '') {
    if (!videoPreviewData || !videoPreviewFile || !selectedRoomId || !currentUser) {
        showToast('Uyarı', 'Önce bir video seçin.', 'error');
        return;
    }

    showUploadProgress(videoPreviewFile.name);
    
    try {
        const uploadResult = await uploadFileToBackend(videoPreviewFile, (pct) => updateUploadProgress(Math.round(pct * 0.9)));
        updateUploadProgress(95);

        const path = isDmChat 
            ? `privateMessages/${selectedRoomId}/messages`
            : `rooms/${selectedRoomId}/messages`;
        
        const newMessageRef = database.ref(path).push();
        const replyPayload = buildReplyPayload();
        
        await setMessageFast(newMessageRef, {
            sender: currentUser.username,
            senderUid: currentUser.uid,
            type: 'video',
            fileName: uploadResult.name,
            fileSize: uploadResult.size,
            fileType: uploadResult.type,
            fileData: uploadResult.url,
            caption: caption.trim(),
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            readBy: {},
            ...(replyPayload ? { replyTo: replyPayload } : {})
        });
        
        updateUploadProgress(100);
        
        setTimeout(() => {
            hideUploadProgress();
            showToast('Başarılı', 'Video gönderildi.', 'success');
            hideModals();
            
            videoPreviewFile = null;
            videoPreviewData = null;
            document.getElementById('video-preview-video').src = '';
            document.getElementById('video-caption-input').value = '';
            cancelReply();
        }, 500);
        
    } catch (error) {
        hideUploadProgress();
        showToast('Hata', 'Video gönderilirken bir hata oluştu.', 'error');
        console.error('Video gönderme hatası:', error);
    }
}

async function showFilePreview(file) {
    if (!selectedRoomId || !currentUser) {
        showToast('Uyarı', 'Önce bir sohbete katılın.', 'error');
        return;
    }

    const maxSize = 7 * 1024 * 1024;
    if (file.size > maxSize) {
        showToast('Uyarı', 'Dosya boyutu 7MB\'dan küçük olmalıdır.', 'error');
        return;
    }

    try {
        showUploadProgress(file.name);
        updateUploadProgress(30);

        filePreviewData = await fileToBase64(file);
        filePreviewFile = file;

        updateUploadProgress(100);
        setTimeout(() => {
            hideUploadProgress();

            document.getElementById('file-preview-icon').textContent = getFileIcon(file.type, file.name);
            document.getElementById('file-preview-name').textContent = file.name;
            document.getElementById('file-preview-size').textContent = formatFileSize(file.size);
            document.getElementById('file-caption-input').value = '';
            showModal('file-preview-modal');
        }, 500);

    } catch (error) {
        hideUploadProgress();
        showToast('Hata', 'Dosya yüklenirken bir hata oluştu.', 'error');
        console.error('Dosya önizleme hatası:', error);
    }
}

async function sendFileWithCaption(caption = '') {
    if (!filePreviewData || !filePreviewFile || !selectedRoomId || !currentUser) {
        showToast('Uyarı', 'Önce bir dosya seçin.', 'error');
        return;
    }

    showUploadProgress(filePreviewFile.name);

    try {
        const uploadResult = await uploadFileToBackend(filePreviewFile, (pct) => updateUploadProgress(Math.round(pct * 0.9)));
        updateUploadProgress(95);

        const path = isDmChat
            ? `privateMessages/${selectedRoomId}/messages`
            : `rooms/${selectedRoomId}/messages`;

        const newMessageRef = database.ref(path).push();
        const replyPayload = buildReplyPayload();

        await setMessageFast(newMessageRef, {
            sender: currentUser.username,
            senderUid: currentUser.uid,
            type: 'file',
            fileName: uploadResult.name,
            fileSize: uploadResult.size,
            fileType: uploadResult.type || 'application/octet-stream',
            fileData: uploadResult.url,
            caption: caption.trim(),
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            readBy: {},
            ...(replyPayload ? { replyTo: replyPayload } : {})
        });

        updateUploadProgress(100);

        setTimeout(() => {
            hideUploadProgress();
            showToast('Başarılı', 'Dosya gönderildi.', 'success');
            hideModals();
            cancelReply();

            filePreviewFile = null;
            filePreviewData = null;
            document.getElementById('file-caption-input').value = '';
        }, 500);

    } catch (error) {
        hideUploadProgress();
        showToast('Hata', 'Dosya gönderilirken bir hata oluştu.', 'error');
        console.error('Dosya gönderme hatası:', error);
    }
}

function updateOnlineUsers() {
    if (!selectedRoomId || isDmChat) return;

    if (roomUsersRef) roomUsersRef.off();
    roomUsersRef = database.ref(`rooms/${selectedRoomId}/users`);

    roomUsersRef.on('value', (snapshot) => {
        const users = snapshot.val() || {};
        
        const allUsersList = [];
        
        if (currentUser && currentUser.uid) {
            allUsersList.push({
                uid: currentUser.uid,
                username: currentUser.username,
                status: 'online',
                role: userProfile.role
            });
        }
        
        Object.keys(users).forEach(uid => {
            if (uid !== currentUser.uid && users[uid]) {
                let userRole = 'user';
                if (allUsers[uid] && allUsers[uid].role) {
                    userRole = allUsers[uid].role;
                }
                
                allUsersList.push({
                    uid: uid,
                    username: users[uid].username || 'Bilinmeyen',
                    status: users[uid].online ? 'online' : 'offline',
                    role: userRole
                });
            }
        });
        
        const onlineCount = allUsersList.filter(u => u.status === 'online').length;
        const totalMembers = allUsersList.length;
        const offlineCount = totalMembers - onlineCount;
        
        document.getElementById('online-count').textContent = (window.i18n ? window.i18n.t(`${onlineCount} çevrimiçi / ${totalMembers} üye`) : `${onlineCount} çevrimiçi / ${totalMembers} üye`);
        
        document.getElementById('room-info-online').innerHTML = `
            <strong>${(window.i18n ? window.i18n.t(`${onlineCount} çevrimiçi`) : `${onlineCount} çevrimiçi`)}</strong> / ${(window.i18n ? window.i18n.t(`${totalMembers} üye`) : `${totalMembers} üye`)}
            <br>
            <span style="font-size: 12px; opacity: 0.7;">${(window.i18n ? window.i18n.t(`${offlineCount} çevrimdışı`) : `${offlineCount} çevrimdışı`)}</span>
        `;
        
        window.currentOnlineUsers = allUsersList;
    });
}

function showOnlineUsers() {
    if (!selectedRoomId || isDmChat) {
        showToast('Uyarı', 'Bu özellik sadece odalar için geçerlidir.', 'error');
        return;
    }

    const onlineUsersList = document.getElementById('online-users-list');
    onlineUsersList.innerHTML = '';

    if (window.currentOnlineUsers && window.currentOnlineUsers.length > 0) {
        const onlineUsers = window.currentOnlineUsers.filter(u => u.status === 'online');
        const offlineUsers = window.currentOnlineUsers.filter(u => u.status === 'offline');
        
        if (onlineUsers.length > 0) {
            const onlineHeader = document.createElement('div');
            onlineHeader.style.padding = '10px';
            onlineHeader.style.fontWeight = '600';
            onlineHeader.style.color = 'var(--online-color)';
            onlineHeader.style.borderBottom = '1px solid var(--border-color)';
            onlineHeader.textContent = (window.i18n ? window.i18n.t(`Çevrimiçi (${onlineUsers.length})`) : `Çevrimiçi (${onlineUsers.length})`);
            onlineUsersList.appendChild(onlineHeader);
            
            onlineUsers.forEach(user => {
                const isCurrentUser = user.uid === currentUser.uid;
                const userItem = document.createElement('div');
                userItem.className = 'online-user-item';
                userItem.style.cursor = isCurrentUser ? 'default' : 'pointer';
                userItem.title = isCurrentUser ? (window.i18n ? window.i18n.t('Siz') : 'Siz') : (window.i18n ? window.i18n.t(`${user.username} ile DM başlat`) : `${user.username} ile DM başlat`);
                
                const statusColor = 'var(--online-color)';
                const statusText = '🟢';
                const uPhoto = (allUsers && allUsers[user.uid] && allUsers[user.uid].profilePhoto) || user.profilePhoto;
                const uAvatarStyle = uPhoto
                    ? `style="background-image: url(${uPhoto}); background-size: cover; background-position: center;"`
                    : '';
                
                userItem.innerHTML = `
                    <div class="online-user-avatar" ${uAvatarStyle}>
                        ${uPhoto ? '' : user.username.charAt(0).toUpperCase()}
                        <div class="online-user-status online"></div>
                    </div>
                    <div class="online-user-name">${user.username}${isCurrentUser ? ' (' + (window.i18n ? window.i18n.t('Siz') : 'Siz') + ')' : ''} ${user.role === 'admin' ? '👑' : user.role === 'moderator' ? '⭐' : ''}</div>
                    <div style="color: ${statusColor};">${statusText}</div>
                    ${!isCurrentUser ? '<div style="font-size: 12px; color: var(--dm-color); opacity: 0.7;"><i class="fas fa-comment-dots"></i></div>' : ''}
                `;
                
                if (!isCurrentUser) {
                    userItem.onclick = (e) => {
                        e.stopPropagation();
                        hideModals();
                        startDM(user.uid, user.username);
                    };
                }
                
                onlineUsersList.appendChild(userItem);
            });
        }
        
        if (offlineUsers.length > 0) {
            const offlineHeader = document.createElement('div');
            offlineHeader.style.padding = '10px';
            offlineHeader.style.fontWeight = '600';
            offlineHeader.style.color = 'var(--offline-color)';
            offlineHeader.style.borderBottom = '1px solid var(--border-color)';
            offlineHeader.style.marginTop = '10px';
            offlineHeader.textContent = (window.i18n ? window.i18n.t(`Çevrimdışı (${offlineUsers.length})`) : `Çevrimdışı (${offlineUsers.length})`);
            onlineUsersList.appendChild(offlineHeader);
            
            offlineUsers.forEach(user => {
                const userItem = document.createElement('div');
                userItem.className = 'online-user-item';
                userItem.style.cursor = 'pointer';
                userItem.title = (window.i18n ? window.i18n.t(`${user.username} ile DM başlat (Çevrimdışı)`) : `${user.username} ile DM başlat (Çevrimdışı)`);
                
                const uPhoto = (allUsers && allUsers[user.uid] && allUsers[user.uid].profilePhoto) || user.profilePhoto;
                const uAvatarStyle = uPhoto
                    ? `style="background-image: url(${uPhoto}); background-size: cover; background-position: center;"`
                    : '';

                userItem.innerHTML = `
                    <div class="online-user-avatar" ${uAvatarStyle}>
                        ${uPhoto ? '' : user.username.charAt(0).toUpperCase()}
                        <div class="online-user-status offline"></div>
                    </div>
                    <div class="online-user-name">${user.username} ${user.role === 'admin' ? '👑' : user.role === 'moderator' ? '⭐' : ''}</div>
                    <div style="color: var(--offline-color);">🔴</div>
                    <div style="font-size: 12px; color: var(--dm-color); opacity: 0.7;">
                        <i class="fas fa-comment-dots"></i>
                    </div>
                `;
                
                userItem.onclick = (e) => {
                    e.stopPropagation();
                    hideModals();
                    startDM(user.uid, user.username);
                };
                
                onlineUsersList.appendChild(userItem);
            });
        }
    } else {
        const currentUserItem = document.createElement('div');
        currentUserItem.className = 'online-user-item';
        currentUserItem.style.cursor = 'default';
        currentUserItem.innerHTML = `
            <div class="online-user-avatar">
                ${currentUser.username.charAt(0).toUpperCase()}
                <div class="online-user-status online"></div>
            </div>
            <div class="online-user-name">${currentUser.username} ${(window.i18n ? window.i18n.t('(Siz)') : '(Siz)')} ${userProfile.role === 'admin' ? '👑' : userProfile.role === 'moderator' ? '⭐' : ''}</div>
            <div style="color: var(--online-color);">🟢</div>
        `;
        onlineUsersList.appendChild(currentUserItem);
    }

    showModal('online-users-modal');
}

function showUserInfo() {
    if (!selectedRoomId || !isDmChat) {
        showToast('Uyarı', 'Bu özellik sadece özel mesajlar için geçerlidir.', 'error');
        return;
    }

    const otherUserId = currentDmOtherUserId || selectedRoomId.split('_').find(uid => uid !== currentUser.uid);
    
    if (!otherUserId || !allUsers[otherUserId]) {
        showToast('Hata', 'Kullanıcı bilgileri yüklenemedi.', 'error');
        return;
    }
    
    const user = allUsers[otherUserId];
    
    document.getElementById('user-info-name').textContent = user.username;
    
    const userAvatar = document.getElementById('user-info-avatar');
    if (user.profilePhoto) {
        userAvatar.style.backgroundImage = `url(${user.profilePhoto})`;
        userAvatar.textContent = '';
    } else {
        userAvatar.style.backgroundImage = '';
        userAvatar.textContent = user.username.charAt(0).toUpperCase();
    }
    
    let statusText = '🔴 Çevrimdışı';
    if (user.isOnline) {
        statusText = '🟢 Çevrimiçi';
    } else if (user.lastSeen) {
        const lastSeenDate = new Date(user.lastSeen);
        const now = new Date();
        const diffMs = now - lastSeenDate;
        const diffMins = Math.floor(diffMs / 60000);
        
        if (diffMins < 5) {
            statusText = '🟢 Çevrimiçi';
        } else {
            statusText = '🔴 Çevrimdışı';
        }
    }
    document.getElementById('user-info-status').textContent = (window.i18n ? window.i18n.t(statusText) : statusText);
    
    document.getElementById('user-info-bio').textContent = user.bio || (window.i18n ? window.i18n.t('Açıklama bulunmuyor') : 'Açıklama bulunmuyor');
    
    if (user.createdAt) {
        const joinDate = new Date(user.createdAt);
        document.getElementById('user-info-joined').textContent = joinDate.toLocaleDateString((window.i18n ? window.i18n.getLocale() : 'tr-TR'), {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    } else {
        document.getElementById('user-info-joined').textContent = (window.i18n ? window.i18n.t('Bilinmiyor') : 'Bilinmiyor');
    }
    
    if (!user.isOnline && user.lastSeen) {
        const lastSeenDate = new Date(user.lastSeen);
        const now = new Date();
        const diffMs = now - lastSeenDate;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);
        
        let lastSeenText = '';
        if (diffMins < 60) {
            lastSeenText = (window.i18n ? window.i18n.t(`${diffMins} dakika önce`) : `${diffMins} dakika önce`);
        } else if (diffHours < 24) {
            lastSeenText = (window.i18n ? window.i18n.t(`${diffHours} saat önce`) : `${diffHours} saat önce`);
        } else {
            lastSeenText = (window.i18n ? window.i18n.t(`${diffDays} gün önce`) : `${diffDays} gün önce`);
        }
        
        document.getElementById('user-info-last-seen').textContent = lastSeenText;
    } else if (user.isOnline) {
        document.getElementById('user-info-last-seen').textContent = (window.i18n ? window.i18n.t('Çevrimiçi') : 'Çevrimiçi');
    } else {
        document.getElementById('user-info-last-seen').textContent = 'Bilinmiyor';
    }
    
    let roleText = 'Kullanıcı';
    if (user.role === 'admin') {
        roleText = (window.i18n ? window.i18n.t('👑 Admin') : '👑 Admin');
    } else if (user.role === 'moderator') {
        roleText = (window.i18n ? window.i18n.t('⭐ Moderatör') : '⭐ Moderatör');
    }
    document.getElementById('user-info-role').textContent = roleText;
    
    showModal('user-info-modal');
}

function listenToTypingIndicator() {
    if (!selectedRoomId || isDmChat) {
        document.getElementById('typing-indicator').textContent = '';
        return;
    }
    
    const path = `rooms/${selectedRoomId}/typing`;

    if (typingRef) typingRef.off();
    typingRef = database.ref(path);

    typingRef.on('value', (snapshot) => {
        const typers = snapshot.val() || {};
        const currentUserUID = currentUser.uid;
        const typingUsernames = Object.keys(typers)
            .filter(uid => uid !== currentUserUID && typers[uid] && typers[uid].username)
            .map(uid => typers[uid].username);

        if (typingUsernames.length > 0) {
            document.getElementById('typing-indicator').textContent = (window.i18n ? window.i18n.t(`${typingUsernames.join(', ')} yazıyor...`) : `${typingUsernames.join(', ')} yazıyor...`);
        } else {
            document.getElementById('typing-indicator').textContent = '';
        }
    });
}

function joinRoom(room) {
    if (room.bannedUsers && currentUser && room.bannedUsers[currentUser.uid]) {
        showToast('Hata', 'Bu odaya erişiminiz kısıtlanmış.', 'error');
        showEmptyChat();
        return;
    }

    isDmChat = false;
    
    setupChatScreen(room);
    
    joinedRooms.add(selectedRoomId);
    saveUserData();
    persistJoinedRoomToServer(selectedRoomId);
    
    showToast('Başarılı', `${room.name} odasına katıldınız!`, 'success');
    hideModals();
    hideRoomPreview();
    
    document.getElementById('join-room-password-input').value = '';
    document.getElementById('message-input').focus();

    if (!room.users || !room.users[currentUser.uid]) {
        userStatusRef = database.ref(`rooms/${selectedRoomId}/users/${currentUser.uid}`);
        userStatusRef.set({
            username: currentUser.username,
            online: true
        });
        
        userStatusRef.onDisconnect().set({
            username: currentUser.username,
            online: false
        });
    }

    listenToRoomMessages();
    updateOnlineUsers();
    listenToTypingIndicator();
    listenForKickOrBan(selectedRoomId);
}

// ------- Kullanıcı kendi isteğiyle bir odadan ayrılır (kick/ban'dan farklı) -------
async function leaveRoomAction(roomId) {
    if (!currentUser || !roomId || !rooms[roomId]) return;
    const room = rooms[roomId];

    const result = await customConfirm(
        'Odadan Ayrıl',
        `'${room.name}' odasından ayrılmak istediğinize emin misiniz?`,
        {
            icon: 'question',
            okText: 'Ayrıl',
            cancelText: 'İptal',
            okType: 'danger'
        }
    );

    if (!result) return;

    try {
        await database.ref(`rooms/${roomId}/users/${currentUser.uid}`).remove();
    } catch (e) {
        console.error('Odadan ayrılma hatası:', e);
    }

    // Oda kurucusu 'users' düğümünden muaf tutulduğu (listenForKickOrBan bu yüzden
    // kurucuyu atlıyor) için temizliği burada elle de yapıyoruz.
    joinedRooms.delete(roomId);
    saveUserData();
    removeJoinedRoomFromServer(roomId);

    hideModals();
    showToast('Bilgi', `'${room.name}' odasından ayrıldınız.`, 'info');

    if (selectedRoomId === roomId && !isDmChat) {
        showEmptyChat();
    }
    updateRoomList();
}

function listenForKickOrBan(roomId) {
    if (kickBanRef) {
        kickBanRef.membershipRef.off();
        kickBanRef.banRef.off();
        kickBanRef = null;
    }
    if (!currentUser) return;

    const membershipRef = database.ref(`rooms/${roomId}/users/${currentUser.uid}`);
    const banRef = database.ref(`rooms/${roomId}/bannedUsers/${currentUser.uid}`);

    let membershipFirstSnapshot = true;
    let banFirstSnapshot = true;

    const handleRemoval = (reason) => {
        if (selectedRoomId !== roomId || isDmChat) return;
        showToast('Bilgi', reason, 'warning');
        joinedRooms.delete(roomId);
        saveUserData();
        removeJoinedRoomFromServer(roomId);
        showEmptyChat();
        updateRoomList();
    };

    membershipRef.on('value', (snapshot) => {
        if (membershipFirstSnapshot) {
            membershipFirstSnapshot = false;
            return;
        }
        // Oda kurucusu 'users' düğümünde hiç olmayabilir, onu bu kontrolden muaf tut
        if (rooms[roomId] && rooms[roomId].createdBy === currentUser.uid) return;
        if (!snapshot.exists()) {
            handleRemoval('Odadan çıkarıldınız.');
        }
    });

    banRef.on('value', (snapshot) => {
        if (banFirstSnapshot) {
            banFirstSnapshot = false;
            if (snapshot.exists()) {
                handleRemoval('Bu odaya erişiminiz kısıtlandı.');
            }
            return;
        }
        if (snapshot.exists()) {
            handleRemoval('Bu odaya erişiminiz kısıtlandı.');
        }
    });

    kickBanRef = { membershipRef, banRef };
}

function generateQRCode(inviteLink, elementId) {
    const qrElement = document.getElementById(elementId);
    if (qrElement) {
        qrElement.innerHTML = '';
        QRCode.toCanvas(inviteLink, { 
            width: 150,
            height: 150,
            margin: 1,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        }, function (error, canvas) {
            if (error) {
                console.error('QR kod oluşturma hatası:', error);
                qrElement.innerHTML = `<p style="color: var(--error-color);">${(window.i18n ? window.i18n.t('QR kod oluşturulamadı') : 'QR kod oluşturulamadı')}</p>`;
            } else {
                qrElement.appendChild(canvas);
            }
        });
    }
}

function showRoomManageModal() {
    if (!selectedRoomId || isDmChat) {
        showToast('Uyarı', 'Bu özellik sadece odalar için geçerlidir.', 'error');
        return;
    }

    const room = rooms[selectedRoomId];
    if (!room) {
        showToast('Hata', 'Oda bulunamadı.', 'error');
        return;
    }

    if (!currentUser || room.createdBy !== currentUser.uid) {
        showToast('Hata', 'Bu odayı sadece kurucusu yönetebilir.', 'error');
        return;
    }

    document.getElementById('room-manage-current-name').textContent = room.name || 'Oda';
    document.getElementById('room-manage-name-input').value = room.name || '';

    const avatar = document.getElementById('room-manage-avatar');
    if (room.logo) {
        avatar.style.backgroundImage = `url(${room.logo})`;
        avatar.textContent = '';
    } else {
        avatar.style.backgroundImage = '';
        avatar.textContent = room.name ? room.name.charAt(0).toUpperCase() : 'O';
    }

    loadRoomManageUsersList(selectedRoomId, room);

    showModal('room-manage-modal');
}

function loadRoomManageUsersList(roomId, room) {
    const container = document.getElementById('room-manage-users-list');
    container.innerHTML = `<div style="padding: 15px; text-align: center; opacity: 0.7;">${(window.i18n ? window.i18n.t('Yükleniyor...') : 'Yükleniyor...')}</div>`;

    Promise.all([
        database.ref(`rooms/${roomId}/users`).once('value'),
        database.ref(`rooms/${roomId}/bannedUsers`).once('value')
    ]).then(([usersSnap, bannedSnap]) => {
        const users = usersSnap.val() || {};
        const banned = bannedSnap.val() || {};

        container.innerHTML = '';

        const memberEntries = Object.entries(users).filter(([uid]) => uid !== room.createdBy);
        const bannedOnlyEntries = Object.entries(banned).filter(([uid]) => !users[uid] && uid !== room.createdBy);

        if (memberEntries.length === 0 && bannedOnlyEntries.length === 0) {
            container.innerHTML = `<div style="padding: 15px; text-align: center; opacity: 0.7;">${(window.i18n ? window.i18n.t('Odada başka üye yok.') : 'Odada başka üye yok.')}</div>`;
            return;
        }

        memberEntries.forEach(([uid, userData]) => {
            const isBanned = !!banned[uid];
            const item = document.createElement('div');
            item.className = 'online-user-item';
            item.style.cursor = 'default';

            item.innerHTML = `
                <div class="online-user-avatar">
                    ${userData.username.charAt(0).toUpperCase()}
                    <div class="online-user-status ${userData.online ? 'online' : 'offline'}"></div>
                </div>
                <div class="online-user-name">${userData.username}${isBanned ? ' <span style="color: var(--error-color); font-size: 11px;">(Yasaklı)</span>' : ''}</div>
                <div class="room-manage-user-actions">
                    <button class="room-manage-action-btn kick room-kick-btn" title="Odadan Çıkar" data-uid="${uid}" data-username="${userData.username}">
                        <i class="fas fa-user-slash"></i>
                    </button>
                    <button class="room-manage-action-btn ban room-ban-btn ${isBanned ? 'active' : ''}" title="${isBanned ? 'Yasağı Kaldır' : 'Yasakla'}" data-uid="${uid}" data-username="${userData.username}" data-banned="${isBanned}">
                        <i class="fas fa-ban"></i>
                    </button>
                </div>
            `;
            container.appendChild(item);
        });

        bannedOnlyEntries.forEach(([uid, username]) => {
            const item = document.createElement('div');
            item.className = 'online-user-item';
            item.style.cursor = 'default';
            item.innerHTML = `
                <div class="online-user-avatar">
                    ${username.charAt(0).toUpperCase()}
                    <div class="online-user-status offline"></div>
                </div>
                <div class="online-user-name">${username} <span style="color: var(--error-color); font-size: 11px;">(Yasaklı)</span></div>
                <div class="room-manage-user-actions">
                    <button class="room-manage-action-btn ban room-ban-btn active" title="Yasağı Kaldır" data-uid="${uid}" data-username="${username}" data-banned="true">
                        <i class="fas fa-ban"></i>
                    </button>
                </div>
            `;
            container.appendChild(item);
        });

        container.querySelectorAll('.room-kick-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const uid = btn.dataset.uid;
                const username = btn.dataset.username;
                const result = await customConfirm(
                    'Kullanıcıyı Çıkar',
                    `${username} kullanıcısını odadan çıkarmak istediğinize emin misiniz?`,
                    { icon: 'warning', okText: 'Çıkar', cancelText: 'İptal', okType: 'danger' }
                );
                if (result) {
                    database.ref(`rooms/${roomId}/users/${uid}`).remove()
                        .then(() => {
                            showToast('Başarılı', `${username} odadan çıkarıldı.`, 'success');
                            loadRoomManageUsersList(roomId, rooms[roomId]);
                            updateOnlineUsers();
                        })
                        .catch(() => showToast('Hata', 'Kullanıcı çıkarılırken hata oluştu.', 'error'));
                }
            });
        });

        container.querySelectorAll('.room-ban-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const uid = btn.dataset.uid;
                const username = btn.dataset.username;
                const isBanned = btn.dataset.banned === 'true';

                if (isBanned) {
                    database.ref(`rooms/${roomId}/bannedUsers/${uid}`).remove()
                        .then(() => {
                            showToast('Başarılı', `${username} kullanıcısının yasağı kaldırıldı.`, 'success');
                            loadRoomManageUsersList(roomId, rooms[roomId]);
                        })
                        .catch(() => showToast('Hata', 'Yasak kaldırılırken hata oluştu.', 'error'));
                } else {
                    const result = await customConfirm(
                        'Kullanıcıyı Yasakla',
                        `${username} kullanıcısını yasaklamak istediğinize emin misiniz? Yasaklı kullanıcılar odaya tekrar giremez.`,
                        { icon: 'warning', okText: 'Yasakla', cancelText: 'İptal', okType: 'danger' }
                    );
                    if (result) {
                        database.ref(`rooms/${roomId}/bannedUsers/${uid}`).set(username)
                            .then(() => database.ref(`rooms/${roomId}/users/${uid}`).remove())
                            .then(() => {
                                showToast('Başarılı', `${username} yasaklandı ve odadan çıkarıldı.`, 'success');
                                loadRoomManageUsersList(roomId, rooms[roomId]);
                                updateOnlineUsers();
                            })
                            .catch(() => showToast('Hata', 'Kullanıcı yasaklanırken hata oluştu.', 'error'));
                    }
                }
            });
        });
    });
}

function getRoomAvatarStyle(room) {
    if (room && room.logo) {
        return `style="background-image: url(${room.logo}); background-size: cover; background-position: center;"`;
    }
    return '';
}

function updateRoomAvatarsInUI(roomId, room) {
    document.querySelectorAll(`.room-item[data-room-id="${roomId}"] .room-avatar`).forEach(avatarEl => {
        if (room.logo) {
            avatarEl.style.backgroundImage = `url(${room.logo})`;
            avatarEl.style.backgroundSize = 'cover';
            avatarEl.style.backgroundPosition = 'center';
            avatarEl.textContent = '';
        } else {
            avatarEl.style.backgroundImage = '';
            avatarEl.textContent = room.name.charAt(0).toUpperCase();
        }
    });

    if (selectedRoomId === roomId && !isDmChat) {
        const chatAvatar = document.getElementById('chat-avatar');
        if (room.logo) {
            chatAvatar.style.backgroundImage = `url(${room.logo})`;
            chatAvatar.textContent = '';
        } else {
            chatAvatar.style.backgroundImage = '';
            chatAvatar.textContent = room.name.charAt(0).toUpperCase();
        }
        document.getElementById('room-title').textContent = room.name;
    }
}

function showRoomInfo() {
    if (!selectedRoomId || isDmChat) {
        showToast('Uyarı', 'Bu özellik sadece odalar için geçerlidir.', 'error');
        return;
    }

    const room = rooms[selectedRoomId];
    if (!room) {
        showToast('Hata', 'Oda bulunamadı.', 'error');
        return;
    }

    document.getElementById('room-info-name').textContent = room.name || '-';
    
    database.ref(`users/${room.createdBy}`).once('value').then(snapshot => {
        const creator = snapshot.val();
        const creatorName = creator ? creator.username : 'Bilinmeyen';
        const creatorStatus = creator ? (window.i18n ? window.i18n.t(creator.isOnline ? '🟢 Çevrimiçi' : '🔴 Çevrimdışı') : (creator.isOnline ? '🟢 Çevrimiçi' : '🔴 Çevrimdışı')) : (window.i18n ? window.i18n.t('Bilinmiyor') : 'Bilinmiyor');
        
        document.getElementById('room-info-creator').innerHTML = `
            ${creatorName} <span style="font-size: 12px; opacity: 0.7;">(${creatorStatus})</span>
        `;
    });
    
    if (room.createdAt) {
        const date = new Date(room.createdAt);
        document.getElementById('room-info-created').textContent = date.toLocaleDateString((window.i18n ? window.i18n.getLocale() : 'tr-TR'), {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } else {
        document.getElementById('room-info-created').textContent = '-';
    }
    
    const roomType = (window.i18n ? window.i18n.t((room.isPrivate ? 'Özel/Gizli Oda' : 'Herkese Açık Oda')) : (room.isPrivate ? 'Özel/Gizli Oda' : 'Herkese Açık Oda'));
    const roomTypeColor = room.isPrivate ? 'var(--private-color)' : 'var(--primary-color)';
    document.getElementById('room-info-type').innerHTML = `<span style="color: ${roomTypeColor};">${roomType}</span>`;
    
    document.getElementById('room-info-password').textContent = (window.i18n ? window.i18n.t((room.password ? 'Şifreli' : 'Şifresiz')) : (room.password ? 'Şifreli' : 'Şifresiz'));
    
    database.ref(`rooms/${selectedRoomId}/users`).once('value').then(snapshot => {
        const users = snapshot.val() || {};
        const onlineCount = Object.keys(users).filter(uid => users[uid] && users[uid].online).length;
        const totalOnline = onlineCount + 1;
        const totalMembers = Object.keys(users).length + 1;
        const offlineCount = totalMembers - totalOnline;
        
        document.getElementById('room-info-online').innerHTML = `
            <strong>${(window.i18n ? window.i18n.t(`${totalOnline} çevrimiçi`) : `${totalOnline} çevrimiçi`)}</strong> / ${(window.i18n ? window.i18n.t(`${totalMembers} üye`) : `${totalMembers} üye`)}
            <br>
            <span style="font-size: 12px; opacity: 0.7;">${(window.i18n ? window.i18n.t(`${offlineCount} çevrimdışı`) : `${offlineCount} çevrimdışı`)}</span>
        `;
    });
    
    database.ref(`rooms/${selectedRoomId}/messages`).once('value').then(snapshot => {
        const messages = snapshot.val() || {};
        const messageCount = Object.keys(messages).length;
        document.getElementById('room-info-messages').textContent = `${messageCount} mesaj`;
    });

    if (room.isPrivate) {
        const cleanRoomName = room.name.replace(/\s+/g, '');
        const inviteLink = `Qyriptalk/${cleanRoomName}/${selectedRoomId}`;
        document.getElementById('room-invite-link-input').value = inviteLink;
        document.getElementById('room-invite-link-item').style.display = 'block';
        
        document.getElementById('room-qr-code-item').style.display = 'block';
        generateQRCode(inviteLink, 'qr-code');
    } else {
        document.getElementById('room-invite-link-item').style.display = 'none';
        document.getElementById('room-qr-code-item').style.display = 'none';
    }

    showModal('room-info-modal');
}

function setupSearch() {
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    
    if (!searchInput || !searchResults) return;
    
    searchInput.addEventListener('input', function(e) {
        const term = e.target.value.toLowerCase().trim();
        
        try {
        document.querySelectorAll('.room-item').forEach(item => {
            const roomNameEl = item.querySelector('.room-name');
            const lastMessageEl = item.querySelector('.room-last-message');
            
            if (roomNameEl && lastMessageEl) {
                const roomName = roomNameEl.textContent.toLowerCase();
                const lastMessage = lastMessageEl.textContent.toLowerCase();
                const isVisible = roomName.includes(term) || lastMessage.includes(term);
                item.style.display = isVisible ? 'flex' : 'none';
            }
        });
        
        if (term.length > 1) {
            searchResults.innerHTML = '';
            
            if (term.includes('qyriptalk/')) {
                const roomInfo = extractRoomIdAndNameFromUrl(term);
                
                if (roomInfo) {
                    const urlItem = document.createElement('div');
                    urlItem.className = 'search-user-item';
                    urlItem.style.backgroundColor = 'var(--invite-color)';
                    urlItem.style.color = 'white';
                    urlItem.innerHTML = `
                        <div class="search-user-avatar" style="background-color: white; color: var(--invite-color);">
                            <i class="fas fa-link"></i>
                        </div>
                        <div class="search-user-info">
                            <div class="search-user-name">${(window.i18n ? window.i18n.t('Davet Odası: ') : 'Davet Odası: ')}${roomInfo.originalName}</div>
                            <div class="search-user-status">${(window.i18n ? window.i18n.t('URL formatı: Qyriptalk/OdaAdı/OdaID') : 'URL formatı: Qyriptalk/OdaAdı/OdaID')}</div>
                        </div>
                    `;
                    urlItem.onclick = () => {
                        joinRoomByInviteUrl(term);
                        searchResults.classList.remove('active');
                        searchInput.value = '';
                    };
                    searchResults.appendChild(urlItem);
                    searchResults.classList.add('active');
                    return;
                }
            }
            
            const matchingRooms = Object.entries(rooms).filter(([roomId, room]) => {
                if (!room || !room.name || !room.name.toLowerCase().includes(term)) return false;
                if (room.isPrivate) {
                    const isOwnerOrMember = room.createdBy === currentUser.uid || joinedRooms.has(roomId);
                    if (!isOwnerOrMember) return false;
                }
                return true;
            }).slice(0, 3);
            
            if (matchingRooms.length > 0) {
                matchingRooms.forEach(([roomId, room]) => {
                    const roomItem = document.createElement('div');
                    roomItem.className = 'search-user-item';
                    roomItem.style.backgroundColor = room.isPrivate ? 'rgba(156, 39, 176, 0.1)' : '';
                    const roomAvatarStyle = room.logo
                        ? `style="background-image: url(${room.logo}); background-size: cover; background-position: center;"`
                        : `style="background-color: ${room.isPrivate ? 'var(--private-color)' : 'var(--primary-color)'};"`;
                    roomItem.innerHTML = `
                        <div class="search-user-avatar" ${roomAvatarStyle}>
                            ${room.logo ? '' : room.name.charAt(0).toUpperCase()}
                        </div>
                        <div class="search-user-info">
                            <div class="search-user-name">${room.name}</div>
                            <div class="search-user-status">${(window.i18n ? window.i18n.t((room.isPrivate ? 'Özel Oda' : 'Herkese Açık Oda')) : (room.isPrivate ? 'Özel Oda' : 'Herkese Açık Oda'))}</div>
                        </div>
                    `;
                    roomItem.onclick = () => {
                        if (room.isPrivate && room.password && !joinedRooms.has(roomId)) {
                            selectedRoomId = roomId;
                            showJoinRoomModal(room);
                        } else {
                            enterRoom(roomId);
                        }
                        searchResults.classList.remove('active');
                        searchInput.value = '';
                    };
                    searchResults.appendChild(roomItem);
                });
            }
            
            const filteredUsers = Object.entries(allUsers)
                .filter(([uid, user]) => 
                    user && user.username && user.username.toLowerCase().includes(term) && 
                    uid !== currentUser.uid
                )
                .slice(0, 5);
            
            if (filteredUsers.length > 0) {
                if (matchingRooms.length > 0) {
                    const userHeader = document.createElement('div');
                    userHeader.className = 'search-user-item';
                    userHeader.style.fontWeight = '600';
                    userHeader.style.color = 'var(--dm-color)';
                    userHeader.style.backgroundColor = 'var(--input-bg-color)';
                    userHeader.textContent = (window.i18n ? window.i18n.t('Kullanıcılar') : 'Kullanıcılar');
                    userHeader.style.cursor = 'default';
                    searchResults.appendChild(userHeader);
                }
                
                filteredUsers.forEach(([uid, user]) => {
                    const userItem = document.createElement('div');
                    userItem.className = 'search-user-item';
                    
                    const avatarLetter = user.username.charAt(0).toUpperCase();
                    const avatarStyle = user.profilePhoto ? 
                        `style="background-image: url(${user.profilePhoto}); background-size: cover; background-position: center;"` : '';
                    
                    userItem.innerHTML = `
                        <div class="search-user-avatar" ${avatarStyle}>${!user.profilePhoto ? avatarLetter : ''}</div>
                        <div class="search-user-info">
                            <div class="search-user-name">${user.username} ${user.role === 'admin' ? '👑' : user.role === 'moderator' ? '⭐' : ''}</div>
                            <div class="search-user-status">${(window.i18n ? window.i18n.t(user.isOnline ? '🟢 Çevrimiçi' : '🔴 Çevrimdışı') : (user.isOnline ? '🟢 Çevrimiçi' : '🔴 Çevrimdışı'))}</div>
                        </div>
                    `;
                    userItem.onclick = () => startDM(uid, user.username);
                    searchResults.appendChild(userItem);
                });
            }
            
            if (matchingRooms.length > 0 || filteredUsers.length > 0) {
                searchResults.classList.add('active');
            }
        } else {
            searchResults.classList.remove('active');
        }
        } catch (err) {
            console.error('[DEBUG] arama fonksiyonunda hata oluştu:', err);
        }
    });
    
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const term = searchInput.value.trim();
            if (term.length > 0) {
                if (term.includes('Qyriptalk/')) {
                    const roomInfo = extractRoomIdAndNameFromUrl(term);
                    if (roomInfo) {
                        joinRoomByInviteUrl(term);
                        searchInput.value = '';
                        searchResults.classList.remove('active');
                        return;
                    }
                }
                
                const roomEntry = Object.entries(rooms).find(([roomId, room]) => {
                    if (!room || !room.name || room.name.toLowerCase() !== term.toLowerCase()) return false;
                    if (room.isPrivate) {
                        const isOwnerOrMember = room.createdBy === currentUser.uid || joinedRooms.has(roomId);
                        if (!isOwnerOrMember) return false;
                    }
                    return true;
                });
                
                if (roomEntry) {
                    const [roomId, room] = roomEntry;
                    selectedRoomId = roomId;
                    
                    if (room.isPrivate) {
                        if (room.password && !joinedRooms.has(roomId)) {
                            showJoinRoomModal(room);
                        } else {
                            joinRoom(room);
                        }
                    } else {
                        joinRoom(room);
                    }
                    searchInput.value = '';
                    searchResults.classList.remove('active');
                    return;
                }
                
                const userEntry = Object.entries(allUsers).find(([uid, user]) => 
                    user && user.username && user.username.toLowerCase() === term.toLowerCase() && 
                    uid !== currentUser.uid
                );
                
                if (userEntry) {
                    const [userId, user] = userEntry;
                    startDM(userId, user.username);
                    searchInput.value = '';
                    searchResults.classList.remove('active');
                    return;
                }
                
                showToast('Bulunamadı', 'Eşleşen oda veya kullanıcı bulunamadı.', 'error');
            }
        }
    });
    
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.classList.remove('active');
        }
    });
}

function loadAllUsers() {
    database.ref('users').on('value', (snapshot) => {
        const usersData = snapshot.val() || {};
        allUsers = usersData;
        cacheUsersForOffline();
        
        Object.keys(allUsers).forEach(uid => {
            const user = allUsers[uid];
            if (user && !user.isOnline && user.lastSeen) {
                const lastSeenDate = new Date(user.lastSeen);
                const now = new Date();
                const diffMs = now - lastSeenDate;
                const diffMins = Math.floor(diffMs / 60000);
                
                if (diffMins < 5) {
                    user.isOnline = true;
                }
            }
        });
        
        if (currentUser && allUsers[currentUser.uid]) {
            const userPhoto = allUsers[currentUser.uid].profilePhoto;
            if (userPhoto) {
                userProfile.profilePhoto = userPhoto;
                updateUserAvatar(userPhoto);
            }
            
            const userBio = allUsers[currentUser.uid].bio;
            if (userBio) {
                userProfile.bio = userBio;
            }
            
            const userRole = allUsers[currentUser.uid].role;
            if (userRole) {
                userProfile.role = userRole;
                updateUserRoleBadge();
            }
        }
        
        updateDMList();
    });
}

// DM önizlemeleri artık önbellek tabanlı ve canlı: her DM için tek bir
// limitToLast(1) dinleyicisi var; yeni mesaj gelince önbellek güncellenir ve
// liste anında yeniden çizilir (eskiden sadece 'users' değişince yenileniyordu
// ve her seferinde tüm DM'ler için .once() sorgusu çekiliyordu).
const dmLastMessageCache = {};
let dmListRebuildScheduled = false;

function scheduleDMListRebuild() {
    if (dmListRebuildScheduled) return;
    dmListRebuildScheduled = true;
    setTimeout(() => {
        dmListRebuildScheduled = false;
        rebuildDMListFromCache();
    }, 0);
}

function rebuildDMListFromCache() {
    if (!currentUser || !currentUser.uid) return;
    const currentUserId = currentUser.uid;
    const list = [];

    Object.entries(allUsers || {}).forEach(([userId, user]) => {
        if (userId === currentUserId || !user) return;
        const dmId = [currentUserId, userId].sort().join('_');
        const cached = dmLastMessageCache[dmId];
        if (!cached) return;
        list.push({
            id: dmId,
            name: user.username,
            userId: userId,
            ts: cached.ts || 0,
            lastMessage: `${cached.sender === currentUser.username ? 'Siz' : cached.sender}: ${cached.text}`
        });
    });

    // En son mesajlaşılan en üstte (WhatsApp mantığı)
    list.sort((a, b) => b.ts - a.ts);

    // Çevrimdışıyken canlı DM verisi yok: boş listeyle önbellekten gelen DM'leri (ve
    // diskteki kopyayı) silme.
    const offlineLike = (window.isOfflineNow && window.isOfflineNow()) || !fbConnected;
    if (offlineLike && list.length === 0 && window.currentDMList && window.currentDMList.length > 0) {
        updateRoomList();
        return;
    }
    window.currentDMList = list;
    if (window.QTCache) QTCache.put('dmList', list);
    updateRoomList();
}

function updateDMList() {
    if (!currentUser || !currentUser.uid) return;

    const currentUserId = currentUser.uid;
    Object.entries(allUsers || {}).forEach(([userId, user]) => {
        if (userId === currentUserId || !user) return;
        const dmId = [currentUserId, userId].sort().join('_');
        // Listener'a eklenip eklenmeyeceği senkron karar verilir (çift bağlamayı önler)
        if (!dmNotifyListenerAttached.has(dmId)) {
            dmNotifyListenerAttached.add(dmId);
            listenToDMNotifications(dmId, user.username, userId);
        }
    });

    // Kullanıcı adı/foto değişiklikleri de listeye yansısın
    scheduleDMListRebuild();
}

// DM mesajları da çevrimdışı okunabilsin: sohbet hiç açılmamış olsa bile her DM'nin
// son mesajları arka planda cihaza yazılır (oda mesajları zaten 'rooms' ağacından geliyor).
const dmPrefetched = new Set();
function cacheDMMessagesForOffline(dmId, lastMsgKey, lastMsg) {
    if (!window.QTCache || !currentUser || !currentUser.uid) return;
    try { if (lastMsgKey && lastMsg) QTCache.saveMessage('dm:' + dmId, lastMsgKey, lastMsg); } catch (e) {}
    if (dmPrefetched.has(dmId)) return;
    dmPrefetched.add(dmId);
    setTimeout(() => {
        database.ref(`privateMessages/${dmId}/messages`).limitToLast(30).once('value').then(snap => {
            const v = snap.val();
            if (v && window.QTCache) QTCache.replaceMessages('dm:' + dmId, v);
        }).catch(() => { dmPrefetched.delete(dmId); });
    }, 2000);
}

function listenToDMNotifications(dmId, dmName, userId) {
    if (dmNotifyHandles[dmId]) return; // çift bağlamayı önle
    const query = database.ref(`privateMessages/${dmId}/messages`).limitToLast(1);

    const cb = (snapshot) => {
        const messages = snapshot.val();
        dmNotifyInitialized.add(dmId);

        if (!messages) {
            delete dmLastMessageCache[dmId];
            scheduleDMListRebuild();
            return;
        }

        const lastMsgKey = Object.keys(messages)[0];
        const lastMsg = messages[lastMsgKey];
        if (!lastMsg) return;

        const lastMessageText = buildMessagePreviewText(lastMsg);

        dmLastMessageCache[dmId] = {
            sender: lastMsg.sender,
            text: lastMessageText,
            ts: typeof lastMsg.timestamp === 'number' ? lastMsg.timestamp : Date.now()
        };
        scheduleDMListRebuild();
        cacheDMMessagesForOffline(dmId, lastMsgKey, lastMsg);

        if (!currentUser) return;
        handleBellForMessage(dmId, lastMsgKey, lastMsg, {
            id: dmId,
            isDM: true,
            name: dmName || 'Özel Mesaj',
            userId: userId,
            sender: lastMsg.sender,
            text: lastMessageText
        });
    };

    dmNotifyHandles[dmId] = { query, cb };
    query.on('value', cb);
}

// EVENT LISTENERS
document.getElementById('show-register-button').addEventListener('click', () => showScreen('register-screen'));
document.getElementById('show-login-button').addEventListener('click', () => showScreen('login-screen'));

document.getElementById('sidebar-logout-btn').addEventListener('click', logoutWithConfirm);

document.getElementById('new-room-btn').addEventListener('click', () => {
    currentRoomType = 'public';
    document.getElementById('public-room-btn').classList.add('active');
    document.getElementById('private-room-btn').classList.remove('active');
    
    document.getElementById('new-room-name-input').value = '';
    document.getElementById('new-room-password-input').value = '';
    resetNewRoomLogoPicker();
    
    showModal('new-room-modal');
});

// ------- Yeni oda oluşturma modalındaki logo seçici -------
let pendingNewRoomLogoFile = null;

function resetNewRoomLogoPicker() {
    pendingNewRoomLogoFile = null;
    const preview = document.getElementById('new-room-logo-preview');
    preview.style.backgroundImage = '';
    preview.classList.remove('has-logo');
    preview.innerHTML = '<i class="fas fa-camera"></i>';
    document.getElementById('new-room-logo-input').value = '';
}

document.getElementById('new-room-logo-btn').addEventListener('click', () => {
    document.getElementById('new-room-logo-input').click();
});

document.getElementById('new-room-logo-preview').addEventListener('click', () => {
    document.getElementById('new-room-logo-input').click();
});

document.getElementById('new-room-logo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast('Hata', 'Sadece görsel dosyaları seçebilirsiniz.', 'error');
        return;
    }

    if (file.size > 5 * 1024 * 1024) {
        showToast('Hata', 'Logo boyutu 5MB\'dan küçük olmalıdır.', 'error');
        return;
    }

    pendingNewRoomLogoFile = file;

    // Yerel önizleme (henüz sunucuya yüklenmedi - oda oluşturulunca yüklenecek)
    const localPreviewUrl = URL.createObjectURL(file);
    const preview = document.getElementById('new-room-logo-preview');
    preview.style.backgroundImage = `url(${localPreviewUrl})`;
    preview.classList.add('has-logo');
    preview.innerHTML = '';
});

document.getElementById('public-room-btn').addEventListener('click', () => {
    currentRoomType = 'public';
    document.getElementById('public-room-btn').classList.add('active');
    document.getElementById('private-room-btn').classList.remove('active');
});

document.getElementById('private-room-btn').addEventListener('click', () => {
    currentRoomType = 'private';
    document.getElementById('private-room-btn').classList.add('active');
    document.getElementById('public-room-btn').classList.remove('active');
});

document.getElementById('cancel-room-btn').addEventListener('click', () => {
    resetNewRoomLogoPicker();
    hideModals();
});
document.getElementById('cancel-join-btn').addEventListener('click', hideModals);
document.getElementById('cancel-profile-btn').addEventListener('click', hideModals);
document.getElementById('cancel-app-settings-btn').addEventListener('click', hideModals);
document.getElementById('close-room-info-btn').addEventListener('click', hideModals);
document.getElementById('close-user-info-btn').addEventListener('click', hideModals);
document.getElementById('close-online-users-btn').addEventListener('click', hideModals);
document.getElementById('close-invite-modal-btn').addEventListener('click', hideModals);

document.getElementById('room-preview-join-btn').addEventListener('click', () => {
    if (currentPreviewRoomId) {
        const room = rooms[currentPreviewRoomId];
        if (room) {
            selectedRoomId = currentPreviewRoomId;
            
            if (room.password && !joinedRooms.has(currentPreviewRoomId)) {
                showJoinRoomModal(room);
            } else {
                joinRoom(room);
            }
        }
    }
    hideRoomPreview();
});

document.getElementById('room-preview-cancel-btn').addEventListener('click', hideRoomPreview);

document.getElementById('image-preview-cancel-btn').addEventListener('click', () => {
    imagePreviewFile = null;
    imagePreviewData = null;
    document.getElementById('image-preview-img').src = '';
    document.getElementById('image-caption-input').value = '';
    hideModals();
});

document.getElementById('image-preview-send-btn').addEventListener('click', () => {
    const caption = document.getElementById('image-caption-input').value;
    sendImageWithCaption(caption);
});

document.getElementById('video-preview-cancel-btn').addEventListener('click', () => {
    videoPreviewFile = null;
    videoPreviewData = null;
    document.getElementById('video-preview-video').src = '';
    document.getElementById('video-caption-input').value = '';
    hideModals();
});

document.getElementById('file-preview-cancel-btn').addEventListener('click', () => {
    filePreviewFile = null;
    filePreviewData = null;
    document.getElementById('file-caption-input').value = '';
    hideModals();
});

document.getElementById('file-preview-send-btn').addEventListener('click', () => {
    const caption = document.getElementById('file-caption-input').value;
    sendFileWithCaption(caption);
});

document.getElementById('video-preview-send-btn').addEventListener('click', () => {
    const caption = document.getElementById('video-caption-input').value;
    sendVideoWithCaption(caption);
});

document.getElementById('copy-invite-link-btn').addEventListener('click', () => {
    const inviteInput = document.getElementById('room-invite-link-input');
    inviteInput.select();
    document.execCommand('copy');
    showToast('Başarılı', 'Davet linki kopyalandı!', 'success');
});

document.getElementById('copy-invite-url-btn').addEventListener('click', () => {
    const inviteInput = document.getElementById('invite-url-input');
    inviteInput.select();
    document.execCommand('copy');
    showToast('Başarılı', 'Davet linki kopyalandı!', 'success');
});

document.getElementById('create-room-btn').addEventListener('click', async () => {
    const roomName = document.getElementById('new-room-name-input').value.trim();
    const roomPassword = document.getElementById('new-room-password-input').value.trim();
    const isPrivate = currentRoomType === 'private';
    
    if (!roomName) {
        showToast('Uyarı', 'Lütfen bir oda adı giriniz.', 'error');
        return;
    }

    // Logo seçildiyse önce kendi sunucumuza yükle, URL'i al.
    let roomLogoUrl = null;
    if (pendingNewRoomLogoFile) {
        try {
            showUploadProgress(pendingNewRoomLogoFile.name);
            const uploadResult = await uploadFileToBackend(pendingNewRoomLogoFile, (pct) => updateUploadProgress(Math.round(pct * 0.9)));
            roomLogoUrl = uploadResult.url;
            updateUploadProgress(100);
            hideUploadProgress();
        } catch (err) {
            hideUploadProgress();
            console.error('Oda logosu yüklenemedi:', err);
            showToast('Uyarı', 'Logo yüklenemedi, oda logosuz oluşturulacak.', 'error');
        }
    }

    database.ref('rooms').once('value').then(snapshot => {
        const existingRooms = snapshot.val() || {};
        const roomExists = Object.values(existingRooms).some(room => room.name === roomName);

        if (roomExists) {
            showToast('Hata', 'Bu isimde bir oda zaten mevcut!', 'error');
        } else {
            const newRoomRef = database.ref('rooms').push();
            const roomData = {
                    name: roomName,
                    password: roomPassword || null,
                    isPrivate: isPrivate,
                    createdBy: currentUser.uid,
                    createdAt: firebase.database.ServerValue.TIMESTAMP
                };
            if (roomLogoUrl) roomData.logo = roomLogoUrl;

            newRoomRef.set(roomData)
                .then(() => {
                    const roomTypeText = (window.i18n ? window.i18n.t((isPrivate ? 'Özel/Gizli' : 'Herkese Açık')) : (isPrivate ? 'Özel/Gizli' : 'Herkese Açık'));
                    showToast('Başarılı', `'${roomName}' ${roomTypeText} odası başarıyla oluşturuldu.`, 'success');
                    hideModals();
                    
                    document.getElementById('new-room-name-input').value = '';
                    document.getElementById('new-room-password-input').value = '';
                    resetNewRoomLogoPicker();
                    
                    selectedRoomId = newRoomRef.key;
                    const newRoom = {
                        name: roomName,
                        isPrivate: isPrivate,
                        password: roomPassword || null,
                        createdBy: currentUser.uid,
                        logo: roomLogoUrl || null
                    };
                    joinRoom(newRoom);
                })
                .catch(error => {
                    showToast('Hata', 'Oda oluşturulurken bir hata oluştu.', 'error');
                    console.error("Oda Oluşturma Hatası:", error);
                });
        }
    });
});

document.getElementById('confirm-join-btn').addEventListener('click', () => {
    const password = document.getElementById('join-room-password-input').value.trim();
    
    if (!selectedRoomId) {
        showToast('Uyarı', 'Lütfen katılmak istediğiniz odayı seçin.', 'error');
        return;
    }
    
    const room = rooms[selectedRoomId];
    if (!room) {
        showToast('Hata', 'Oda bulunamadı.', 'error');
        return;
    }
    
    if (room.password && room.password !== password) {
        showToast('Hata', 'Yanlış şifre!', 'error');
        document.getElementById('join-room-password-input').value = '';
        document.getElementById('join-room-password-input').focus();
        return;
    }

    joinRoom(room);
});

document.getElementById('selection-cancel-btn').addEventListener('click', () => {
    exitSelectionMode();
});

document.getElementById('selection-delete-btn').addEventListener('click', () => {
    bulkDeleteSelectedMessages();
});

document.getElementById('selection-forward-btn').addEventListener('click', () => {
    if (selectedMessageIds.size === 0) {
        showToast('Uyarı', 'Lütfen en az bir mesaj seçin.', 'error');
        return;
    }
    populateForwardRoomList();
    showModal('forward-message-modal');
});

document.getElementById('close-forward-modal-btn').addEventListener('click', () => {
    hideModals();
});

document.getElementById('pinned-message-goto').addEventListener('click', () => {
    if (currentPinnedMessageId) {
        scrollToAndHighlightMessage(currentPinnedMessageId);
    }
});

document.getElementById('pinned-message-unpin-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    unpinMessage();
});

document.getElementById('reply-preview-cancel').addEventListener('click', () => {
    if (editingMessage) {
        const input = document.getElementById('message-input');
        input.value = '';
        input.style.height = 'auto';
        cancelEdit();
    } else {
        cancelReply();
    }
});

document.getElementById('send-button').addEventListener('click', async () => {
    const messageInput = document.getElementById('message-input');
    const messageText = messageInput.value.trim();
    
    if (!messageText || !selectedRoomId) {
        showToast('Uyarı', 'Lütfen bir mesaj yazın.', 'error');
        return;
    }

    if (editingMessage) {
        await saveMessageEdit(messageText);
        return;
    }

    const path = isDmChat 
        ? `privateMessages/${selectedRoomId}/messages`
        : `rooms/${selectedRoomId}/messages`;

    try {
        const replyPayload = buildReplyPayload();
        const newMessageRef = database.ref(path).push();

        // Anında geri bildirim: kutuyu hemen temizle, mesaj yerelde hemen görünür
        messageInput.value = '';
        messageInput.style.height = 'auto';
        cancelReply();

        await setMessageFast(newMessageRef, {
            sender: currentUser.username,
            senderUid: currentUser.uid,
            text: messageText,
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            readBy: {},
            ...(replyPayload ? { replyTo: replyPayload } : {})
        });
        
    } catch (error) {
        messageInput.value = messageText; // başarısızsa metni geri ver
        showToast('Hata', 'Mesaj gönderilirken bir hata oluştu.', 'error');
        console.error("Mesaj Gönderme Hatası:", error);
    }
    
    isTyping = false;
    if (!isDmChat && typingRef) {
        database.ref(`rooms/${selectedRoomId}/typing/${currentUser.uid}`).set(null);
    }
    clearTimeout(typingTimeout);
});

document.getElementById('emoji-input-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const emojiPicker = document.getElementById('emoji-picker');
    emojiPicker.classList.toggle('active');
});

document.getElementById('voice-record-btn').addEventListener('click', () => {
    if (!selectedRoomId) {
        showToast('Uyarı', 'Önce bir sohbete katılın.', 'error');
        return;
    }
    
    resetVoiceRecording();
    showModal('voice-record-modal');
});

document.getElementById('voice-record-start-btn').addEventListener('click', startVoiceRecording);
document.getElementById('voice-record-stop-btn').addEventListener('click', stopVoiceRecording);
document.getElementById('voice-record-cancel-btn').addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopVoiceRecording();
    }
    resetVoiceRecording();
    hideModals();
});
document.getElementById('voice-record-send-btn').addEventListener('click', sendVoiceMessage);

document.getElementById('voice-record-replay-btn').addEventListener('click', () => {
    resetVoiceRecording();
});

// Bir File objesini tipine göre doğru önizleme akışına yönlendirir.
// file-input-btn, panoya yapıştırma (Ctrl+V) ve sürükle-bırak akışlarının
// hepsi bu tek fonksiyonu kullanır.
async function handleIncomingFile(file) {
    if (!file) return;
    if (!selectedRoomId) {
        showToast('Uyarı', 'Önce bir sohbete katılın.', 'error');
        return;
    }

    if (file.type.startsWith('image/')) {
        await showImagePreview(file);
    } else if (file.type.startsWith('video/')) {
        await showVideoPreview(file);
    } else {
        await showFilePreview(file);
    }
}

document.getElementById('file-input-btn').addEventListener('click', () => {
    if (!selectedRoomId) {
        showToast('Uyarı', 'Önce bir sohbete katılın.', 'error');
        return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    // TÜM DOSYA TÜRLERİ kabul edilir - herhangi bir uzantı/tip kısıtlaması yok.
    input.accept = '*/*';
    input.multiple = false;

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        await handleIncomingFile(file);
    };

    input.click();
});

// ------- PANOYA YAPIŞTIRMA (Ctrl+V) İLE MEDYA GÖNDERME -------
// WhatsApp Web'deki gibi: ekran görüntüsü/kopyalanmış görsel veya dosya
// mesaj kutusuna odaklanmışken Ctrl+V ile direkt gönderim akışına düşer.
document.getElementById('message-input').addEventListener('paste', async (e) => {
    if (!e.clipboardData || !e.clipboardData.items) return;
    const items = Array.from(e.clipboardData.items);
    const fileItem = items.find(item => item.kind === 'file');
    if (!fileItem) return; // normal metin yapıştırması - dokunma

    e.preventDefault();
    const file = fileItem.getAsFile();
    if (file) await handleIncomingFile(file);
});

// ------- SÜRÜKLE-BIRAK İLE MEDYA GÖNDERME -------
// Dosyayı doğrudan sohbet alanının üzerine bırakınca da aynı akış çalışır.
(function setupChatDragAndDrop() {
    const dropZone = document.getElementById('messages-container');
    if (!dropZone) return;

    let dragCounter = 0;

    dropZone.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter = Math.max(0, dragCounter - 1);
        if (dragCounter === 0) dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropZone.classList.remove('drag-over');
        if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
        // Şimdilik tek dosya destekleniyor (mevcut önizleme akışı tek dosyalık) - ilkini al.
        await handleIncomingFile(e.dataTransfer.files[0]);
    });
})();

document.getElementById('message-input').addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
    
    if (!currentUser || !selectedRoomId || isDmChat) return;
    
    const path = `rooms/${selectedRoomId}/typing`;
    const userTypingRef = database.ref(`${path}/${currentUser.uid}`);

    if (this.value.length > 0) {
        if (!isTyping) {
            isTyping = true;
            userTypingRef.set({
                username: currentUser.username
            });
        }
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        isTyping = false;
        userTypingRef.set(null);
    }, 3000);
});

document.getElementById('message-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && userProfile.settings.enterToSend) {
        e.preventDefault();
        document.getElementById('send-button').click();
    }
});

document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);

document.getElementById('sidebar-avatar').addEventListener('click', () => {
    updateProfileModal();
    showModal('profile-modal');
});

document.getElementById('upload-photo-btn').addEventListener('click', () => {
    document.getElementById('profile-photo-input').click();
});

document.getElementById('profile-photo-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        if (!file.type.startsWith('image/')) {
            showToast('Hata', 'Sadece görsel dosyaları seçebilirsiniz.', 'error');
            return;
        }
        
        if (file.size > 2 * 1024 * 1024) {
            showToast('Hata', 'Fotoğraf boyutu 2MB\'dan küçük olmalıdır.', 'error');
            return;
        }
        
        uploadProfilePhoto(file);
    }
});

document.getElementById('chat-avatar').addEventListener('click', () => {
    if (isDmChat) {
        showUserInfo();
    } else if (selectedRoomId) {
        showRoomInfo();
    }
});

document.getElementById('online-count-btn').addEventListener('click', showOnlineUsers);

document.getElementById('save-profile-btn').addEventListener('click', () => {
    const newUsername = document.getElementById('profile-username-input').value.trim();
    const bio = document.getElementById('profile-bio-input').value.trim();
    const currentPassword = document.getElementById('profile-current-password').value.trim();
    const newPassword = document.getElementById('profile-new-password').value.trim();
    const confirmPassword = document.getElementById('profile-confirm-password').value.trim();

    if (newUsername && newUsername !== currentUser.username) {
        if (newUsername.length < 3) {
            showToast('Uyarı', 'Kullanıcı adı en az 3 karakter olmalıdır.', 'error');
            return;
        }

        database.ref('users').once('value').then(snapshot => {
            const users = snapshot.val() || {};
            const existingUser = Object.values(users).find(u => u.username === newUsername && u.uid !== currentUser.uid);
            
            if (existingUser) {
                showToast('Hata', 'Bu kullanıcı adı zaten kullanılıyor.', 'error');
            } else {
                database.ref(`users/${currentUser.uid}/username`).set(newUsername)
                    .then(() => {
                        currentUser.username = newUsername;
                        saveUserData();
                        updateUserAvatar(userProfile.profilePhoto || null);
                        showToast('Başarılı', `Kullanıcı adınız ${newUsername} olarak değiştirildi.`, 'success');
                        updateProfileModal();
                    })
                    .catch(error => {
                        showToast('Hata', 'Kullanıcı adı güncellenirken bir hata oluştu.', 'error');
                    });
            }
        });
    }

    if (bio !== userProfile.bio) {
        userProfile.bio = bio;
        database.ref(`users/${currentUser.uid}/bio`).set(bio)
            .then(() => {
                saveUserData();
                showToast('Başarılı', 'Açıklamanız güncellendi.', 'success');
            })
            .catch(error => {
                showToast('Hata', 'Açıklama güncellenirken hata oluştu.', 'error');
            });
    }

    if (currentPassword && newPassword && confirmPassword) {
        if (newPassword.length < 6) {
            showToast('Uyarı', 'Yeni şifre en az 6 karakter olmalıdır.', 'error');
            return;
        }

        if (newPassword !== confirmPassword) {
            showToast('Uyarı', 'Yeni şifreler uyuşmuyor.', 'error');
            return;
        }

        database.ref(`users/${currentUser.uid}`).once('value').then(snapshot => {
            const user = snapshot.val();
            if (user && user.password === currentPassword) {
                database.ref(`users/${currentUser.uid}/password`).set(newPassword)
                    .then(() => {
                        document.getElementById('profile-current-password').value = '';
                        document.getElementById('profile-new-password').value = '';
                        document.getElementById('profile-confirm-password').value = '';
                        showToast('Başarılı', 'Şifreniz başarıyla değiştirildi.', 'success');
                    })
                    .catch(error => {
                        showToast('Hata', 'Şifre güncellenirken bir hata oluştu.', 'error');
                    });
            } else {
                showToast('Hata', 'Mevcut şifre yanlış.', 'error');
            }
        });
    }

    hideModals();
});

document.getElementById('app-settings-btn').addEventListener('click', () => {
    loadAppSettings();
    showModal('app-settings-modal');
});

// ============= DİL (TR/EN) SEÇİMİ =============
if (window.i18n) {
    const langTrBtn = document.getElementById('lang-tr-btn');
    const langEnBtn = document.getElementById('lang-en-btn');

    const setActiveLangBtn = () => {
        const lang = window.i18n.getLang();
        if (langTrBtn) langTrBtn.classList.toggle('active', lang === 'tr');
        if (langEnBtn) langEnBtn.classList.toggle('active', lang === 'en');
    };
    setActiveLangBtn();

    const changeLang = (lang) => {
        if (window.i18n.getLang() === lang) return;
        window.i18n.setLang(lang);
        setActiveLangBtn();
        // Zaten oluşturulmuş dinamik içerikler (oda listesi, aktif sohbet vb.)
        // yeni dilde yeniden çizilsin diye sayfayı kısa bir gecikmeyle yeniliyoruz.
        setTimeout(() => window.location.reload(), 150);
    };

    if (langTrBtn) langTrBtn.addEventListener('click', () => changeLang('tr'));
    if (langEnBtn) langEnBtn.addEventListener('click', () => changeLang('en'));
}

document.getElementById('save-app-settings-btn').addEventListener('click', () => {
    userProfile.settings.enterToSend = document.getElementById('enter-to-send').checked;
    userProfile.settings.showReadReceipts = document.getElementById('show-read-receipts').checked;
    userProfile.settings.autoTranslate = document.getElementById('auto-translate').checked;
    userProfile.settings.messageNotifications = document.getElementById('message-notifications').checked;
    userProfile.settings.soundNotifications = document.getElementById('sound-notifications').checked;
    userProfile.settings.autoTheme = document.getElementById('auto-theme-switch').checked;
    userProfile.settings.compactMode = document.getElementById('compact-mode').checked;

    updateAutoThemeState();
    applyCompactMode();

    database.ref(`users/${currentUser.uid}/settings`).set(userProfile.settings)
        .then(() => {
            saveUserData();
            showToast('Başarılı', 'Ayarlar kaydedildi.', 'success');
            hideModals();
        })
        .catch(error => {
            showToast('Hata', 'Ayarlar kaydedilirken hata oluştu.', 'error');
        });
});

document.getElementById('back-to-menu-btn').addEventListener('click', () => {
    showEmptyChat();
});

// ------- SESLİ ARAMA BUTON OLAYLARI -------
const callBtnEl = document.getElementById('call-btn');
if (callBtnEl) {
    callBtnEl.addEventListener('click', () => {
        if (callState === 'active' || callState === 'outgoing') {
            // zaten aktif görüşme varsa modalı tekrar öne getir
            document.getElementById('call-modal').classList.add('active');
            return;
        }
        startCall();
    });
}

document.getElementById('incoming-call-accept').addEventListener('click', () => {
    acceptIncomingCall();
});

document.getElementById('incoming-call-decline').addEventListener('click', () => {
    declineIncomingCall();
});

document.getElementById('call-end-btn').addEventListener('click', () => {
    leaveCall();
});

document.getElementById('call-mute-btn').addEventListener('click', () => {
    toggleCallMute();
});

document.getElementById('call-speaker-btn').addEventListener('click', function () {
    this.classList.toggle('active-muted');
    const icon = this.querySelector('i');
    icon.className = this.classList.contains('active-muted') ? 'fas fa-volume-mute' : 'fas fa-volume-up';
    Object.values(callRemoteAudioEls).forEach(el => {
        el.muted = this.classList.contains('active-muted');
    });
});

const menuBtn = document.getElementById('menu-btn');
const menuDropdown = document.getElementById('menu-dropdown');

if (menuBtn) {
    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menuDropdown.classList.toggle('active');
        
        const userInfoBtn = document.getElementById('user-info-btn');
        const roomInfoBtn = document.getElementById('room-info-btn');
        const inviteFriendBtn = document.getElementById('invite-friend-btn');
        const roomManageBtn = document.getElementById('room-manage-btn');
        const leaveRoomBtn = document.getElementById('leave-room-btn');
        
        if (isDmChat) {
            userInfoBtn.style.display = 'flex';
            roomInfoBtn.style.display = 'none';
            inviteFriendBtn.style.display = 'none';
            roomManageBtn.style.display = 'none';
            leaveRoomBtn.style.display = 'none';
        } else {
            userInfoBtn.style.display = 'none';
            roomInfoBtn.style.display = 'flex';
            inviteFriendBtn.style.display = 'flex';
            leaveRoomBtn.style.display = selectedRoomId ? 'flex' : 'none';
            
            const currentRoom = rooms[selectedRoomId];
            const isRoomCreator = currentRoom && currentUser && currentRoom.createdBy === currentUser.uid;
            roomManageBtn.style.display = isRoomCreator ? 'flex' : 'none';
        }

        updateMuteNotificationsMenuItem();
    });
}

function updateMuteNotificationsMenuItem() {
    const muteBtn = document.getElementById('mute-notifications-btn');
    if (!muteBtn) return;

    const isMuted = !userProfile.settings.messageNotifications;
    muteBtn.querySelector('i').className = isMuted ? 'fas fa-bell' : 'fas fa-bell-slash';
    muteBtn.querySelector('span').textContent = (window.i18n ? window.i18n.t(isMuted ? 'Bildirimleri Aç' : 'Bildirimleri Sustur') : (isMuted ? 'Bildirimleri Aç' : 'Bildirimleri Sustur'));
}

document.getElementById('user-info-btn').addEventListener('click', () => {
    showUserInfo();
    menuDropdown.classList.remove('active');
});

document.getElementById('room-info-btn').addEventListener('click', () => {
    showRoomInfo();
    menuDropdown.classList.remove('active');
});

document.getElementById('room-manage-btn').addEventListener('click', () => {
    showRoomManageModal();
    menuDropdown.classList.remove('active');
});

document.getElementById('leave-room-btn').addEventListener('click', () => {
    menuDropdown.classList.remove('active');
    leaveRoomAction(selectedRoomId);
});

document.getElementById('cancel-room-manage-btn').addEventListener('click', () => {
    hideModals();
});

document.getElementById('room-manage-upload-logo-btn').addEventListener('click', () => {
    document.getElementById('room-manage-logo-input').click();
});

document.getElementById('room-manage-logo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast('Hata', 'Sadece görsel dosyaları seçebilirsiniz.', 'error');
        return;
    }

    if (file.size > 2 * 1024 * 1024) {
        showToast('Hata', 'Logo boyutu 2MB\'dan küçük olmalıdır.', 'error');
        return;
    }

    if (!selectedRoomId || !rooms[selectedRoomId]) return;

    try {
        showUploadProgress(file.name);

        const uploadResult = await uploadFileToBackend(file, (pct) => updateUploadProgress(Math.round(pct * 0.9)));
        const logoUrl = uploadResult.url;
        updateUploadProgress(95);

        await database.ref(`rooms/${selectedRoomId}/logo`).set(logoUrl);

        rooms[selectedRoomId].logo = logoUrl;

        const avatar = document.getElementById('room-manage-avatar');
        avatar.style.backgroundImage = `url(${logoUrl})`;
        avatar.textContent = '';

        updateRoomAvatarsInUI(selectedRoomId, rooms[selectedRoomId]);

        updateUploadProgress(100);
        setTimeout(() => {
            hideUploadProgress();
            showToast('Başarılı', 'Oda logosu güncellendi.', 'success');
        }, 500);

    } catch (error) {
        hideUploadProgress();
        showToast('Hata', 'Logo yüklenirken hata oluştu.', 'error');
        console.error('Oda logosu yükleme hatası:', error);
    }

    e.target.value = '';
});

document.getElementById('save-room-manage-btn').addEventListener('click', () => {
    if (!selectedRoomId || !rooms[selectedRoomId]) {
        hideModals();
        return;
    }

    const room = rooms[selectedRoomId];
    if (!currentUser || room.createdBy !== currentUser.uid) {
        showToast('Hata', 'Bu odayı sadece kurucusu yönetebilir.', 'error');
        return;
    }

    const newName = document.getElementById('room-manage-name-input').value.trim();
    if (!newName) {
        showToast('Uyarı', 'Lütfen bir oda adı giriniz.', 'error');
        return;
    }

    if (newName === room.name) {
        hideModals();
        return;
    }

    const nameTaken = Object.entries(rooms).some(([id, r]) => id !== selectedRoomId && r.name === newName);
    if (nameTaken) {
        showToast('Hata', 'Bu isimde bir oda zaten mevcut!', 'error');
        return;
    }

    database.ref(`rooms/${selectedRoomId}/name`).set(newName)
        .then(() => {
            rooms[selectedRoomId].name = newName;
            updateRoomAvatarsInUI(selectedRoomId, rooms[selectedRoomId]);
            showToast('Başarılı', 'Oda adı güncellendi.', 'success');
            hideModals();
        })
        .catch(error => {
            showToast('Hata', 'Oda adı güncellenirken hata oluştu.', 'error');
            console.error('Oda adı güncelleme hatası:', error);
        });
});

document.getElementById('room-manage-delete-btn').addEventListener('click', async () => {
    if (!selectedRoomId || !rooms[selectedRoomId]) return;

    const room = rooms[selectedRoomId];
    if (!currentUser || room.createdBy !== currentUser.uid) {
        showToast('Hata', 'Bu odayı sadece kurucusu silebilir.', 'error');
        return;
    }

    const result = await customConfirm(
        'Odayı Sil',
        `'${room.name}' odasını ve tüm mesajlarını kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`,
        {
            icon: 'warning',
            okText: 'Sil',
            cancelText: 'İptal',
            okType: 'danger'
        }
    );

    if (result) {
        const roomIdToDelete = selectedRoomId;

        database.ref(`rooms/${roomIdToDelete}`).remove()
            .then(() => {
                joinedRooms.delete(roomIdToDelete);
                saveUserData();
                hideModals();
                showToast('Başarılı', 'Oda silindi.', 'success');
                showEmptyChat();
            })
            .catch(error => {
                showToast('Hata', 'Oda silinirken hata oluştu.', 'error');
                console.error('Oda silme hatası:', error);
            });
    }
});

document.getElementById('invite-friend-btn').addEventListener('click', () => {
    showInviteFriendModal();
    menuDropdown.classList.remove('active');
});

document.getElementById('clear-chat-btn').addEventListener('click', async () => {
    if (selectedRoomId) {
        const result = await customConfirm(
            'Sohbeti Temizle',
            'Tüm mesajları silmek istediğinize emin misiniz? Bu işlem geri alınamaz.',
            {
                icon: 'warning',
                okText: 'Temizle',
                cancelText: 'İptal',
                okType: 'danger'
            }
        );
        
        if (result) {
            const path = isDmChat 
                ? `privateMessages/${selectedRoomId}/messages`
                : `rooms/${selectedRoomId}/messages`;
            
            database.ref(path).remove()
                .then(() => {
                    showToast('Başarılı', 'Sohbet temizlendi.', 'success');
                    // Temizlik sonrası mesaj listesini güncelle
                    document.getElementById('messages-container').innerHTML = '';
                    lastMessageDate = null;
                    processedMessageIds.clear();
                })
                .catch(error => {
                    showToast('Hata', 'Sohbet temizlenirken hata oluştu.', 'error');
                });
        }
    }
    menuDropdown.classList.remove('active');
});

document.getElementById('export-chat-btn').addEventListener('click', () => {
    if (selectedRoomId) {
        const chatContent = [];
        document.querySelectorAll('.message-wrapper').forEach(msg => {
            const sender = msg.classList.contains('outgoing') ? 'Siz' : 
                         msg.querySelector('.message-sender')?.textContent || (window.i18n ? window.i18n.t('Diğer') : 'Diğer');
            const text = msg.querySelector('.message-text')?.textContent || 
                       msg.querySelector('.file-name')?.textContent || 
                       msg.querySelector('img')?.alt || 'Mesaj';
            const time = msg.querySelector('.message-time')?.textContent || '';
            chatContent.push(`${time} - ${sender}: ${text}`);
        });
        
        const blob = new Blob([chatContent.join('\n')], { type: 'text/plain' });
        saveOrShareFile(blob, `sohbet_${Date.now()}.txt`).then(() => {
            showToast('Başarılı', 'Sohbet dışa aktarıldı.', 'success');
        });
    } else {
        showToast('Uyarı', 'Önce bir sohbet seçin.', 'error');
    }
    menuDropdown.classList.remove('active');
});

document.getElementById('mute-notifications-btn').addEventListener('click', () => {
    userProfile.settings.messageNotifications = !userProfile.settings.messageNotifications;
    userProfile.settings.soundNotifications = userProfile.settings.messageNotifications;

    updateMuteNotificationsMenuItem();

    if (currentUser && currentUser.uid) {
        database.ref(`users/${currentUser.uid}/settings`).set(userProfile.settings)
            .then(() => {
                saveUserData();
                showToast('Bildirimler', `Bildirimler ${userProfile.settings.messageNotifications ? 'açıldı' : 'kapatıldı'}.`, 'success');
            })
            .catch(() => {
                showToast('Hata', 'Bildirim ayarı kaydedilirken hata oluştu.', 'error');
            });
    }

    menuDropdown.classList.remove('active');
});

document.addEventListener('click', () => {
    if (menuDropdown) {
        menuDropdown.classList.remove('active');
    }
});

const notificationsBellBtn = document.getElementById('notifications-bell-btn');
const notificationsDropdown = document.getElementById('notifications-dropdown');

if (notificationsBellBtn && notificationsDropdown) {
    notificationsBellBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        notificationsDropdown.classList.toggle('active');
        if (notificationsDropdown.classList.contains('active')) {
            markAllGlobalNotificationsRead();
        }
    });

    notificationsDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}

const clearAllNotificationsBtn = document.getElementById('clear-all-notifications-btn');
if (clearAllNotificationsBtn) {
    clearAllNotificationsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearAllGlobalNotifications();
    });
}

document.addEventListener('click', () => {
    if (notificationsDropdown) {
        notificationsDropdown.classList.remove('active');
    }
});

window.addEventListener('load', () => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    const icon = document.querySelector('#theme-toggle-btn i');
    if (icon) {
        icon.className = savedTheme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
    }

    setupEmojiPicker();
    setupSearch();

    if (loadUserData()) {
        showScreen('app-screen');
        
        updateUserAvatar(userProfile.profilePhoto || null);
        updateUserRoleBadge();
        
        if (currentUser && currentUser.uid) {
            database.ref(`users/${currentUser.uid}/isOnline`).set(true);
            database.ref(`users/${currentUser.uid}/isOnline`).onDisconnect().set(false);
            database.ref(`users/${currentUser.uid}/lastSeen`).onDisconnect().set(Date.now());
        }

        loadGlobalNotifications();
        loadAllUsers();
        updateRoomList();
        restoreOfflineState();
        syncJoinedRoomsFromServer();
        cacheRoomsForOffline();
        showEmptyChat();
        listenForIncomingCalls();
                identifySocket();
        
        const currentUrl = window.location.href;
        if (currentUrl.includes('Qyriptalk/')) {
            const roomInfo = extractRoomIdAndNameFromUrl(currentUrl);
            if (roomInfo) {
                const roomId = roomInfo.id;
                const roomName = roomInfo.originalName;
                
                showToast('Davet', `${roomName} odasına davet edildiniz!`, 'info');
                
                setTimeout(() => {
                    joinRoomByInviteUrlAndShow(currentUrl);
                }, 1000);
            }
        }
        
        if (window.innerWidth <= 768) {
            showMobileScreen('sidebar');
        }
    } else {
        showScreen('login-screen');
    }
});

database.ref('rooms').on('value', (snapshot) => {
    rooms = snapshot.val() || {};
    updateRoomList();
    cacheRoomsForOffline();
});

window.addEventListener('beforeunload', () => {
    if (currentUser && currentUser.uid) {
        database.ref(`users/${currentUser.uid}/isOnline`).set(false);
        database.ref(`users/${currentUser.uid}/lastSeen`).set(Date.now());
    }
    if (userStatusRef) {
        userStatusRef.set({
            username: currentUser.username,
            online: false
        });
    }
});

document.getElementById('login-button').addEventListener('click', () => {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    
    if (!username || !password) {
        showToast('Uyarı', 'Lütfen kullanıcı adı ve şifre giriniz.', 'error');
        return;
    }

    if (window.isOfflineNow && window.isOfflineNow()) {
        showToast('Hata', 'İnternet bağlantısı yok. Giriş yapmak için internete bağlan.', 'error');
        return;
    }

    database.ref('users').once('value').then(snapshot => {
        const users = snapshot.val() || {};
        const userFound = Object.entries(users).find(([uid, u]) => u.username === username);
        
        if (userFound) {
            const [uid, user] = userFound;
            if (user.password === password) {
                currentUser = {
                    username,
                    uid
                };
                joinedRooms = new Set(); // önceki hesaptan kalan oda listesini temizle
                resetNotificationState(false); // önceki hesabın bildirim durumunu temizle
                saveUserData();
                loadGlobalNotifications();
                
                updateUserAvatar(user.profilePhoto || null);
                
                if (user.role) {
                    userProfile.role = user.role;
                    updateUserRoleBadge();
                }
                
                showScreen('app-screen');
                showToast('Başarılı', `Hoş geldin, ${username}!`, 'success');

                database.ref(`users/${uid}/isOnline`).set(true);
                database.ref(`users/${uid}/isOnline`).onDisconnect().set(false);
                database.ref(`users/${uid}/lastSeen`).onDisconnect().set(Date.now());

                loadProfileSettings();
                loadAllUsers();
                updateRoomList();
                syncJoinedRoomsFromServer();
                listenForIncomingCalls();
                identifySocket();
            } else {
                showToast('Hata', 'Hatalı şifre!', 'error');
            }
        } else {
            showToast('Hata', 'Kullanıcı bulunamadı!', 'error');
        }
    });
});

document.getElementById('register-button').addEventListener('click', () => {
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value.trim();
    
    if (!username || !password) {
        showToast('Uyarı', 'Lütfen kullanıcı adı ve şifre giriniz.', 'error');
        return;
    }

    if (username.length < 3) {
        showToast('Uyarı', 'Kullanıcı adı en az 3 karakter olmalıdır.', 'error');
        return;
    }

    if (password.length < 6) {
        showToast('Uyarı', 'Şifre en az 6 karakter olmalıdır.', 'error');
        return;
    }

    database.ref('users').once('value').then(snapshot => {
        const users = snapshot.val() || {};
        const existingUser = Object.values(users).find(u => u.username === username);
        
        if (existingUser) {
            showToast('Hata', 'Bu kullanıcı adı zaten alınmış!', 'error');
        } else {
            const newUserRef = database.ref('users').push();
            newUserRef.set({
                    username,
                    password,
                    isOnline: true,
                    createdAt: firebase.database.ServerValue.TIMESTAMP,
                    lastSeen: Date.now(),
                    role: 'user'
                })
                .then(() => {
                    currentUser = {
                        username,
                        uid: newUserRef.key
                    };
                    userProfile.role = 'user';
                    updateUserRoleBadge();
                    saveUserData();
                    
                    updateUserAvatar(null);
                    
                    showScreen('app-screen');
                    showToast('Başarılı', `Kayıt başarılı, hoş geldin ${username}!`, 'success');

                    database.ref(`users/${newUserRef.key}/isOnline`).onDisconnect().set(false);
                    database.ref(`users/${newUserRef.key}/lastSeen`).onDisconnect().set(Date.now());
                    
                    loadProfileSettings();
                    loadAllUsers();
                    updateRoomList();
                    syncJoinedRoomsFromServer();
                    listenForIncomingCalls();
                identifySocket();
                })
                .catch(error => {
                    showToast('Hata', 'Kayıt sırasında bir hata oluştu.', 'error');
                    console.error("Kayıt Hatası:", error);
                });
        }
    });
});

console.log("✅ Qyriptalk hazır!");
console.log("✅ Okundu/iletildi tikleri gerçek zamanlı çalışıyor");
console.log("✅ Bildirim sistemi eklendi");
console.log("✅ Çoklu sekme çakışması önlendi");
console.log("✅ Mesajların 2 kez gönderilmesi sorunu çözüldü!");
console.log("✅ Admin/moderator/kullanıcı ayrımı eklendi");
console.log("✅ MyMemory API ile %100 çalışan gerçek çeviri sistemi eklendi (EN->TR)");
console.log("✅ Çevrimiçi kullanıcı bilgileri gerçek zamanlı");
console.log("✅ Modern custom confirm/alert modalları eklendi");