"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  User as FirebaseUser,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { AppUser } from "@/types";

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  appUser: AppUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAppUser = useCallback(async (fbUser: FirebaseUser) => {
    const snap = await getDoc(doc(db, "users", fbUser.uid));
    if (snap.exists()) {
      const data = snap.data() as Omit<AppUser, "uid">;
      if (!data.active) {
        await firebaseSignOut(auth);
        throw new Error("Akun Anda dinonaktifkan. Hubungi admin.");
      }
      setAppUser({ uid: fbUser.uid, ...data });
    } else {
      // First admin bootstrap: if no users doc exists, create one
      await firebaseSignOut(auth);
      throw new Error("User tidak ditemukan di sistem.");
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser) {
        try {
          await loadAppUser(fbUser);
          // Set a simple cookie so middleware can detect auth
          document.cookie = `scan-retur-auth=${fbUser.uid}; path=/; max-age=86400; SameSite=Strict`;
        } catch {
          setAppUser(null);
        }
      } else {
        setAppUser(null);
        document.cookie =
          "scan-retur-auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      }
      setLoading(false);
    });
    return unsub;
  }, [loadAppUser]);

  const signIn = async (email: string, password: string) => {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    await loadAppUser(cred.user);
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setAppUser(null);
    document.cookie =
      "scan-retur-auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  };

  return (
    <AuthContext.Provider
      value={{ firebaseUser, appUser, loading, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
