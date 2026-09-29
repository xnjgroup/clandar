"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";

type Photo = { id: string; url: string; caption: string | null };

/** The project's photo grid — click a thumbnail to zoom into a full-size lightbox with Prev/Next and Escape/click-outside to close. */
export function PhotoLightbox({
  photos,
  projectId,
  removePhoto,
}: {
  photos: Photo[];
  projectId: string;
  removePhoto: (form: FormData) => void;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    if (openIndex === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIndex(null);
      else if (e.key === "ArrowRight") setOpenIndex((i) => (i === null ? i : (i + 1) % photos.length));
      else if (e.key === "ArrowLeft") setOpenIndex((i) => (i === null ? i : (i - 1 + photos.length) % photos.length));
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [openIndex, photos.length]);

  if (photos.length === 0) return null;

  const current = openIndex !== null ? photos[openIndex] : null;

  return (
    <>
      <div className="flex flex-wrap gap-[8px]">
        {photos.map((photo, i) => (
          <div
            key={photo.id}
            className="group relative size-[84px] shrink-0 overflow-hidden rounded-[10px] border border-line"
          >
            <button
              type="button"
              onClick={() => setOpenIndex(i)}
              aria-label={`Zoom in on ${photo.caption ?? "project photo"}`}
              className="block size-full cursor-zoom-in"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt={photo.caption ?? "Project photo"} className="size-full object-cover" />
            </button>
            <form action={removePhoto} className="absolute top-[3px] right-[3px]">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="photoId" value={photo.id} />
              <button
                type="submit"
                aria-label="Remove photo"
                className="flex size-[20px] cursor-pointer items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100"
              >
                <Icon name="close" size={12} />
              </button>
            </form>
          </div>
        ))}
      </div>

      {current ? (
        <div role="dialog" aria-modal="true" aria-label="Photo" className="fixed inset-0 z-50 flex flex-col">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpenIndex(null)}
            className="absolute inset-0 cursor-default bg-black/85"
          />
          <button
            type="button"
            onClick={() => setOpenIndex(null)}
            aria-label="Close"
            className="absolute top-4 right-4 z-10 flex size-10 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <Icon name="close" size={20} />
          </button>

          {photos.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() => setOpenIndex((i) => (i === null ? i : (i - 1 + photos.length) % photos.length))}
                aria-label="Previous photo"
                className="absolute top-1/2 left-4 z-10 flex size-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <Icon name="chevL" size={22} />
              </button>
              <button
                type="button"
                onClick={() => setOpenIndex((i) => (i === null ? i : (i + 1) % photos.length))}
                aria-label="Next photo"
                className="absolute top-1/2 right-4 z-10 flex size-11 -translate-y-1/2 -scale-x-100 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <Icon name="chevL" size={22} />
              </button>
            </>
          ) : null}

          <div className="relative z-[1] flex flex-1 items-center justify-center p-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.url}
              alt={current.caption ?? "Project photo"}
              className="max-h-full max-w-full rounded-[8px] object-contain"
            />
          </div>
          {photos.length > 1 ? (
            <p className="relative z-[1] m-0 pb-5 text-center text-[12px] text-white/70">
              {(openIndex ?? 0) + 1} / {photos.length}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
