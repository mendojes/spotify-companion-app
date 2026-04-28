import { NextRequest, NextResponse } from "next/server";
import { getSession, isAdminSession } from "@/lib/auth";
import { deleteSpotifyUserData } from "@/lib/account-data";
import { deleteLocalAccount, getLocalAccountById } from "@/lib/local-accounts";
import { getAppUrl } from "@/lib/spotify";

export async function POST(request: NextRequest) {
  const session = await getSession();

  if (!isAdminSession(session)) {
    return NextResponse.redirect(getAppUrl("/dashboard", request), { status: 303 });
  }

  const formData = await request.formData();
  const kind = String(formData.get("kind") ?? "");
  const id = String(formData.get("id") ?? "");

  if (!id) {
    return NextResponse.redirect(getAppUrl("/settings", request), { status: 303 });
  }

  if (kind === "spotify") {
    await deleteSpotifyUserData(id).catch(() => undefined);
  } else if (kind === "local") {
    const localAccount = await getLocalAccountById(id).catch(() => null);

    if (localAccount?.spotifyUserId) {
      await deleteSpotifyUserData(localAccount.spotifyUserId).catch(() => undefined);
    }

    await deleteLocalAccount(id).catch(() => undefined);
  }

  return NextResponse.redirect(getAppUrl("/settings", request), { status: 303 });
}
