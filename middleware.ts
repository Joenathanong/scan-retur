import { NextRequest, NextResponse } from "next/server";

// Middleware runs on Edge — we just protect routes by checking the presence
// of the Firebase auth cookie. Real token verification happens in server
// components / API routes via firebase-admin.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public paths that don't require auth
  const publicPaths = ["/login"];
  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // API routes are handled by their own auth checks
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Check for Firebase auth session cookie
  const authCookie =
    request.cookies.get("scan-retur-auth")?.value ||
    request.cookies.get("__session")?.value;

  if (!authCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.svg).*)",
  ],
};
