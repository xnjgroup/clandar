/**
 * Browser-side: shrinks a photo before it's uploaded. Phone photos are often
 * 3–8 MB and HEIC — too big for a serverless request (Vercel caps bodies at
 * 4.5 MB) and not viewable outside Safari. This redraws them as a JPEG no larger
 * than MAX_EDGE on the long side, which is plenty for job photos and receipts.
 * Anything it can't or shouldn't touch comes back unchanged.
 */

const MAX_EDGE = 2400;
const QUALITY = 0.85;
/** JPEG/PNG/WebP under this size are left as they are. */
const SMALL_ENOUGH = 1.5 * 1024 * 1024;

function isHeic(file: File) {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    // Applies the photo's EXIF rotation, so portrait shots stay upright.
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Older Safari: fall back to an <img>, which also decodes HEIC there.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function shrinkImage(file: File): Promise<File> {
  const heic = isHeic(file);
  if (!heic && !file.type.startsWith("image/")) return file;
  if (/image\/(gif|svg)/.test(file.type)) return file; // animation / vector: keep as is
  if (!heic && file.size <= SMALL_ENOUGH) return file;

  try {
    const source = await decode(file);
    const width = "naturalWidth" in source ? source.naturalWidth : source.width;
    const height = "naturalHeight" in source ? source.naturalHeight : source.height;
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    if ("close" in source) source.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    // Keep the original if shrinking didn't actually help (and it isn't HEIC, which must be converted).
    if (!blob || (!heic && blob.size >= file.size)) return file;
    const name = file.name.replace(/\.[^./]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}
