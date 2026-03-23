import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";

type SocialProfilePageProps = {
  params: Promise<{ spotifyUserId: string }>;
  searchParams: Promise<{ range?: string; topRange?: string; topFrom?: string; topTo?: string }>;
};

export default async function SocialProfilePage(_props: SocialProfilePageProps) {
  await requireSession();
  redirect("/social");
}

