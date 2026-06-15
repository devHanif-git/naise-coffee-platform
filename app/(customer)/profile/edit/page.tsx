import type { Metadata } from "next";
import { ProfileEditScreen } from "@/components/profile-edit-screen";

export const metadata: Metadata = {
  title: "Edit Profile",
};

export default function ProfileEditPage() {
  return <ProfileEditScreen />;
}
