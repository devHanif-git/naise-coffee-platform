import { redirect } from "next/navigation";

// /home is retired — the menu is the storefront hub now. Redirect any direct
// hits (old links, bookmarks, revalidatePath targets) to /menu.
export default function HomePage() {
  redirect("/menu");
}
