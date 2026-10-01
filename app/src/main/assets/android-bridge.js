(function () {
  if (!window.QyripAndroid || window.__qyripBridgeInstalled) return;
  window.__qyripBridgeInstalled = true;

  // 1) Web Notification API -> Android bildirimi
  function QNotification(title, opts) {
    opts = opts || {};
    try {
      QyripAndroid.showNotification(String(title || ''), String(opts.body || ''), String(opts.tag || 'message'));
    } catch (e) {}
    this.close = function () {};
  }
  QNotification.permission = 'granted';
  QNotification.requestPermission = function (cb) {
    if (typeof cb === 'function') cb('granted');
    return Promise.resolve('granted');
  };
  window.Notification = QNotification;

  function wrapAfter(name, after) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () {
      var r = orig.apply(this, arguments);
      try { after.apply(this, arguments); } catch (e) {}
      return r;
    };
  }

  // 2) Gelen arama -> zil sesli Android bildirimi (Cevapla / Reddet)
  wrapAfter('showIncomingCallUI', function (callId, invite) {
    if (typeof incomingCallData !== 'undefined' && incomingCallData && incomingCallData.callId === callId) {
      var isRoom = invite && invite.type === 'room';
      var title = isRoom ? (invite.title || 'Oda') : ((invite && invite.callerName) || 'Qyriptalk');
      var text = isRoom ? ((invite.callerName || '') + ' grup araması başlattı') : 'Sesli arıyor...';
      QyripAndroid.incomingCall(String(callId), String(title), String(text));
    }
  });
  wrapAfter('hideIncomingCallUI', function () { QyripAndroid.cancelCall(); });

  // 3) Görüşme sırasında mikrofon arka planda da çalışsın
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
