import { NextResponse, type NextRequest } from "next/server";

// Canonical host. Both the bare apex and the old stanleyluong.com subdomain
// 301 here, preserving path + query, so every old link (including live-game
// URLs) lands on the same page at the new home. www itself never matches, so
// there's no redirect loop, and localhost / other hosts are left alone.
const WWW = "www.playdailydouble.com";
const REDIRECT_HOSTS = new Set(["playdailydouble.com", "dailydouble.stanleyluong.com"]);

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (REDIRECT_HOSTS.has(host)) {
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
