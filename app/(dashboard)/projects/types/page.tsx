import Link from "next/link";
import { iconName } from "@/components/icons";
import { Card, CardTitle, EmptyRow, IconTile, PageBody, TableCard, TableHeader, TableTitle } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { listProjectTypes } from "@/lib/project-types";
import { NewProjectTypeForm } from "./new-project-type-form";
import { removeProjectType, saveProjectType } from "./actions";
import { ICON_OPTIONS, iconSelectClass, inputClass } from "./icon-options";

export default async function ProjectTypesPage() {
  const { org } = await requireSession();
  const types = await listProjectTypes(org.id);

  return (
    <PageBody>
      <Card className="flex flex-col gap-[13px]">
        <div className="flex items-center gap-[10px]">
          <CardTitle>Project types</CardTitle>
          <Link href="/projects" className="ml-auto text-[11.5px] font-medium underline">
            Back to projects
          </Link>
        </div>
        <p className="m-0 text-[12.5px] leading-[1.55] text-muted">
          The kinds of work this org does — whatever was seeded from your company type at setup, fully yours to
          rename, add to, or remove from here.
        </p>
        <NewProjectTypeForm />
      </Card>

      <TableCard>
        <TableHeader>
          <TableTitle>All project types</TableTitle>
        </TableHeader>
        {types.length === 0 ? (
          <EmptyRow>No project types yet — add one above.</EmptyRow>
        ) : (
          types.map((t) => (
            <form
              key={t.id}
              action={saveProjectType}
              className="flex flex-wrap items-center gap-[10px] border-t border-line-soft px-[18px] py-[11px]"
            >
              <input type="hidden" name="id" value={t.id} />
              <IconTile icon={iconName(t.icon)} bg="#f2f4ef" fg="#4c4f47" size={34} iconSize={16} />
              <input name="name" defaultValue={t.name} required className={`${inputClass} min-w-[160px] flex-1`} />
              <select key={t.icon} name="icon" defaultValue={t.icon} className={iconSelectClass}>
                {ICON_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="cursor-pointer rounded-full border border-line px-[14px] py-[7px] text-[12px] font-medium"
              >
                Save
              </button>
              <button
                type="submit"
                formAction={removeProjectType}
                className="cursor-pointer rounded-full border border-line px-[14px] py-[7px] text-[12px] font-medium text-bad-fg"
              >
                Delete
              </button>
            </form>
          ))
        )}
      </TableCard>
    </PageBody>
  );
}
