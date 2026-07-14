# Panduan Diagnosis & Pemecahan Masalah Build — Syncology Desktop
> Dokumen ini membantu Anda mendiagnosis dan menyelesaikan masalah saat menjalankan `npm run tauri dev` atau `npm run tauri build` di laptop/mesin baru.

Aplikasi Syncology dibangun menggunakan **Tauri v2 (Rust)** sebagai backend dan **React (TS/Vite)** sebagai frontend. Karena Tauri melakukan kompilasi native ke binary OS, ada beberapa dependensi sistem operasi yang wajib dipasang agar kompilasi berhasil.

---

## 🛠️ 1. Checklist Kebutuhan Minimum (Semua OS)

Pastikan langkah-langkah dasar berikut sudah terpenuhi di laptop baru:

1. **Salin File `.env.local`**: File `.env.local` diabaikan oleh Git. Salin file `.env.local` dari laptop lama ke direktori `tauri_app/` di laptop baru. Tanpa ini, inisialisasi Firebase akan gagal di backend Rust.
2. **Gunakan Versi Node.js LTS**: Pastikan menggunakan Node.js versi **v18**, **v20**, atau **v22**. Jangan gunakan versi ganjil/eksperimental.
3. **Instal Ulang Node Modules**: Jalankan perintah berikut di folder `tauri_app` untuk memastikan package terinstal sesuai arsitektur OS laptop baru:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```
4. **Perbarui Rust Toolchain**: Tauri v2 membutuhkan versi compiler Rust modern (min. `1.75.0`). Jalankan perintah ini untuk memperbarui:
   ```bash
   rustup update stable
   ```

---

## 💻 2. Panduan Mengatasi Error Berdasarkan OS

### 🔴 LINUX (Fedora / Ubuntu / Debian)

#### Masalah 1: `pkg-config failed: "webkit2gtk-4.1" not found`
* **Penyebab**: Tauri menggunakan WebKit2 untuk merender UI HTML/CSS di Linux, namun library header development belum terpasang di sistem Anda.
* **Solusi (Fedora / RHEL)**:
  ```bash
  sudo dnf install webkit2gtk4.1-devel curl wget file perl-FindBin librsvg2-devel libappindicator-gtk3-devel
  ```
* **Solusi (Ubuntu / Debian / Mint)**:
  ```bash
  sudo apt update
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```

#### Masalah 2: `libssl.so` or `openssl` missing
* **Penyebab**: Crate Rust memerlukan library OpenSSL bawaan OS.
* **Solusi**:
  - Fedora: `sudo dnf install openssl-devel`
  - Ubuntu/Debian: `sudo apt install libssl-dev pkg-config`

---

### 🔵 WINDOWS

#### Masalah 1: `error: linker 'link.exe' not found`
* **Penyebab**: Windows tidak memiliki compiler C++ dan Linker MSVC untuk menyusun binary Rust.
* **Solusi**:
  1. Unduh dan jalankan [Visual Studio Installer](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
  2. Pilih beban kerja **"Desktop development with C++"** (Pengembangan Desktop dengan C++).
  3. Pastikan komponen **"MSVC v143 - VS 2022 C++ x64/x86 build tools"** dan **"Windows 11 SDK"** (atau Windows 10 SDK) dicentang di kolom kanan.
  4. Klik **Install** dan tunggu hingga selesai, kemudian restart laptop Anda.

#### Masalah 2: `WebView2 Runtime is not installed`
* **Penyebab**: Windows tidak memiliki WebView2 runtime untuk menampilkan UI Chromium.
* **Solusi**:
  Biasanya Windows 10/11 sudah memilikinya. Jika belum, unduh dan pasang secara manual dari [situs resmi Microsoft WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

---

### 🟢 macOS

#### Masalah 1: `xcrun: error: invalid active developer path` atau compiler tidak ditemukan
* **Penyebab**: macOS belum memasang utilitas Command Line untuk Xcode.
* **Solusi**:
  Jalankan perintah berikut di terminal Anda untuk menginstalnya:
  ```bash
  xcode-select --install
  ```

#### Masalah 2: `Architecture mismatch (arm64 vs x86_64)`
* **Penyebab**: Mengompilasi aplikasi intel (x86_64) di mesin Apple Silicon (M1/M2/M3) tanpa toolchain yang sesuai.
* **Solusi**:
  Secara default, jalankan build native arm64:
  ```bash
  rustup target add aarch64-apple-darwin
  npm run tauri dev
  ```

---

## 🔍 3. Cara Melakukan Uji Coba Cepat (Fast Diagnostics)

Jika Anda menemui error saat menjalankan `npm run tauri dev`, lakukan langkah diagnosis terpisah berikut untuk mempersempit area masalah:

1. **Uji Frontend secara Terpisah**:
   Jalankan server Vite saja tanpa Tauri untuk memastikan React berjalan lancar:
   ```bash
   npm run dev
   ```
   Buka `http://localhost:1420` di browser. Jika ini berhasil, maka masalahnya **murni berada pada lingkungan Rust/OS Anda**, bukan pada kode React.

2. **Uji Backend Rust secara Terpisah**:
   Jalankan pemeriksaan sintaksis compiler Rust secara mandiri di dalam folder `tauri_app/src-tauri`:
   ```bash
   cd src-tauri
   cargo check
   ```
   Jika `cargo check` berhasil tanpa error, artinya semua dependensi sistem operasi (C++ compiler, WebKit2, openssl) sudah terpasang dengan benar di laptop Anda.
