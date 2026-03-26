import { NextRequest, NextResponse } from "next/server";
import { applyClearedSessionCookies, clearSessionCookie } from "@/lib/auth";
import { getAppUrl } from "@/lib/spotify";

export async function GET(request: NextRequest) {
  await clearSessionCookie();
  const response = NextResponse.redirect(getAppUrl("/", request));
  applyClearedSessionCookies(response);
  return response;
}

