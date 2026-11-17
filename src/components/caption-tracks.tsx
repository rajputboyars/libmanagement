"use client";

import { useUI } from "@/lib/ui-store";
import type { GuideVideo } from "@/lib/guide-videos";

/** English and Hinglish caption tracks for a silent guide video; the track matching the site language is on by default. */
export function CaptionTracks({ video }: { video: Pick<GuideVideo, "src" | "captions"> }) {
  const lang = useUI((s) => s.lang);
  if (!video.captions) return null;
  const base = video.src.replace(/\.mp4$/, "");
  return (
    <>
      {(["en", "hi"] as const).map((l) => (
        <track key={l} kind="captions" src={`${base}.${l}.vtt`} srcLang={l === "hi" ? "hi-Latn" : "en"} label={l === "hi" ? "Hinglish" : "English"} default={l === lang} />
      ))}
    </>
  );
}
