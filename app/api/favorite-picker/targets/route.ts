import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { FavoritePickerTargetType } from "@/lib/favorite-picker";
import { resolveFavoritePickerTargets } from "@/lib/spotify-picker";

type FavoritePickerTargetPayload = {
  id: string;
  type: FavoritePickerTargetType;
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      targets?: FavoritePickerTargetPayload[];
      inputs?: string[];
    };

    const session = await getSession();
    const targets = [
      ...(body.targets ?? []),
      ...(body.inputs ?? []),
    ];

    const result = await resolveFavoritePickerTargets(session, targets);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Spotify targets.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
