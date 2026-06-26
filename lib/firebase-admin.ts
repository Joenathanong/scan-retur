import admin from "firebase-admin";

function getFirebaseAdminCredential() {
  const projectId   = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const rawKey      = process.env.FIREBASE_ADMIN_PRIVATE_KEY || "";

  if (!projectId || !clientEmail || !rawKey) {
    throw new Error(
      "Firebase Admin env vars tidak lengkap. Pastikan FIREBASE_ADMIN_PROJECT_ID, " +
      "FIREBASE_ADMIN_CLIENT_EMAIL, dan FIREBASE_ADMIN_PRIVATE_KEY sudah diset di Vercel."
    );
  }

  // Vercel kadang menyimpan key dengan literal \n (belum jadi newline asli).
  // Handle keduanya: jika masih ada \\n ganti jadi \n, lalu trim spasi ekstra.
  let privateKey = rawKey;

  if (!privateKey.includes("\n")) {
    // Tidak ada newline asli — ganti literal \\n
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  // Bersihkan quote yang mungkin terbawa saat copy-paste
  privateKey = privateKey.replace(/^["']|["']$/g, "").trim();

  // Validasi format dasar
  if (!privateKey.startsWith("-----BEGIN")) {
    throw new Error(
      "FIREBASE_ADMIN_PRIVATE_KEY tidak valid. " +
      "Pastikan key dimulai dengan '-----BEGIN PRIVATE KEY-----'."
    );
  }

  return admin.credential.cert({ projectId, clientEmail, privateKey });
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: getFirebaseAdminCredential() });
}

export const adminAuth = admin.auth();
export const adminDb   = admin.firestore();
export default admin;
