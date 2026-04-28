import { NextRequest, NextResponse } from "next/server";
import { applyAuthEventCookie, applySessionCookie, buildLocalSession } from "@/lib/auth";
import { authenticateLocalAccount } from "@/lib/local-accounts";
import { getAppUrl } from "@/lib/spotify";

export async function POST(request: NextRequest) {
  const formData = await request.formData();

  try {
    const account = await authenticateLocalAccount({
      username: String(formData.get("username") ?? ""),
      password: String(formData.get("password") ?? ""),
    });

    const response = NextResponse.redirect(getAppUrl("/dashboard", request), { status: 303 });
    applySessionCookie(response, buildLocalSession(account));
    applyAuthEventCookie(response, "local_login_success", `user:${account.id}`);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not sign in.";
    const response = NextResponse.redirect(getAppUrl(`/login?local_error=${encodeURIComponent(message)}`, request), { status: 303 });
    applyAuthEventCookie(response, "local_login_failed", message);
    return response;
  }
}
