"use client";

import { ModalDialog } from "@/components/modal-dialog";
import { NewFolderForm } from "./new-folder-form";
import { UploadForm } from "./upload-form";

const linkClass = "cursor-pointer text-[11.5px] font-medium whitespace-nowrap underline";

/** The Files card's header actions: "+ Upload" and "+ New folder", each in a modal, into the folder being viewed. */
export function FilesActions({
  projectId,
  folderId,
  folderName,
}: {
  projectId: string;
  folderId: string | null;
  /** The folder being viewed, as a path — or null at the top level. */
  folderName: string | null;
}) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-[12px]">
      <ModalDialog
        title="Upload files"
        trigger={(open) => (
          <button type="button" onClick={open} className={linkClass}>
            + Upload
          </button>
        )}
      >
        {(close) => (
          <UploadForm
            endpoint={`/api/projects/${projectId}/files`}
            fields={{ folderId: folderId ?? "" }}
            allowFolders
            withTags
            withDocType
            stacked
            destination={folderName ?? "All folders (top level)"}
            onDone={close}
          />
        )}
      </ModalDialog>
      <ModalDialog
        title="New folder"
        trigger={(open) => (
          <button type="button" onClick={open} className={linkClass}>
            + New folder
          </button>
        )}
      >
        {(close) => (
          <NewFolderForm
            projectId={projectId}
            parentId={folderId ?? ""}
            parentName={folderName}
            onAdded={close}
          />
        )}
      </ModalDialog>
    </span>
  );
}
