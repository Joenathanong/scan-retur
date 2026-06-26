import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, password, role, createdBy } = body as {
      name: string;
      email: string;
      password: string;
      role: "admin" | "operator";
      createdBy: string;
    };

    if (!name || !email || !password || !role || !createdBy) {
      return NextResponse.json({ error: "Data tidak lengkap" }, { status: 400 });
    }

    // Create Firebase Auth user — server-side, doesn't affect client auth session
    const userRecord = await adminAuth.createUser({
      email,
      password,
      displayName: name,
    });

    // Write Firestore doc via Admin SDK (bypasses rules, no permission issue)
    await adminDb.collection("users").doc(userRecord.uid).set({
      name,
      email,
      role,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      createdBy,
    });

    // Write audit log
    await adminDb.collection("auditLog").add({
      userId: createdBy,
      userName: "admin",
      action: "CREATE_USER",
      detail: `Buat user: ${email} (${role})`,
      metadata: {},
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true, uid: userRecord.uid });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Terjemahkan error Firebase Auth yang umum
    if (msg.includes("email-already-exists")) {
      return NextResponse.json({ error: "Email sudah terdaftar" }, { status: 400 });
    }
    if (msg.includes("invalid-password") || msg.includes("weak-password")) {
      return NextResponse.json({ error: "Password minimal 6 karakter" }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
