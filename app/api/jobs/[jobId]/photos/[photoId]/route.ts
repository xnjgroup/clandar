import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getJob } from "@/lib/jobs";
import { getJobPhoto, readJobPhotoBytes } from "@/lib/job-photos";

/** Streams one job photo's bytes — gated by the job actually belonging to the signed-in org. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string; photoId: string }> },
) {
  const { jobId, photoId } = await params;
  const { org } = await requireSession();

  const job = await getJob(jobId, org.id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const photo = await getJobPhoto(photoId, jobId);
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bytes = await readJobPhotoBytes(photo);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": photo.contentType,
      "content-length": String(bytes.byteLength),
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
