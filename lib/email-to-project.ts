/**
 * Copies a Gmail message's attachments onto a project — images to its photos,
 * everything else to its Files. Used by the assistant's
 * attach_email_files_to_project tool and by turning an email lead into a project.
 * Re-reads the message first: Gmail issues fresh attachment ids on every read.
 */
import { readAttachment, readMail } from "@/lib/gmail";
import { addProjectFile, addProjectPhoto } from "@/lib/project-photos";

export async function copyEmailAttachmentsToProject(input: {
  orgId: string;
  connectorId: string;
  messageId: string;
  projectId: string;
  uploadedBy: string | null;
  /** Only these filenames (case-insensitive); omit for all of them. */
  names?: string[];
}): Promise<{ photos: string[]; files: string[]; available: string[] }> {
  const email = await readMail(input.messageId, input.orgId, input.connectorId);
  const wanted = (input.names ?? []).map((n) => n.toLowerCase());
  const chosen = wanted.length
    ? email.attachments.filter((a) => wanted.includes(a.filename.toLowerCase()))
    : email.attachments;
  const photos: string[] = [];
  const files: string[] = [];
  for (const a of chosen) {
    const bytes = await readAttachment(email.id, a.attachmentId, input.orgId, email.connectorId);
    if (a.mimeType.startsWith("image/")) {
      await addProjectPhoto({
        projectId: input.projectId,
        fileName: a.filename,
        contentType: a.mimeType,
        bytes,
        uploadedBy: input.uploadedBy,
      });
      photos.push(a.filename);
    } else {
      await addProjectFile({
        projectId: input.projectId,
        folderId: null,
        fileName: a.filename,
        contentType: a.mimeType || "application/octet-stream",
        bytes,
        uploadedBy: input.uploadedBy,
      });
      files.push(a.filename);
    }
  }
  return { photos, files, available: email.attachments.map((a) => a.filename) };
}
