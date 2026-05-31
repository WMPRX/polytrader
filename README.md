# PolyTrader - Polymarket Copy Trading Bot 🚀

PolyTrader, Polymarket platformundaki başarılı ve karlı tahmin piyasası cüzdanlarını (Smart Money / Whales) anlık olarak izleyip, yaptıkları işlemleri belirlediğiniz risk parametrelerine göre otomatik olarak kopyalayan (copy trading) modern bir bot yazılımıdır. 

Gelişmiş ve premium tasarıma sahip **Koyu Tema Web Arayüzü** sayesinde hiçbir kodlama veya blockchain bilgisine ihtiyaç duymadan botu kolayca yönetebilir, cüzdanları takip listenize ekleyebilir, kümülatif P&L grafiklerinizi inceleyebilir ve canlı sunucu aktivitelerini takip edebilirsiniz.

---

## Özellikler 🌟

- **Gerçek Zamanlı Takip (Monitor Engine):** Her 30 saniyede bir cüzdanların zincir üstü hareketlerini sorgular, mükerrer işlemleri engellemek için işlem hash kontrolü yapar.
- **Detaylı Risk Yönetimi (Risk Manager):** Günlük maksimum zarar limiti, tek işlem limitleri, slippage (fiyat sapması) koruması ve cüzdan bazlı kopyalama yüzdeleri.
- **Test / Simülasyon Modu (Güvenli Alan):** Bot varsayılan olarak **Test Modunda** başlar. Gerçek paranızı riske etmeden cüzdan hareketlerini kopyalamayı ve P&L durumlarını izlemeyi simüle edebilirsiniz.
- **Canlı Ön Yüz Paneli (Socket.io):** Tarayıcıyı yenilemeden akan canlı işlem logları, KPI kartları ve anlık P&L zaman serisi çizelgesi (Chart.js).
- **Telegram Entegrasyonu:** Başarılı kopyalama işlemlerinde, başarısız işlemlerde veya kritik hatalarda Telegram adresinize anlık bildirim uyarısı gönderir.
- **SQLite Yerel Veritabanı:** Kurulum gerektirmeyen, dosya tabanlı ultra hızlı ilişkisel veritabanı.

---

## Proje Dosya Yapısı 📁

```text
polytrader/
├── package.json                 # Bağımlılık paketleri ve komutlar
├── .env                         # Özel yapılandırma ve cüzdan anahtarları (Gizli kalmalı)
├── .gitignore                   # Git versiyon kontrolü dışlama listesi
├── README.md                    # Kurulum ve kullanım yönergesi (Bu dosya)
├── server.js                    # Express ve Socket.io sunucu çekirdeği
├── database/
│   └── schema.sql               # SQLite veritabanı tablolarının şeması
├── src/
│   ├── bot/
│   │   ├── monitor.js           # Cüzdan hareketlerini tarama cron yapısı
│   │   ├── copyTrader.js        # Copy trade işleme ve durum yönetimi motoru
│   │   ├── polymarketAPI.js     # Polymarket Data ve CLOB API entegrasyonu
│   │   └── riskManager.js       # Risk limit kontrolleri ve kısıtlamalar
│   ├── services/
│   │   ├── walletService.js     # Takip edilen cüzdan CRUD ve performans servisi
│   │   ├── tradeService.js      # Kopyalanan işlem sorguları ve demo veri tohumlama
│   │   └── notificationService.js # Telegram Bot bildirim servisleri
│   └── routes/
│       ├── api.js               # REST API rotaları ve parametre kontrolleri
│       └── dashboard.js         # Statik HTML arayüz yönlendiricileri
└── public/
    ├── index.html               # Ana Dashboard ekranı
    ├── wallets.html             # Cüzdan takip ve ekleme paneli
    ├── trades.html              # Filtrelenebilir detaylı işlem geçmişi paneli
    ├── settings.html            # Ayarlar, Private Key ve bildirim yönetim paneli
    ├── css/
    │   └── style.css            # Premium Koyu Tema stil kodları
    └── js/
        ├── dashboard.js         # Dashboard websocket ve grafik bağlayıcı
        ├── wallets.js           # Cüzdan yönetim işlemleri
        ├── trades.js            # İşlem listeleme, detay görüntüleme ve CSV aktarıcı
        └── settings.js          # Konfigürasyon kayıtları ve RPC/Telegram testleri
```

---

## Adım Adım Kurulum Kılavuzu 🛠️

Aşağıdaki adımları sırayla takip ederek botu 5 dakika içinde çalışır hale getirebilirsiniz. Kodlama bilgisine ihtiyacınız yoktur.

### 1. Node.js Kurulumu (v20+)
Botun çalışabilmesi için bilgisayarınızda Node.js yüklü olmalıdır.
1. [Node.js Resmi Web Sitesi](https://nodejs.org/tr/) adresine gidin.
2. **LTS** (Önerilen) sürümünü (Örn: v20.x veya üzeri) bilgisayarınıza indirip kurun.

### 2. Gerekli Kütüphanelerin Yüklenmesi
1. Bir komut satırı (CMD / Terminal / PowerShell) penceresi açın.
2. `polytrader` proje klasörüne gidin:
   ```bash
   cd C:\Users\Mehmet\.gemini\antigravity\scratch\polytrader
   ```
3. Gerekli kütüphaneleri yüklemek için aşağıdaki komutu yazın ve Enter'a basın:
   ```bash
   npm install
   ```
   *Bu komut; Ethers.js, Express, SQLite, Socket.io ve diğer paketleri otomatik olarak indirecektir.*

### 3. Yapılandırma Dosyası (.env)
Proje klasöründe yer alan `.env` dosyası sistem yapılandırmalarını barındırır.
1. Dosya içerisindeki ayarları dilerseniz text editör ile açıp inceleyebilirsiniz:
   - `PORT=3000` (Arayüze erişeceğiniz port numarası)
   - `NODE_ENV=development` (Geliştirici modu)
   - `PRIVATE_KEY=` (Canlı işlem yapmak isterseniz Polygon cüzdanınızın 64 haneli özel anahtarı)

### 4. Botu Başlatma
Komut satırından aşağıdaki komutla uygulamayı başlatın:
```bash
npm start
```
Ekranda aşağıdaki gibi bir çıktı göreceksiniz:
```text
==================================================
🚀 PolyTrader Sunucusu Çalışıyor!
🌐 Dashboard: http://localhost:3000
📁 Ortam: development
==================================================
```

### 5. Arayüze Erişim
1. Tarayıcınızı (Chrome, Edge vb.) açın.
2. Adres çubuğuna `http://localhost:3000` yazıp Enter'a basın.
3. Karşınıza **PolyTrader Dashboard** ekranı gelecektir. Arayüzün boş kalmaması için **5 adet örnek kopya işlem** ve **2 adet örnek cüzdan** sistem tarafından otomatik yüklenmiştir.

---

## Kullanım Yönergeleri 🎯

### 🛡️ Test Modu (Simülasyon)
Bot ilk başladığında varsayılan olarak **Test Modundadır**. Bu modda, takip listenizdeki cüzdanlar Polymarket'ta işlem yaptığında bot bunu yakalar, cüzdanınızdaki bakiyeye dokunmadan ve blockchain'e göndermeden işlemi veritabanında başarıyla kopyalanmış gibi simüle eder. P&L performanslarını ve loglarını risksiz bir şekilde izleyebilirsiniz.

### ⚡ Canlı Mod (Live Trading)
Gerçek fonlarla kopyalama yapmak istediğinizde:
1. **Ayarlar** sayfasına gidin.
2. Cüzdan Bağlantısı bölümünden Polygon cüzdanınızın **Private Key (Özel Anahtarı)** bilgisini girin ve bağlantıyı test edin. (Cüzdanınızda kopyalama yapabilecek miktarda **USDC** ve işlem ücretleri (gas fee) için çok az miktarda **MATIC/POL** bulunmalıdır).
3. Tehlikeli Alan bölümündeki **USDC Harcama Onayı (Approve)** butonuna tıklayarak kontrata harcama yetkisi verin (Bu işlem bir kereye mahsus blockchain üzerinde onaylanır).
4. Risk Yönetimi bölümünden **Test Modu (Simülasyon)** seçeneğini kapatın ve **Ayarları Kaydet** butonuna tıklayın.

### 👥 Cüzdan İzleme Listesi Ekleme
1. **Cüzdan Yönetimi** sayfasına gidin.
2. Sağ üstteki **Cüzdan Ekle** butonuna tıklayın.
3. Takip etmek istediğiniz Polymarket kullanıcısının cüzdan adresini, bir takma adı ve kopya limitlerini girip kaydedin. Bot 30 saniye içinde bu cüzdanı taramaya başlayacaktır.

---

## Güvenlik ve Risk Uyarıları ⚠️

> [!WARNING]
> - **Private Key Güvenliği:** Bot özel anahtarınızı kesinlikle internete veya uzak bir sunucuya göndermez. Tamamen sizin yerel bilgisayarınızda saklanır. `.env` dosyanızı ve veritabanı dosyalarınızı asla başkalarıyla paylaşmayın.
> - **Finansal Risk:** Tahmin piyasaları yüksek oranda oynaklık ve risk barındırır. Takip ettiğiniz cüzdanlar her zaman kazançlı işlemler yapmayabilir veya kayba uğrayabilirler. Bu bot sadece eğitim ve otomasyon kolaylığı sağlayan bir araçtır; yatırım tavsiyesi içermez.
> - **Slippage Toleransı:** Hızlı fiyat hareketlerinde, izlenen cüzdanın işlem yaptığı fiyat ile sizin botunuzun emri ilettiği anki fiyat farklılık gösterebilir. Ayarlar sayfasındaki **Slippage Toleransı** (Varsayılan %5) bu sapmayı sınırlandırarak sizi korur.
