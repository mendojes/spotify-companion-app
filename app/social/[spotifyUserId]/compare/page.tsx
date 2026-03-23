import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";

type ComparePageProps = {
  params: Promise<{ spotifyUserId: string }>;
  searchParams: Promise<{ range?: string }>;
};

export default async function SocialComparePage(_props: ComparePageProps) {
  await requireSession();
  redirect("/social");
}

