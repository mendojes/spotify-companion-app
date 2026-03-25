import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getAppUrl } from "@/lib/spotify";
import { updateConnectedUserPrivacySettings } from "@/lib/connected-users";

function isChecked(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

export async function POST(request: Request) {
  const session = await requireSession();
  const formData = await request.formData();

  await updateConnectedUserPrivacySettings(session.spotifyUserId, {
    shareProfile: isChecked(formData, "shareProfile"),
    shareTopLists: isChecked(formData, "shareTopLists"),
    shareListeningActivity: isChecked(formData, "shareListeningActivity"),
  });

  return NextResponse.redirect(getAppUrl("/settings?saved=1", request), { status: 303 });
}
