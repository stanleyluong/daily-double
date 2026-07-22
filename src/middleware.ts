import { NextResponse, type NextRequest } from "next/server";

// Canonicalize the bare apex to www: playdailydouble.com -> www.playdailydouble.com
// (301, permanent). Scoped to that exact host so the old
// dailydouble.stanleyluong.com domain and localhost are left completely alone,
// and www itself never matches (no redirect loop).
const APEX = "playdailydouble.com";
const WWW = "www.playdailydouble.com";

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (host === APEX) {
    const url = new URL(req.url);
    url.host = WWW;
    url.protocol = "https:";
    url.port = "";
    return NextResponse.redirect(url, 301);
  }
  return NextResponse.next();
}

// Skip Next internals and static assets — the page/API request carries the
// redirect; assets then load from www after it.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
