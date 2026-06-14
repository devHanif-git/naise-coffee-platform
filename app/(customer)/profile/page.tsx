import type { Metadata } from "next";
import { cookies } from "next/headers";

export const metadata: Metadata = {
  title: "Profile",
};

// Server Action untuk toggle cookie
async function toggleAdminRole() {
  "use server";
  
  const cookieStore = await cookies();
  const currentRole = cookieStore.get("naise_role")?.value;

  if (currentRole === "admin") {
    // Kalau dah admin, remove cookie
    cookieStore.delete("naise_role");
  } else {
    // Kalau belum, set cookie naise_role=admin untuk path /
    cookieStore.set("naise_role", "admin", {
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // Expire dalam 7 hari
    });
  }
}

export default async function ProfilePage() {
  // Baca status cookie semasa untuk tentukan UI
  const cookieStore = await cookies();
  const isAdmin = cookieStore.get("naise_role")?.value === "admin";

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <h1 className="font-heading text-2xl font-semibold">Profile</h1>
      
      <p className="mt-2 text-sm text-muted-foreground">
        {isAdmin 
          ? "You are currently logged in as Admin." 
          : "Coming soon."}
      </p>

      {/* Form action trigger server action tanpa perlu 'use client' */}
      <form action={toggleAdminRole} className="mt-6">
        <button
          type="submit"
          className={`rounded-md px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors ${
            isAdmin
              ? "bg-red-600 hover:bg-red-700 focus:ring-red-500"
              : "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500"
          } focus:outline-none focus:ring-2 focus:ring-offset-2`}
        >
          {isAdmin ? "Remove Admin Role" : "Grant Admin Role"}
        </button>
      </form>
    </main>
  );
}