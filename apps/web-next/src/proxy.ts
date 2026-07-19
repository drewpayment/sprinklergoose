import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect layer: no session cookie -> sign-in page.
 * This is UX only — real authorization happens server-side in every route
 * handler and layout (see src/lib/session.ts).
 */
export default function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  const { pathname } = request.nextUrl;
  const isSignIn = pathname === "/sign-in";
  // `/` is public: it serves the marketing page when signed out.
  const isPublic = isSignIn || pathname === "/";

  if (!sessionCookie && !isPublic) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  if (sessionCookie && isSignIn) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Pages only: API routes return their own 401s; static assets excluded.
  matcher: [
    "/((?!api|_next/static|_next/image|icons|marketing|manifest.webmanifest|favicon.ico).*)",
  ],
};
