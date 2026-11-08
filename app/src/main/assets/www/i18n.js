// ============================================================
// QYRIPTALK - DİL (i18n) SİSTEMİ
// ============================================================
// Uygulama varsayılan olarak Türkçe'dir. Bu dosya, kullanıcının
// Uygulama Ayarları'ndan seçtiği dile göre arayüzü (ve script.js
// içinde t()/tf() ile sarmalanmış dinamik metinleri) İngilizce'ye
// çevirir. Sohbet mesajları, oda adları, kullanıcı adları gibi
// KULLANICI VERİLERİ asla bu sistem tarafından değiştirilmez.
// ============================================================

(function () {
    'use strict';

    const STORAGE_KEY = 'qyriptalk_lang';

    // ---- Statik metin sözlüğü (TR anahtar -> EN değer) ----
    // data-i18n="Aynı metin" olan HTML elemanları ile, script.js
    // içindeki t('...') çağrıları bu sözlüğe bakar.
    const DICT = {
        // Genel / auth
        "Qyriptalk": "Qyriptalk",
        "Güvenli ve hızlı mesajlaşma platformu": "Secure and fast messaging platform",
        "Kullanıcı Adı": "Username",
        "Şifre": "Password",
        "Giriş Yap": "Log In",
        "Hesabın yok mu?": "Don't have an account?",
        "Kayıt Ol": "Sign Up",
        "Güvenli bağlantı | SSL Şifreleme": "Secure connection | SSL Encryption",
        "Yeni hesap oluştur": "Create a new account",
        "Kullanıcı Adı (min. 3 karakter)": "Username (min. 3 characters)",
        "Şifre (min. 6 karakter)": "Password (min. 6 characters)",
        "Zaten hesabın var mı?": "Already have an account?",
        "Ücretsiz | Sınırsız mesaj": "Free | Unlimited messages",

        // Sidebar / genel arayüz
        "Profil Ayarları": "Profile Settings",
        "Bildirimler": "Notifications",
        "Uygulama Ayarları": "App Settings",
        "Tema Değiştir": "Toggle Theme",
        "Çıkış Yap": "Log Out",
        "Odaları ara, kullanıcı bul veya davet URL'si yapıştır...": "Search rooms, find users, or paste an invite URL...",
        "Yeni Oda Oluştur": "Create New Room",
        "Hoş Geldiniz!": "Welcome!",
        "Bir sohbet odası seçerek mesajlaşmaya başlayabilirsiniz. Sol taraftan mevcut odaları görebilir ve yeni bir oda oluşturabilirsiniz.":
            "Select a chat room to start messaging. You can see existing rooms on the left and create a new one.",
        "Özel mesajlaşmak için üstteki arama kutusundan kullanıcı arayabilirsiniz.":
            "You can search for a user in the search box above to start a private chat.",
        "Davet URL'sini arama kutusuna yapıştırarak odaya katılabilirsiniz.":
            "Paste an invite URL into the search box to join a room.",
        "Ana Menüye Dön": "Back to Menu",
        "Kullanıcı Bilgileri": "User Info",
        "Sohbet Odası": "Chat Room",
        "Özel Mesaj": "Private Message",
        "Ara": "Call",
        "Menü": "Menu",
        "Emoji Ekle": "Add Emoji",
        "Dosya Ekle": "Add File",
        "Mesajınızı yazın...": "Type your message...",
        "Sesli Mesaj": "Voice Message",
        "Gönder": "Send",
        "Sık Kullanılan": "Frequently Used",
        "Yüzler": "Faces",
        "Nesneler": "Objects",

        // Oda önizleme kartı
        "Oda Adı": "Room Name",
        "Herkese Açık Oda": "Public Room",
        "Kurucu:": "Creator:",
        "Üye Sayısı:": "Member Count:",
        "Mesaj Sayısı:": "Message Count:",
        "Durum:": "Status:",
        "Odaya Katıl": "Join Room",
        "Kapat": "Close",

        // Yeni oda modalı
        "Yeni Oda Oluştur ": "Create New Room ",
        "Herkese Açık": "Public",
        "Herkes görebilir ve katılabilir": "Everyone can see and join",
        "Özel/Gizli": "Private/Hidden",
        "Sadece linki bilenler katılabilir": "Only those with the link can join",
        "Şifre (isteğe bağlı)": "Password (optional)",
        "İptal": "Cancel",
        "Oluştur": "Create",

        // Odaya katıl modalı
        "Odaya Katıl ": "Join Room ",
        "Oda Şifresi": "Room Password",
        "Katıl": "Join",

        // Profil ayarları
        "Fotoğraf Değiştir": "Change Photo",
        "Kullanıcı": "User",
        "Çevrimiçi": "Online",
        "Fotoğraf Yükle": "Upload Photo",
        "Kişisel Bilgiler": "Personal Info",
        "Yeni kullanıcı adı": "New username",
        "Açıklama (Bio)": "Bio",
        "Kendinizi tanıtın...": "Tell us about yourself...",
        "Şifre Değiştir": "Change Password",
        "Mevcut Şifre": "Current Password",
        "Mevcut Şifreniz": "Your current password",
        "Yeni Şifre": "New Password",
        "Yeni Şifre Tekrar": "Confirm New Password",
        "Yeni Şifre tekrar": "Confirm new password",
        "Kaydet": "Save",

        // Oda bilgileri modalı
        "Oda Bilgileri": "Room Info",
        "Kuruluş Tarihi": "Creation Date",
        "Oda Tipi": "Room Type",
        "Şifre Durumu": "Password Status",
        "Çevrimiçi Üyeler": "Online Members",
        "Toplam Mesaj": "Total Messages",
        "Davet Linki": "Invite Link",
        "Bu linki paylaşarak diğer kullanıcıları odaya davet edebilirsiniz.": "Share this link to invite other users to the room.",
        "QR Kod": "QR Code",
        "QR kodu tarayarak odaya katılabilirsiniz": "Scan the QR code to join the room",

        // Kişi bilgileri modalı
        "Kişi Bilgileri": "Contact Info",
        "Katılma Tarihi": "Join Date",
        "Açıklama bulunmuyor": "No bio available",
        "Son Görülme": "Last Seen",
        "Rol": "Role",

        // Çevrimiçi kullanıcılar modalı
        "Çevrimiçi Kullanıcılar": "Online Users",

        // Uygulama ayarları
        "Görünüm": "Appearance",
        "Otomatik Tema": "Automatic Theme",
        "Kompakt Mod": "Compact Mode",
        "Sohbet Ayarları": "Chat Settings",
        "Enter ile Gönder": "Send with Enter",
        "Okundu Bilgisi": "Read Receipts",
        "Otomatik Çeviri": "Auto Translate",
        "Mesaj Bildirimleri": "Message Notifications",
        "Ses Bildirimleri": "Sound Notifications",
        "Kilit ekranında mesajı göster": "Show messages on lock screen",
        "Gelen mesajları sesli oku": "Read incoming messages aloud",
        "Telefon bildirim ayarları": "Phone notification settings",
        "Bildirimler kapalı": "Notifications are off",
        "Aç": "Open",
        "Bildirimi dene": "Test notification",
        "Dene": "Try",
        "Dil / Language": "Dil / Language",

        // Arkadaş davet et
        "Arkadaş Davet Et": "Invite a Friend",
        "Bu odanın davet linkini arkadaşlarınızla paylaşarak onları sohbete davet edebilirsiniz.":
            "Share this room's invite link with your friends to invite them to the chat.",
        "Davet Linki:": "Invite Link:",
        "Bu linki kopyalayıp arkadaşlarınızla paylaşın.": "Copy this link and share it with your friends.",
        "Linki Kopyala": "Copy Link",

        // Ses kaydı modalı
        "Sesli Mesaj Kaydı": "Voice Message Recording",
        "Kayıt başlatmak için mikrofon butonuna basılı tutun": "Hold the microphone button to start recording",
        "Kaydı Başlat": "Start Recording",
        "Durdur": "Stop",
        "Tekrar Kayıt": "Record Again",

        // Görsel / video / dosya önizleme
        "Görsel Önizleme": "Image Preview",
        "Önizleme": "Preview",
        "Görsel için açıklama ekleyin (isteğe bağlı)": "Add a caption for the image (optional)",
        "Video Önizleme": "Video Preview",
        "Video için açıklama ekleyin (isteğe bağlı)": "Add a caption for the video (optional)",
        "Dosya Önizleme": "File Preview",
        "Dosya için açıklama ekleyin (isteğe bağlı)": "Add a caption for the file (optional)",

        // Oda yönetimi modalı
        "Odayı Yönet": "Manage Room",
        "Logo Değiştir": "Change Logo",
        "Oda logosu tüm üyelere görünür": "Room logo is visible to all members",
        "Logo Yükle": "Upload Logo",
        "Oda Bilgileri ": "Room Info ",
        "Oda adı": "Room name",
        "Oda Kullanıcılarını Yönet": "Manage Room Users",
        "Tehlikeli Bölge": "Danger Zone",
        "Odayı silmek tüm mesajları ve oda verilerini kalıcı olarak kaldırır. Bu işlem geri alınamaz.":
            "Deleting the room permanently removes all messages and room data. This action cannot be undone.",
        "Odayı Sil": "Delete Room",

        // Bildirimler dropdown
        "Tümünü Temizle": "Clear All",
        "Henüz bildirim yok": "No notifications yet",

        // Menü dropdown
        "Oda Bilgileri  ": "Room Info  ",
        "Sohbeti Temizle": "Clear Chat",
        "Sohbeti Dışa Aktar": "Export Chat",
        "Bildirimleri Sustur": "Mute Notifications",
        "Odadan Ayrıl": "Leave Room",

        // Onay/uyarı modalları
        "Onay Gerekli": "Confirmation Required",
        "Bu işlemi gerçekleştirmek istediğinize emin misiniz?": "Are you sure you want to do this?",
        "Hayır": "No",
        "Evet": "Yes",
        "Bilgilendirme": "Information",
        "Bu bir bilgilendirme mesajıdır.": "This is an informational message.",
        "Tamam": "OK",

        // Arama
        "Bilinmeyen": "Unknown",
        "Sesli arıyor...": "Calling...",
        "Görüşme Devam Ediyor": "Call in Progress",
        "Çalıyor...": "Ringing...",
        "Sessize Al": "Mute",
        "Görüşmeyi Sonlandır": "End Call",
        "Hoparlör": "Speaker",

        // showToast / customAlert / customConfirm başlıkları
        "Uyarı": "Warning",
        "Hata": "Error",
        "Bilgi": "Info",
        "Başarılı": "Success",
        "Davet": "Invite",
        "Bulunamadı": "Not Found",
        "Çeviri Hatası": "Translation Error",

        // Dinamik olmayan showToast/alert/confirm mesajları
        "Zaten devam eden bir görüşme var.": "There is already an ongoing call.",
        "Kullanıcı bulunamadı.": "User not found.",
        "Odada aranacak başka kullanıcı yok.": "There is no other user in the room to call.",
        "Mikrofona erişilemedi. Lütfen izin verin.": "Couldn't access the microphone. Please grant permission.",
        "Arama başlatılamadı (veritabanı izin hatası).": "Couldn't start the call (database permission error).",
        "Arama karşı tarafa ulaştırılamadı (izin hatası). Firebase Database Rules ayarlarını kontrol edin.":
            "The call couldn't reach the other party (permission error). Check your Firebase Database Rules settings.",
        "Kimse yanıt vermedi.": "No one answered.",
        "Görüşmeye katılınamadı (veritabanı izin hatası).": "Couldn't join the call (database permission error).",
        "Çeviri yapılamadı, internet bağlantınızı kontrol edin.": "Translation failed, please check your internet connection.",
        "Başarıyla çıkış yapıldı.": "Logged out successfully.",
        "Oda bulunamadı.": "Room not found.",
        "Bu özellik sadece odalar için geçerlidir.": "This feature is only available for rooms.",
        "Otomatik tema açıkken manuel değiştirme kullanılamaz.": "Manual switching isn't available while automatic theme is on.",
        "Profil fotoğrafı güncellendi.": "Profile photo updated.",
        "Fotoğraf yüklenirken hata oluştu.": "An error occurred while uploading the photo.",
        "Bu odaya erişiminiz kısıtlanmış.": "Your access to this room has been restricted.",
        "Bu odaya erişiminiz kısıtlandı.": "Your access to this room has been restricted.",
        "Geçersiz davet URL'si.": "Invalid invite URL.",
        "Geçersiz davet URL'si. Format: Qyriptalk/OdaAdı/OdaID": "Invalid invite URL. Format: Qyriptalk/RoomName/RoomID",
        "Çeviri yapılamadı": "Translation failed",
        "Mesaj silme için giriş yapmalısınız.": "You must be logged in to delete messages.",
        "Mesaj bulunamadı.": "Message not found.",
        "Sadece kendi mesajlarınızı silebilirsiniz.": "You can only delete your own messages.",
        "Mesaj silindi.": "Message deleted.",
        "Mesaj silinirken bir hata oluştu.": "An error occurred while deleting the message.",
        "Mesaj kontrol edilirken hata oluştu.": "An error occurred while checking the message.",
        "Mikrofon erişimi reddedildi.": "Microphone access was denied.",
        "Maksimum kayıt süresi (5 dakika) doldu.": "Maximum recording time (5 minutes) reached.",
        "Önce bir ses kaydı yapın.": "Please record a voice message first.",
        "Sesli mesaj gönderildi.": "Voice message sent.",
        "Sesli mesaj gönderilirken bir hata oluştu.": "An error occurred while sending the voice message.",
        "Önce bir sohbete katılın.": "Please join a chat first.",
        "Görsel boyutu 10MB'dan küçük olmalıdır.": "Image size must be smaller than 10MB.",
        "Görsel yüklenirken bir hata oluştu.": "An error occurred while uploading the image.",
        "Önce bir görsel seçin.": "Please select an image first.",
        "Görsel gönderildi.": "Image sent.",
        "Görsel gönderilirken bir hata oluştu.": "An error occurred while sending the image.",
        "Video boyutu 50MB'dan küçük olmalıdır.": "Video size must be smaller than 50MB.",
        "Video yüklenirken bir hata oluştu.": "An error occurred while uploading the video.",
        "Önce bir video seçin.": "Please select a video first.",
        "Video gönderildi.": "Video sent.",
        "Video gönderilirken bir hata oluştu.": "An error occurred while sending the video.",
        "Dosya boyutu 25MB'dan küçük olmalıdır.": "File size must be smaller than 25MB.",
        "Dosya yüklenirken bir hata oluştu.": "An error occurred while uploading the file.",
        "Önce bir dosya seçin.": "Please select a file first.",
        "Dosya gönderildi.": "File sent.",
        "Dosya gönderilirken bir hata oluştu.": "An error occurred while sending the file.",
        "Bu özellik sadece özel mesajlar için geçerlidir.": "This feature is only available for private messages.",
        "Kullanıcı bilgileri yüklenemedi.": "Couldn't load user info.",
        "Bu odayı sadece kurucusu yönetebilir.": "Only the room's creator can manage it.",
        "Bu odayı sadece kurucusu silebilir.": "Only the room's creator can delete it.",
        "Kullanıcı çıkarılırken hata oluştu.": "An error occurred while removing the user.",
        "Yasak kaldırılırken hata oluştu.": "An error occurred while lifting the ban.",
        "Kullanıcı yasaklanırken hata oluştu.": "An error occurred while banning the user.",
        "Eşleşen oda veya kullanıcı bulunamadı.": "No matching room or user found.",
        "Davet linki kopyalandı!": "Invite link copied!",
        "Lütfen bir oda adı giriniz.": "Please enter a room name.",
        "Bu isimde bir oda zaten mevcut!": "A room with this name already exists!",
        "Oda oluşturulurken bir hata oluştu.": "An error occurred while creating the room.",
        "Lütfen katılmak istediğiniz odayı seçin.": "Please select the room you want to join.",
        "Yanlış şifre!": "Wrong password!",
        "Lütfen bir mesaj yazın.": "Please type a message.",
        "Mesaj gönderilirken bir hata oluştu.": "An error occurred while sending the message.",
        "Sadece görsel dosyaları seçebilirsiniz.": "You can only select image files.",
        "Fotoğraf boyutu 2MB'dan küçük olmalıdır.": "Photo size must be smaller than 2MB.",
        "Kullanıcı adı en az 3 karakter olmalıdır.": "Username must be at least 3 characters.",
        "Bu kullanıcı adı zaten kullanılıyor.": "This username is already in use.",
        "Açıklamanız güncellendi.": "Your bio was updated.",
        "Açıklama güncellenirken hata oluştu.": "An error occurred while updating the bio.",
        "Yeni şifre en az 6 karakter olmalıdır.": "New password must be at least 6 characters.",
        "Yeni şifreler uyuşmuyor.": "New passwords don't match.",
        "Şifreniz başarıyla değiştirildi.": "Your password was changed successfully.",
        "Şifre güncellenirken bir hata oluştu.": "An error occurred while updating the password.",
        "Mevcut şifre yanlış.": "Current password is wrong.",
        "Ayarlar kaydedildi.": "Settings saved.",
        "Ayarlar kaydedilirken hata oluştu.": "An error occurred while saving settings.",
        "Logo boyutu 2MB'dan küçük olmalıdır.": "Logo size must be smaller than 2MB.",
        "Oda logosu güncellendi.": "Room logo updated.",
        "Logo yüklenirken hata oluştu.": "An error occurred while uploading the logo.",
        "Oda adı güncellendi.": "Room name updated.",
        "Oda adı güncellenirken hata oluştu.": "An error occurred while updating the room name.",
        "Oda silindi.": "Room deleted.",
        "Oda silinirken hata oluştu.": "An error occurred while deleting the room.",
        "Sohbet temizlendi.": "Chat cleared.",
        "Sohbet temizlenirken hata oluştu.": "An error occurred while clearing the chat.",
        "Sohbet dışa aktarıldı.": "Chat exported.",
        "Önce bir sohbet seçin.": "Please select a chat first.",
        "Lütfen kullanıcı adı ve şifre giriniz.": "Please enter a username and password.",
        "Hatalı şifre!": "Incorrect password!",
        "Kullanıcı bulunamadı!": "User not found!",
        "Şifre en az 6 karakter olmalıdır.": "Password must be at least 6 characters.",
        "Bu kullanıcı adı zaten alınmış!": "This username is already taken!",
        "Kayıt sırasında bir hata oluştu.": "An error occurred during registration.",
        "Tüm mesajları silmek istediğinize emin misiniz? Bu işlem geri alınamaz.": "Are you sure you want to delete all messages? This action cannot be undone.",
        "Hesabınızdan çıkış yapmak istediğinize emin misiniz?": "Are you sure you want to log out of your account?",
        "Bu mesajı silmek istediğinize emin misiniz?": "Are you sure you want to delete this message?",
        "Bu mesajı sil": "Delete this message",

        // Yanıtlama (reply) özelliği
        "Yanıtla": "Reply",
        "Vazgeç": "Cancel",
        "Siz": "You",
        "Fotoğraf": "Photo",
        "Video": "Video",
        "Dosya": "File",
        "Sesli mesaj": "Voice message",
        "Orijinal mesaj bulunamadı": "Original message not found",
        "İletildi": "Forwarded",
        "düzenlendi": "edited",
        "Mesajı Düzenle": "Edit Message",
        "Sadece metin mesajları düzenlenebilir.": "Only text messages can be edited.",
        "Kopyala": "Copy",
        "Sabitle": "Pin",
        "Sabitlemeyi Kaldır": "Unpin",
        "Düzenle": "Edit",
        "Mesajları Seç": "Select Messages",
        "seçildi": "selected",
        "İlet": "Forward",
        "Mesajları İlet": "Forward Messages",
        "İletilecek odayı seçin:": "Choose a room to forward to:",
        "İletilecek oda veya kişiyi seçin:": "Choose a room or person to forward to:",
        "İletilecek başka oda yok.": "No other room to forward to.",
        "İletilecek kimse veya oda yok.": "No one or room to forward to.",
        "Odalar": "Rooms",

        // customConfirm okText/cancelText/title kısa etiketleri
        "Mesajı Sil": "Delete Message",
        "Sil": "Delete",
        "Kullanıcıyı Çıkar": "Remove User",
        "Çıkar": "Remove",
        "Kullanıcıyı Yasakla": "Ban User",
        "Yasakla": "Ban",
        "Yasağı Kaldır": "Unban",
        "Temizle": "Clear",

        // Kullanıcı rolleri / durum etiketleri
        "Admin": "Admin",
        "Moderatör": "Moderator",
        "👑 Admin": "👑 Admin",
        "⭐ Moderatör": "⭐ Moderator",
        "Diğer": "Other",
        "Kullanıcılar": "Users",
        "Bilinmiyor": "Unknown",
        "Katıldınız": "Joined",
        "Katılmadınız": "Not Joined",
        "Özel/Gizli Oda": "Private Room",
        "Özel Oda": "Private Room",
        "Henüz mesaj yok": "No messages yet",
        "Şifreli": "Password Protected",
        "Şifresiz": "No Password",
        "Davet ile katıldınız": "Joined via invite",

        // Ses kaydı durum metinleri
        "Kayıt yapılıyor...": "Recording...",
        "Kayıt tamamlandı.": "Recording complete.",

        // Boş / yükleniyor durumları
        "Henüz bir sohbetiniz yok. Yeni oda oluşturun veya üstteki arama kutusuyla oda/kullanıcı arayın.":
            "You don't have any chats yet. Create a new room or search for a room/user with the search box above.",
        "Yükleniyor...": "Loading...",
        "Odada başka üye yok.": "There are no other members in the room.",
        "QR kod oluşturulamadı": "Couldn't generate QR code",

        // Arama daveti / çağrı bildirimi
        "Kabul Et": "Accept",
        "Reddet": "Decline",
        "Görüşme": "Call",
        "Oda": "Room",
        "Sen": "You",
        "Bağlanıyor...": "Connecting...",

        // Oda önizleme / durum
        "Şifre ile Katıl": "Join with Password",
        "Odaya Git": "Go to Room",

        // Tema
        "Otomatik tema aktifken manuel değiştirme kapalı": "Manual switching is disabled while automatic theme is on",

        // Mesaj aksiyonları
        "İndir": "Download",
        "Türkçe'ye Çevir": "Translate to Turkish",

        // Bildirim sustur/aç
        "Bildirimleri Aç": "Unmute Notifications",

        // Çevrimiçi/çevrimdışı (emoji + metin birlikte kullanılan tam metinler)
        "🟢 Çevrimiçi": "🟢 Online",
        "🔴 Çevrimdışı": "🔴 Offline",
        "(Siz)": "(You)",
        "Davet Odası: ": "Invite Room: ",
        "URL formatı: Qyriptalk/OdaAdı/OdaID": "URL format: Qyriptalk/RoomName/RoomID",
    };

    const REVERSE_DICT = {};
    Object.keys(DICT).forEach((k) => { REVERSE_DICT[DICT[k]] = k; });

    // ---- Dinamik (interpolasyonlu) metinler için desenler ----
    // Her desen: TR metni yakalayan regex + EN karşılığını üreten fonksiyon.
    const PATTERNS = [
        [/^(\d+) kişiye arama daveti gönderilemedi\.$/, (m) => `Could not send a call invite to ${m[1]} people.`],
        [/^(.+) odasına davet edildiniz!$/, (m) => `You've been invited to the room "${m[1]}"!`],
        [/^(.+) odasına katıldınız!$/, (m) => `You joined the room "${m[1]}"!`],
        [/^(.+) ile özel mesajlaşma başlatıldı$/, (m) => `Started a private chat with ${m[1]}`],
        [/^'(.+)' odasından ayrılmak istediğinize emin misiniz\?$/, (m) => `Are you sure you want to leave the room "${m[1]}"?`],
        [/^'(.+)' odasından ayrıldınız\.$/, (m) => `You left the room "${m[1]}".`],
        [/^(.+) odadan çıkarıldı\.$/, (m) => `${m[1]} was removed from the room.`],
        [/^(.+) kullanıcısının yasağı kaldırıldı\.$/, (m) => `${m[1]}'s ban was lifted.`],
        [/^(.+) yasaklandı ve odadan çıkarıldı\.$/, (m) => `${m[1]} was banned and removed from the room.`],
        [/^'(.+)' (Herkese Açık|Özel\/Gizli) odası başarıyla oluşturuldu\.$/, (m) => `The ${m[2] === 'Herkese Açık' ? 'public' : 'private'} room "${m[1]}" was created successfully.`],
        [/^Kullanıcı adınız (.+) olarak değiştirildi\.$/, (m) => `Your username was changed to ${m[1]}.`],
        [/^Hoş geldin, (.+)!$/, (m) => `Welcome, ${m[1]}!`],
        [/^Kayıt başarılı, hoş geldin (.+)!$/, (m) => `Registration successful, welcome ${m[1]}!`],
        [/^Bildirimler (açıldı|kapatıldı)\.$/, (m) => `Notifications ${m[1] === 'açıldı' ? 'turned on' : 'turned off'}.`],
        [/^(.+) kullanıcısını odadan çıkarmak istediğinize emin misiniz\?$/, (m) => `Are you sure you want to remove ${m[1]} from the room?`],
        [/^(.+) kullanıcısını yasaklamak istediğinize emin misiniz\? Yasaklı kullanıcılar odaya tekrar giremez\.$/, (m) => `Are you sure you want to ban ${m[1]}? Banned users cannot rejoin the room.`],
        [/^'(.+)' odasını ve tüm mesajlarını kalıcı olarak silmek istediğinize emin misiniz\? Bu işlem geri alınamaz\.$/, (m) => `Are you sure you want to permanently delete the room "${m[1]}" and all its messages? This action cannot be undone.`],
        [/^"(.+)" odasına katılmak için şifre girin:$/, (m) => `Enter the password to join the room "${m[1]}":`],
        [/^(.+) ile DM başlat$/, (m) => `Start a DM with ${m[1]}`],
        [/^Çevrimiçi \((\d+)\)$/, (m) => `Online (${m[1]})`],
        [/^Çevrimdışı \((\d+)\)$/, (m) => `Offline (${m[1]})`],
        [/^(\d+) çevrimiçi \/ (\d+) üye$/, (m) => `${m[1]} online / ${m[2]} members`],
        [/^(\d+) çevrimiçi$/, (m) => `${m[1]} online`],
        [/^(\d+) çevrimdışı$/, (m) => `${m[1]} offline`],
        [/^(\d+) dakika önce$/, (m) => `${m[1]} minutes ago`],
        [/^(\d+) saat önce$/, (m) => `${m[1]} hours ago`],
        [/^(\d+) gün önce$/, (m) => `${m[1]} days ago`],
        [/^(.+) yazıyor\.\.\.$/, (m) => `${m[1]} is typing...`],
        [/^(.+) grup araması başlattı$/, (m) => `${m[1]} started a group call`],
        [/^(\d+) kişi aranıyor\.\.\.$/, (m) => `Calling ${m[1]} people...`],
        [/^(\d+) üye$/, (m) => `${m[1]} members`],
        [/^(\d+) mesaj$/, (m) => `${m[1]} messages`],
        [/^(.+) ile DM başlat \(Çevrimdışı\)$/, (m) => `Start a DM with ${m[1]} (Offline)`],
    ];

    // ---- Dil durumu ----
    let currentLang = localStorage.getItem(STORAGE_KEY) || 'tr';

    function getLang() {
        return currentLang;
    }

    function getLocale() {
        return currentLang === 'en' ? 'en-US' : 'tr-TR';
    }

    // Tek yönlü çeviri: script.js içindeki dinamik metinler için kullanılır.
    // Kaynak metin HER ZAMAN Türkçedir; dil 'en' ise İngilizce döner.
    function t(text) {
        if (currentLang !== 'en' || typeof text !== 'string') return text;
        if (Object.prototype.hasOwnProperty.call(DICT, text)) return DICT[text];
        for (const [regex, fn] of PATTERNS) {
            const m = text.match(regex);
            if (m) return fn(m);
        }
        return text;
    }

    // İki yönlü çeviri: statik HTML elemanlarını (data-i18n) uygularken
    // kullanılır. `original` her zaman elemanın Türkçe kaynak metnidir.
    function applyStatic(original) {
        if (currentLang === 'en' && Object.prototype.hasOwnProperty.call(DICT, original)) {
            return DICT[original];
        }
        return original;
    }

    function translateDOM() {
        document.documentElement.lang = currentLang;

        document.querySelectorAll('[data-i18n]').forEach((el) => {
            const key = el.getAttribute('data-i18n');
            el.textContent = applyStatic(key);
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
            const key = el.getAttribute('data-i18n-placeholder');
            el.setAttribute('placeholder', applyStatic(key));
        });
        document.querySelectorAll('[data-i18n-title]').forEach((el) => {
            const key = el.getAttribute('data-i18n-title');
            el.setAttribute('title', applyStatic(key));
        });

        document.querySelectorAll('.lang-option').forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-lang') === currentLang);
        });
    }

    function setLang(lang) {
        currentLang = lang === 'en' ? 'en' : 'tr';
        localStorage.setItem(STORAGE_KEY, currentLang);
        translateDOM();
        // script.js tarafındaki ekranlar (oda listesi, aktif sohbet vb.)
        // dili değiştirdiğimizde yeniden çizilsin diye bir olay yayınlıyoruz.
        document.dispatchEvent(new CustomEvent('qyriptalk:langchange', { detail: { lang: currentLang } }));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', translateDOM);
    } else {
        translateDOM();
    }

    window.i18n = { t, getLang, getLocale, setLang, translateDOM };
})();
