"use client";
import MembersPageView from "@/components/members/MembersPageView";
import { useMembersPageController } from "@/lib/hooks/useMembersPageController";
export default function MembersPage() {
  const controller = useMembersPageController();
  return <MembersPageView controller={controller} />;
}
