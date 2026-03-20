import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, getSession, refreshSession } from "@/lib/auth";
import { getAppUrl } from "@/lib/spotify";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const returnTo = searchParams.get("returnTo") || "/dashboard";
  const session = await getSession();

  if (!session) {
    return NextResponse.redirect(getAppUrl("/login"));
  }

  try {
    await refreshSession(session);
    return NextResponse.redirect(getAppUrl(returnTo));
  } catch {
    await clearSessionCookie();
    return NextResponse.redirect(getAppUrl("/login?error=session_refresh_failed"));
  }
}
