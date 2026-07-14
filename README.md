# Syncology Desktop — Rust + Tauri v2 + React
> Aplikasi manajemen tugas tim berbasis akuntabilitas poin, deteksi ghosting, dan kolaborasi terdesentralisasi.

Proyek ini adalah hasil migrasi aplikasi manajer tugas desktop dari Python (PySide6) ke **Rust** dan **Tauri v2** dengan frontend modern **React (Vite + Vanilla CSS)**. Seluruh logika cloud (Firebase Cloud Functions) telah didelegasikan secara lokal ke Rust backend untuk kemudahan deployment dan keandalan sistem.

---

## ⚡ Prasyarat Sistem (Prerequisites)

Sebelum menjalankan atau membangun (*build*) aplikasi ini, pastikan mesin Anda telah terpasang dependensi berikut:

### 1. Node.js & npm
* Rekomendasi: **Node.js v18.0.0+** atau **v20.0.0+** beserta `npm`.
* Periksa versi: `node -v` dan `npm -v`.

### 2. Rust Toolchain (Cargo & rustc)
* Rekomendasi: **Rust 1.75.0+** (stable channel).
* Pasang Rust via Rustup:
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```
* Muat ulang terminal Anda, lalu verifikasi: `rustc --version` dan `cargo --version`.

### 3. Dependensi Sistem Operasi (OS-Specific)

#### A. Linux (Fedora / Red Hat)
Karena Tauri menggunakan WebKit untuk merender antarmuka HTML/CSS, jalankan perintah berikut untuk memasang paket development:
```bash
sudo dnf install webkit2gtk4.1-devel curl wget file perl-FindBin librsvg2-devel libappindicator-gtk3-devel
```

#### B. Linux (Debian / Ubuntu)
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

#### C. macOS (macOS 10.15+)
Pastikan Xcode Command Line Tools telah terpasang:
```bash
xcode-select --install
```

#### D. Windows (Windows 10 / 11)
1. Pasang [Microsoft Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (pilih beban kerja "Desktop development with C++").
2. Pastikan [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) terpasang (bawaan pada Windows 11).

---

## 🚀 Panduan Instalasi & Setup Proyek

### 1. Masuk ke Folder Proyek
Buka terminal dan navigasikan ke direktori root Tauri:
```bash
cd tauri_app
```

### 2. Instal Dependensi Frontend (npm)
Jalankan instalasi paket Node.js untuk React dan Vite:
```bash
npm install
```

### 3. Konfigurasi Environment Firebase (`.env.local`)
Aplikasi memerlukan integrasi database Firebase Firestore. Buat file bernama `.env.local` di root direktori proyek (`tauri_app/.env.local`) dan isi dengan konfigurasi aplikasi Firebase Anda:

```env
# Kredensial Firebase Console (Project Settings -> Your Apps -> Web SDK Setup)
VITE_FIREBASE_API_KEY=YOUR_API_KEY
VITE_FIREBASE_AUTH_DOMAIN=YOUR_PROJECT_ID.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET=YOUR_PROJECT_ID.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=YOUR_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID=YOUR_APP_ID

# Gunakan emulator lokal (true/false)
VITE_USE_EMULATOR=false

```

---

## 🏃 Cara Menjalankan Aplikasi (Mode Development)

Gunakan perintah di bawah ini untuk mengompilasi frontend React dan backend Rust secara bersamaan. Aplikasi akan terbuka di jendela desktop Tauri dengan fitur *hot-reload* aktif:

```bash
npm run tauri dev
```
*Catatan: Kompilasi pertama kali akan memakan waktu beberapa menit karena Rust harus mengunduh dan menyusun crate dependency di background.*

---

## 📦 Cara Membangun Bundel Rilis (Production Build)

Untuk menghasilkan file eksekusi (*installer*) native desktop yang terkompresi dan siap pakai (.deb, .rpm, .msi, .dmg, atau AppImage):

```bash
npm run tauri build
```
File installer rilis hasil kompilasi akan otomatis disimpan di:
`tauri_app/src-tauri/target/release/bundle/`

---

## 🗺️ Gambaran Arsitektur & Logika Sistem

Aplikasi ini beroperasi tanpa bergantung pada Firebase Cloud Functions di sisi server. Rust backend bertindak sebagai **API Engine lokal** yang memproses logika secara internal dan menyimpannya langsung ke Cloud Firestore:

* **OAuth Google**: Ditangani secara loopback menggunakan server HTTP mikro **Axum** lokal (port `8484`) untuk menangkap callback token Google dari browser secara aman.
* **Sistem Nudge**: Divalidasi langsung di Rust (batas 3 kali sehari per anggota). Nudge yang sukses akan menulis data ke koleksi `rooms/{roomId}/nudges` dan menambahkan `+2` poin ke member pengirim.
* **Submit & Review Bukti**: Memilih reviewer secara acak di backend Rust, memproses status tugas menjadi `under_review`, dan mendistribusikan poin tugas ke profil member penerima secara instan ketika disetujui (*Approve*).
* **Ghost Pool & Rescue**: Mengeskalasi tugas telat ke level `3` dan mendukung pengambilalihan tugas (*Rescue*) dengan bonus poin **+50%** (`ceil(weight * 1.5)`).

---

## 📂 Struktur Penting Proyek
* `src-tauri/src/commands/api.rs`: Handler perintah tauri yang dipanggil dari frontend.
* `src-tauri/src/database/manager.rs`: Logika internal database, manajemen data poin, nudges, dan tasks.
* `src/styles/index.css`: Pusat aturan layout visual flat dengan palet warna Geist.
* `src/components/`: Berisi tab aplikasi dan modal konfirmasi interaktif.
