import { redirect } from "next/navigation";

/**
 * Sign-in lives on the landing page's first screen now. /login stays as an address — sign-in
 * errors, expired links and the signed-out redirect all point here — and forwards, keeping
 * `?error=`, to the sign-in card.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }
  const query = params.toString();
  redirect(query ? `/?${query}#signin` : "/#signin");
}
