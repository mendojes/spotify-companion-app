import { NextRequest, NextResponse } from "next/server";
import { applyAuthEventCookie, applyClearedSessionCookies } from "@/lib/auth";
import { getAppUrl } from "@/lib/spotify";

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(getAppUrl("/", request));
  applyClearedSessionCookies(response);
  applyAuthEventCookie(response, "logout_cleared_session");
  return response;
}
