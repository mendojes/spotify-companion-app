import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";
import { getAppUrl } from "@/lib/spotify";

export async function GET(request: NextRequest) {
  await clearSessionCookie();
  return NextResponse.redirect(getAppUrl("/"));
}
