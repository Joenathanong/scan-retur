# Scan Retur — Setup Guide

Panduan lengkap setup dari nol hingga deploy ke Vercel.

---

## 1. Firebase Setup

### 1a. Buat Project Firebase
1. Buka [console.firebase.google.com](https://console.firebase.google.com)
2. Klik **Add project** → isi nama project → klik Continue
3. Disable Google Analytics (opsional) → Create project

### 1b. Enable Authentication
1. Di sidebar kiri: **Build → Authentication → Get started**
2. Tab **Sign-in method** → Enable **Email/Password**
3. Save

### 1c. Buat Firestore Database
1. **Build → Firestore Database → Create database**
2. Pilih **Start in production mode** → pilih region terdekat (asia-southeast2 = Jakarta)
3. Setelah database dibuat, klik tab **Rules**
4. Copy isi file `firestore.rules` dari project ini, paste, klik **Publish**

### 1d. Ambil Firebase Config (Client)
1. **Project Settings** (gear icon) → **General**
2. Scroll ke **Your apps** → klik `</>` (Web)
3. Isi App nickname → klik **Register app**
4. Copy nilai dari `firebaseConfig`:
   - `apiKey`
   - `authDomain`
   - `projectId`
   - `storageBucket`
   - `messagingSenderId`
   - `appId`

### 1e. Buat Service Account (Admin SDK)
1. **Project Settings → Service accounts**
2. Klik **Generate new private key** → Confirm
3. Download file JSON
4. Buka file JSON, ambil nilai:
   - `project_id` → `FIREBASE_ADMIN_PROJECT_ID`
   - `client_email` → `FIREBASE_ADMIN_CLIENT_EMAIL`
   - `private_key` → `FIREBASE_ADMIN_PRIVATE_KEY`

---

## 2. Google Sheets Setup

### 2a. Enable Sheets API
1. Buka [console.cloud.google.com](https://console.cloud.google.com)
2. Pilih project yang sama dengan Firebase
3. **APIs & Services → Enable APIs** → cari **Google Sheets API** → Enable

### 2b. Buat Service Account (bisa pakai yang sama dengan Firebase Admin)
1. **APIs & Services → Credentials → Create Credentials → Service Account**
2. Isi nama → Create
3. Role: **Editor** → Continue → Done
4. Klik service account yang baru dibuat → **Keys → Add Key → JSON**
5. Download, ambil `client_email` dan `private_key`

> **Atau**: Gunakan service account yang sama dengan Firebase Admin (dari langkah 1e).
> Pastikan service account sudah di-enable Google Sheets API di project tersebut.

### 2c. Buat Google Spreadsheet
1. Buka [sheets.google.com](https://sheets.google.com) → buat spreadsheet baru
2. Beri nama: "Rekap Scan Retur PT. IEG"
3. Share ke email service account (`GOOGLE_SHEETS_CLIENT_EMAIL`) dengan role **Editor**
4. Ambil Spreadsheet ID dari URL:
   `https://docs.google.com/spreadsheets/d/`**`[INI_SPREADSHEET_ID]`**`/edit`

---

## 3. Environment Variables

Buat file `.env.local` di root project:

```env
# Firebase Client
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

# Firebase Admin
FIREBASE_ADMIN_PROJECT_ID=...
FIREBASE_ADMIN_CLIENT_EMAIL=...
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Google Sheets
GOOGLE_SHEETS_CLIENT_EMAIL=...
GOOGLE_SHEETS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEETS_SPREADSHEET_ID=...
```

> **Penting untuk private key**: Di `.env.local`, paste key dengan `\n` literal (bukan newline sesungguhnya). Contoh:
> ```
> FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIB...\n-----END PRIVATE KEY-----\n"
> ```

---

## 4. Install & Run Locally

```bash
cd scan-retur
npm install
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000)

---

## 5. Bootstrap Admin User Pertama

Karena belum ada user di sistem, kita perlu buat admin pertama secara manual:

### Cara 1: Via Firebase Console
1. **Authentication → Users → Add user**
2. Isi email & password admin
3. Copy UID yang muncul setelah user dibuat
4. **Firestore → users collection → Add document**
   - Document ID: [UID dari langkah 3]
   - Fields:
     ```
     name: "Nama Admin"
     email: "admin@perusahaan.com"
     role: "admin"
     active: true
     createdAt: (timestamp now)
     createdBy: "system"
     ```

### Cara 2: Via Script
```bash
# Edit scripts/bootstrap-admin.ts dengan data admin Anda
# lalu jalankan:
npx ts-node scripts/bootstrap-admin.ts
```

### Cara 3: Init Settings juga
Di Firestore, buat collection `settings`, document `company`:
```
namaPerusahaan: "PT. IEG"
noteTandaTerima: "Seluruh karung yang diserahkan sudah di scan..."
spreadsheetId: ""
updatedAt: null
updatedBy: null
```

---

## 6. Deploy ke Vercel

### 6a. Push ke GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/username/scan-retur.git
git push -u origin main
```

### 6b. Import di Vercel
1. Buka [vercel.com](https://vercel.com) → New Project
2. Import dari GitHub repository
3. **Framework**: Next.js (auto-detected)
4. **Environment Variables**: tambahkan semua variabel dari `.env.local`
   > Untuk Vercel, private key bisa dimasukkan apa adanya (dengan newline asli) —
   > Vercel menangani encoding otomatis. Atau gunakan format `\n`.

5. Deploy!

---

## 7. Membuat User Operator

Setelah login sebagai admin:
1. **Admin → Kelola User → Tambah User**
2. Isi nama, email, password, pilih role "Operator"
3. Klik "Buat User"

> **Catatan**: Saat ini pembuatan user menggunakan `createUserWithEmailAndPassword` yang
> akan memindahkan sesi ke user baru. Untuk production, disarankan membuat API route
> `/api/admin/create-user` menggunakan Firebase Admin SDK agar sesi admin tidak terganggu.

---

## 8. Konfigurasi Spreadsheet ID

Setelah login sebagai admin:
1. **Admin → Pengaturan**
2. Masukkan Spreadsheet ID
3. Atur nama perusahaan dan note tanda terima
4. Klik Simpan

---

## 9. Struktur Google Sheet

Setiap ekspedisi per hari akan membuat sheet baru dengan format nama:
`EXPEDISI_CODE_DD-MM-YYYY`

Contoh:
- `JNE_25-06-2026`
- `TIKI_25-06-2026`
- `SICEPAT_25-06-2026`

Kolom: No. | Kode Resi | No. Karung | Di Scan Oleh | Tanggal | Jam

---

## 10. Logic Lock Karung

| Status | Keterangan |
|--------|------------|
| `open` | Karung bisa di-scan |
| `locked` | Tanda terima sudah dicetak, scan tidak bisa dilakukan |
| `admin_unlocked` | Admin membuka kunci (berlaku 24 jam) |

- Setelah print → otomatis `locked`
- Admin buka kunci → status `admin_unlocked`, auto re-lock setelah 24 jam
- Admin bisa manual re-lock kapan saja dari halaman History

---

## Troubleshooting

**Error "User tidak ditemukan di sistem"**
→ User ada di Firebase Auth tapi belum ada di Firestore. Buat dokumen di collection `users`.

**Google Sheets tidak tersync**
→ Cek apakah `GOOGLE_SHEETS_CLIENT_EMAIL` sudah di-share sebagai Editor di spreadsheet.
→ Cek apakah Google Sheets API sudah di-enable di Google Cloud Console.

**Error saat deploy ke Vercel: private key**
→ Di Vercel environment variables, masukkan private key dengan format:
`"-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n"`
(gunakan `\n` literal, bukan enter)
