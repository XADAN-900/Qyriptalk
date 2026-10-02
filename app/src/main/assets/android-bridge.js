(function () {
  if (!window.QyripAndroid || window.__qyripBridgeInstalled) return;
  window.__qyripBridgeInstalled = true;

  // 1) Web Notification API: izin hep "granted"; mesaj bildirimlerini artık Android tarafı üretiyor
  function QNotification() { this.close = function () {}; }
  QNotification.permission = 'granted';
  QNotification.requestPermission = function (cb) {
    if (typeof cb === 'function') cb('granted');
    return Promise.resolve('granted');
  };
  window.Notification = QNotification;

  // 2) Giriş bilgisini Android'e ilet (uygulama kapalıyken yerel dinleyici bu kullanıcı için çalışır)
  var lastSession = '';
  function syncSession() {
    try {
      var u = JSON.parse(localStorage.getItem('currentUser') || 'null');
      var p = JSON.parse(localStorage.getItem('userProfile') || 'null');
      if (u && u.uid) {
        var on = !(p && p.settings && p.settings.messageNotifications === false);
        var sig = u.uid + '|' + (u.username || '') + '|' + on;
        if (sig !== lastSession) {
          lastSession = sig;
          QyripAndroid.setSession(String(u.uid), String(u.username || ''), on);
        }
      } else if (lastSession !== 'none') {
        lastSession = 'none';
        QyripAndroid.clearSession();
      }
    } catch (e) {}
  }
  syncSession();
  setInterval(syncSession, 4000);

  function wrapAfter(name, after) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () {
      var r = orig.apply(this, arguments);
      try { after.apply(this, arguments); } catch (e) {}
      return r;
    };
  }

  // 3) Gelen arama -> zil sesli Android bildirimi (Cevapla / Reddet)
  wrapAfter('showIncomingCallUI', function (callId, invite) {
    if (typeof incomingCallData !== 'undefined' && incomingCallData && incomingCallData.callId === callId) {
      var isRoom = invite && invite.type === 'room';
      var title = isRoom ? (invite.title || 'Oda') : ((invite && invite.callerName) || 'Qyriptalk');
      var text = isRoom ? ((invite.callerName || '') + ' grup araması başlattı') : 'Sesli arıyor...';
      QyripAndroid.incomingCall(String(callId), String(title), String(text));
      // Uygulama kapalıyken bildirimden "Cevapla"ya basıldıysa otomatik cevapla
      if (QyripAndroid.consumePendingAccept()) {
        setTimeout(function () {
          if (typeof acceptIncomingCall === 'function') acceptIncomingCall();
        }, 400);
      }
    }
  });
  wrapAfter('hideIncomingCallUI', function () { QyripAndroid.cancelCall(); });

  // 4) Görüşme sırasında mikrofon arka planda da çalışsın
  if (typeof window.callGetLocalStream === 'function') {
    var origGet = window.callGetLocalStream;
    window.callGetLocalStream = function () {
      var p = origGet.apply(this, arguments);
      Promise.resolve(p).then(function () {
        try { QyripAndroid.setInCall(true); } catch (e) {}
      }, function () {});
      return p;
    };
  }
  wrapAfter('leaveCall', function () { QyripAndroid.setInCall(false); });
})();
