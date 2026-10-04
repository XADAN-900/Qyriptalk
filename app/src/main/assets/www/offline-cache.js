// ============================================================================
// ÇEVRİMDIŞI ÖNBELLEK (IndexedDB)
// İnternet yokken de eski mesajlar okunabilsin diye odalar, kullanıcılar,
// DM listesi ve mesajlar cihazda saklanır. Firebase'e hiç dokunmaz; sadece
// script.js'in verdiği veriyi yazar/okur.
// ============================================================================
(function () {
    const DB_NAME = 'qt-offline';
    const STORE = 'kv';
    const MAX_MSGS_PER_CHAT = 200;     // sohbet başına saklanan en fazla mesaj
    const MAX_FIELD_CHARS = 1500000;   // bundan büyük tek alanlar (dev base64) saklanmaz
    const FLUSH_DELAY = 800;

    let dbPromise = null;
    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            try {
                const req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = () => req.result.createObjectStore(STORE);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            } catch (e) { reject(e); }
        });
        return dbPromise;
    }

    function idbGet(key) {
        return openDb().then(db => new Promise((resolve) => {
            try {
                const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
                r.onsuccess = () => resolve(r.result);
                r.onerror = () => resolve(undefined);
            } catch (e) { resolve(undefined); }
        })).catch(() => undefined);
    }

    function idbSet(key, value) {
        return openDb().then(db => new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(value, key);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
                tx.onabort = () => resolve(false);
            } catch (e) { resolve(false); }
        })).catch(() => false);
    }

    function idbDelete(key) {
        return openDb().then(db => new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).delete(key);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            } catch (e) { resolve(false); }
        })).catch(() => false);
    }

    function uid() {
        try { return (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || null; } catch (e) { return null; }
    }
    // Hesaba özel anahtar: başka hesapla girince eski hesabın verisi görünmesin
    function nsKey(k) {
        const u = uid();
        return u ? (u + '::' + k) : null;
    }

    // ---- localStorage yedeği (sadece küçük listeler: odalar / kullanıcılar / DM listesi) ----
    // IndexedDB bir sebepten açılmazsa liste yine de çevrimdışı görünsün.
    const LS_PREFIX = 'qtc:';
    const LS_MAX_CHARS = 1500000;
    function lsMirrorSet(key, value) {
        try {
            const json = JSON.stringify(value, (k, v) => (typeof v === 'string' && v.length > 2000 ? undefined : v));
            if (json && json.length <= LS_MAX_CHARS) localStorage.setItem(LS_PREFIX + key, json);
        } catch (e) { /* kota doldu vb. – sorun değil, IndexedDB asıl kaynak */ }
    }
    function lsMirrorGet(key) {
        try {
            const raw = localStorage.getItem(LS_PREFIX + key);
            return raw ? JSON.parse(raw) : undefined;
        } catch (e) { return undefined; }
    }
    function lsMirrorClear() {
        try {
            const del = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.indexOf(LS_PREFIX) === 0) del.push(k);
            }
            del.forEach(k => localStorage.removeItem(k));
        } catch (e) {}
    }

    // ---- Basit anahtar/değer (debounce'lu yazım) ----
    const pending = {};   // key -> { timer, getValue, mirror }
    function runPending(key) {
        const p = pending[key];
        if (!p) return;
        clearTimeout(p.timer);
        delete pending[key];
        let v;
        try { v = p.getValue(); } catch (e) { return; }
        idbSet(key, v);
        if (p.mirror) lsMirrorSet(key, v);
    }
    function scheduleWrite(key, getValue, mirror) {
        if (pending[key]) clearTimeout(pending[key].timer);
        pending[key] = { getValue, mirror: !!mirror, timer: setTimeout(() => runPending(key), FLUSH_DELAY) };
    }
    // Uygulama arka plana gidince / kapanırken bekleyen yazımları hemen diske at
    // (swipe ile kapatılınca 800 ms'lik gecikme yüzünden önbellek hiç yazılmıyordu).
    function flushPending() { Object.keys(pending).forEach(runPending); }
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushPending(); });
    window.addEventListener('pagehide', flushPending);

    function putValue(name, value) {
        const key = nsKey(name);
        if (!key) return;
        scheduleWrite(key, () => value, true);
    }

    function getValue(name) {
        const key = nsKey(name);
        if (!key) return Promise.resolve(undefined);
        return idbGet(key).then(v => (v !== undefined ? v : lsMirrorGet(key)));
    }

    // ---- Mesajlar: sohbet başına { msgKey: msg } ----
    const msgMem = {};      // chatKey -> { msgKey: msg }   (bellekteki kopya)
    const msgLoad = {};     // chatKey -> Promise (diskten ilk yükleme)
    const msgFinger = {};   // chatKey -> parmak izi (gereksiz yazımı önler)

    function sanitizeMsg(msg) {
        if (!msg || typeof msg !== 'object') return msg;
        const out = {};
        for (const k in msg) {
            const v = msg[k];
            if (typeof v === 'string' && v.length > MAX_FIELD_CHARS) continue;
            out[k] = v;
        }
        return out;
    }

    function ensureLoaded(chatKey) {
        if (msgMem[chatKey]) return Promise.resolve(msgMem[chatKey]);
        if (!msgLoad[chatKey]) {
            msgLoad[chatKey] = getValue('msgs::' + chatKey).then(stored => {
                // yükleme sürerken eklenenleri ez(me): bellekteki varsa onu koru
                msgMem[chatKey] = Object.assign({}, stored || {}, msgMem[chatKey] || {});
                return msgMem[chatKey];
            });
        }
        return msgLoad[chatKey];
    }

    function trimmed(map) {
        const entries = Object.entries(map);
        if (entries.length <= MAX_MSGS_PER_CHAT) return map;
        entries.sort((a, b) => ((a[1] && a[1].timestamp) || 0) - ((b[1] && b[1].timestamp) || 0));
        const keep = entries.slice(entries.length - MAX_MSGS_PER_CHAT);
        const res = {};
        keep.forEach(([k, v]) => { res[k] = v; });
        return res;
    }

    function flushMessages(chatKey) {
        const key = nsKey('msgs::' + chatKey);
        if (!key) return;
        scheduleWrite(key, () => {
            msgMem[chatKey] = trimmed(msgMem[chatKey] || {});
            return msgMem[chatKey];
        });
    }

    function saveMessage(chatKey, msgKey, msg) {
        if (!uid() || !chatKey || !msgKey || !msg) return;
        const clean = sanitizeMsg(msg);
        ensureLoaded(chatKey).then(map => {
            map[msgKey] = clean;
            flushMessages(chatKey);
        });
    }

    function removeMessage(chatKey, msgKey) {
        if (!uid() || !chatKey || !msgKey) return;
        ensureLoaded(chatKey).then(map => {
            if (msgKey in map) {
                delete map[msgKey];
                flushMessages(chatKey);
            }
        });
    }

    // Bir odanın tüm (son N) mesajını sunucudan gelen veriyle yeniler.
    function replaceMessages(chatKey, messagesObj) {
        if (!uid() || !chatKey) return;
        const keys = Object.keys(messagesObj || {});
        if (!keys.length) return;
        const lastKey = keys[keys.length - 1];
        const last = messagesObj[lastKey] || {};
        const finger = keys.length + '|' + lastKey + '|' + (last.editedAt || '') + '|' + (last.text || '').length;
        if (msgFinger[chatKey] === finger) return;
        msgFinger[chatKey] = finger;

        const entries = keys.map(k => [k, messagesObj[k]]).filter(e => e[1] && typeof e[1] === 'object');
        entries.sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));
        const keep = entries.slice(Math.max(0, entries.length - MAX_MSGS_PER_CHAT));
        const map = {};
        keep.forEach(([k, v]) => { map[k] = sanitizeMsg(v); });
        msgMem[chatKey] = map;
        msgLoad[chatKey] = Promise.resolve(map);
        flushMessages(chatKey);
    }

    function getMessages(chatKey) {
        return ensureLoaded(chatKey).then(map => Object.assign({}, map));
    }

    // ---- Çıkışta bu hesabın önbelleğini sil ----
    function clearAll() {
        return openDb().then(db => new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).clear();
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            } catch (e) { resolve(false); }
        })).catch(() => false).then(() => {
            lsMirrorClear();
            Object.keys(pending).forEach(k => { clearTimeout(pending[k].timer); delete pending[k]; });
            Object.keys(msgMem).forEach(k => delete msgMem[k]);
            Object.keys(msgLoad).forEach(k => delete msgLoad[k]);
            Object.keys(msgFinger).forEach(k => delete msgFinger[k]);
        });
    }

    // ---- Çevrimdışı durumu ----
    // Android tarafı (MainActivity) gerçek internet kontrolünü yapıp bunu set eder.
    window.__qtOffline = false;
    window.isOfflineNow = function () {
        return window.__qtOffline === true || navigator.onLine === false;
    };

    window.QTCache = {
        put: putValue,
        get: getValue,
        saveMessage,
        removeMessage,
        replaceMessages,
        getMessages,
        clearAll,
        _del: (name) => { const k = nsKey(name); return k ? idbDelete(k) : Promise.resolve(); }
    };
})();

// ============================================================================
// KIRMIZI "İNTERNET BAĞLANTISI YOK" ŞERİDİ
// Her ekranda, internet yokken en üstte görünür. Sadece tek satır yazı var.
// Android (MainActivity) da aynı şeridi koyar; aynı id kullanıldığı için çift olmaz.
// ============================================================================
(function () {
    const ID = 'qt-offline-banner';
    function build() {
        const e = document.createElement('div');
        e.id = ID;
        e.textContent = 'İnternet bağlantısı yok';
        e.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;' +
            'background:#d32f2f;color:#fff;text-align:center;font:600 14px sans-serif;' +
            'padding:8px;padding-top:max(8px,env(safe-area-inset-top));pointer-events:none';
        return e;
    }
    function update() {
        if (!document.body) return;
        const el = document.getElementById(ID);
        if (window.isOfflineNow()) {
            if (!el) document.body.appendChild(build());
        } else if (el) {
            el.remove();
        }
        // Şerit varken sayfa içeriği ve bildirimler (toast) şeridin altından başlasın
        const cur = document.getElementById(ID);
        document.documentElement.classList.toggle('has-offline-banner', !!cur);
        document.documentElement.style.setProperty('--banner-h', cur ? cur.offsetHeight + 'px' : '0px');
    }
    window.__updateOfflineBanner = update;
    window.addEventListener('offline', update);
    window.addEventListener('online', update);
    document.addEventListener('DOMContentLoaded', update);
    setInterval(update, 2000);
    update();
})();
