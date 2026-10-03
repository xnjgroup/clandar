"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { deleteLibraryItem } from "@/lib/library";
import { saveArticle } from "@/lib/web-article";

/** Deletes a document uploaded to the Library (a project's file is deleted from its project). */
export async function removeLibraryItem(form: FormData) {
  const { org } = await requireSession();
  const id = form.get("id");
  if (typeof id === "string") await deleteLibraryItem(id, org.id);
  revalidatePath("/library");
  if (form.get("back")) redirect("/library");
}

/** Save a link: read, summarize and index the article, then open it. */
export async function saveLink(_prev: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const session = await requireSession();
  const url = String(form.get("url") ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return { error: "Paste the article's full link (https://…)." };
  let id: string;
  try {
    id = (await saveArticle(session.org.id, session.person.id, url)).id;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't read that page." };
  }
  revalidatePath("/library");
  redirect(`/library/${id}`);
}
