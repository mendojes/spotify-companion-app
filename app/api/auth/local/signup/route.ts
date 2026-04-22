import { NextRequest, NextResponse } from "next/server";
import { applyAuthEventCookie, applySessionCookie, buildLocalSession } from "@/lib/auth";
import { createLocalAccount } from "@/lib/local-accounts";
import { getAppUrl } from "@/lib/spotify";

export async function POST(request: NextRequest) {
  const formData = await request.formData();

  try {
    const account = await createLocalAccount({
      displayName: String(formData.get("displayName") ?? ""),
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      spotifyProfileInput: String(formData.get("spotifyProfileUrl") ?? ""),
    });

    const response = NextResponse.redirect(getAppUrl("/dashboard?welcome=1", request), { status: 303 });
    applySessionCookie(response, buildLocalSession(account));
    applyAuthEventCookie(response, "local_signup_success", `user:${account.id}`);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create account.";
    const response = NextResponse.redirect(getAppUrl(`/login?local_error=${encodeURIComponent(message)}`, request), { status: 303 });
    applyAuthEventCookie(response, "local_signup_failed", message);
    return response;
  }
}
