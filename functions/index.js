const { onValueCreated, onValueDeleted } = require('firebase-functions/v2/database');
const admin = require('firebase-admin');

const DB_URL = 'https://qyriptalk-cdf56-default-rtdb.europe-west1.firebasedatabase.app';
admin.initializeApp({ databaseURL: DB_URL });
const db = admin.database();

// Fonksiyonlar veritabanıyla aynı bölgede olmalı
const OPTS = { region: 'europe-west1', instance: 'qyriptalk-cdf56-default-rtdb' };

const DEAD = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'];

async function tokensFor(uid) {
  const s = await db.ref(`fcmTokens/${uid}`).get();
  return s.exists() ? Object.keys(s.val()) : [];
}

async function notificationsEnabled(uid) {
  const s = await db.ref(`users/${uid}/settings/messageNotifications`).get();
  return s.val() !== false;
}

async function send(uid, data, ttlMs) {
  const tokens = await tokensFor(uid);
  if (!tokens.length) return;
  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    data,
    android: { priority: 'high', ttl: ttlMs },
  });
  const dead = [];
  res.responses.forEach((r, i) => {
    if (!r.success && r.error && DEAD.includes(r.error.code)) dead.push(tokens[i]);
  });
  await Promise.all(dead.map((t) => db.ref(`fcmTokens/${uid}/${t}`).remove()));
}

function describe(msg) {
  if (msg.text && String(msg.text).trim()) return String(msg.text);
  if (msg.type === 'voice') return '🎤 Sesli mesaj';
  if (msg.type === 'image') return '📷 Fotoğraf' + (msg.caption ? ': ' + msg.caption : '');
  if (msg.type === 'file') return '📎 ' + (msg.fileName || 'Dosya');
  return 'Yeni mesaj';
}

// ---- Oda mesajı ----
exports.onRoomMessage = onValueCreated(
  { ...OPTS, ref: '/rooms/{roomId}/messages/{msgId}' },
  async (event) => {
    const msg = event.data.val();
    if (!msg || !msg.senderUid) return;
    const { roomId, msgId } = event.params;

    const [usersSnap, roomSnap] = await Promise.all([
      db.ref(`rooms/${roomId}/users`).get(),
      db.ref(`rooms/${roomId}`).get(),
    ]);
    const room = roomSnap.val() || {};
    const members = new Set(Object.keys(usersSnap.val() || {}));
    if (room.createdBy) members.add(room.createdBy);
    members.delete(msg.senderUid);

    const data = {
      type: 'message',
      convKey: `room:${roomId}`,
      path: `rooms/${roomId}/messages`,
      room: '1',
      title: String(room.name || 'Oda'),
      sender: String(msg.sender || 'Qyriptalk'),
      text: describe(msg),
      ts: String(msg.timestamp || Date.now()),
      msgKey: msgId,
    };
    await Promise.all(
      [...members].map(async (uid) => {
        if (!(await notificationsEnabled(uid))) return;
        await send(uid, data, 24 * 3600 * 1000);
      })
    );
  }
);

// ---- Özel mesaj ----
exports.onPrivateMessage = onValueCreated(
  { ...OPTS, ref: '/privateMessages/{dmId}/messages/{msgId}' },
  async (event) => {
    const msg = event.data.val();
    if (!msg || !msg.senderUid) return;
    const { dmId, msgId } = event.params;

    let other = null;
    if (dmId.startsWith(msg.senderUid + '_')) other = dmId.slice(msg.senderUid.length + 1);
    else if (dmId.endsWith('_' + msg.senderUid)) other = dmId.slice(0, dmId.length - msg.senderUid.length - 1);
    if (!other) return;
    if (!(await notificationsEnabled(other))) return;

    const sender = String(msg.sender || 'Qyriptalk');
    await send(
      other,
      {
        type: 'message',
        convKey: `dm:${dmId}`,
        path: `privateMessages/${dmId}/messages`,
        room: '0',
        title: sender,
        sender,
        text: describe(msg),
        ts: String(msg.timestamp || Date.now()),
        msgKey: msgId,
      },
      24 * 3600 * 1000
    );
  }
);

// ---- Gelen arama ----
exports.onCallInvite = onValueCreated(
  { ...OPTS, ref: '/callInvites/{uid}/{callId}' },
  async (event) => {
    const invite = event.data.val() || {};
    const { uid, callId } = event.params;
    const isRoom = invite.type === 'room';
    const caller = String(invite.callerName || 'Qyriptalk');
    await send(
      uid,
      {
        type: 'call',
        callId,
        title: isRoom ? String(invite.title || 'Oda') : caller,
        text: isRoom ? `${caller} grup araması başlattı` : 'Sesli arıyor...',
      },
      45 * 1000
    );
  }
);

// ---- Arama bitti / cevaplandı / arayan vazgeçti -> zil bildirimini kapat ----
exports.onCallInviteRemoved = onValueDeleted(
  { ...OPTS, ref: '/callInvites/{uid}/{callId}' },
  async (event) => {
    const { uid, callId } = event.params;
    await send(uid, { type: 'call_end', callId }, 60 * 1000);
  }
);
