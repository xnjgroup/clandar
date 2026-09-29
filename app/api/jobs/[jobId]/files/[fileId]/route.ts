import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getJob } from "@/lib/jobs";
import { getJobFile, readJobFileBytes } from "@/lib/job-photos";

/** Streams one job file's bytes — gated by the job actually belonging to the signed-in org. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string; fileId: string }> },
) {
  const { jobId, fileId } = await params;
  const { org } = await requireSession();

  const job = await getJob(jobId, org.id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const file = await getJobFile(fileId, jobId);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bytes = await readJobFileBytes(file);
  const filename = file.fileName.replace(/["\\]/g, "_");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": file.contentType,
      "content-length": String(bytes.byteLength),
      "content-disposition": `inline; filename="${filename}"`,
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
