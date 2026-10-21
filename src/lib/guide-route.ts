// Shared by routing (client) and metadata/sitemap (server): which guide page a path points to.
import { guidePages } from "./guide-content";
import { ownerGuide, studentGuide, type GuideRole } from "./guide-videos";

export function guideRoute(
  path: string,
): { role: GuideRole; slug?: string } | null {
  const m = /^\/guide\/(student|owner)(?:\/([a-z-]+))?$/.exec(path);
  if (!m) return null;
  const role = m[1] as GuideRole;
  if (m[2] && !guidePages[role].some((p) => p.slug === m[2])) return null;
  return { role, slug: m[2] };
}

export function guideMeta(
  path: string,
): { title: string; description: string } | null {
  const r = guideRoute(path);
  if (!r) return null;
  const who =
    r.role === "owner" ? "Library owner guide" : "Student portal guide";
  if (!r.slug)
    return {
      title: who,
      description:
        r.role === "owner"
          ? "Every page of the StudyQuest owner portal explained, with a Hindi video for each: seats, shifts, admissions, fees, attendance and reports."
          : "Every page of the StudyQuest student portal explained, with a Hindi video for each: joining a library, attendance, focus timer, XP and exam prep.",
    };
  const page = guidePages[r.role].find((p) => p.slug === r.slug)!;
  const video = (r.role === "owner" ? ownerGuide : studentGuide).find(
    (v) => v.slug === r.slug,
  );
  return {
    title: `${video?.page ?? r.slug} · ${who}`,
    description: page.summary,
  };
}

export function guidePaths(): string[] {
  return (["student", "owner"] as GuideRole[]).flatMap((role) => [
    `/guide/${role}`,
    ...guidePages[role].map((p) => `/guide/${role}/${p.slug}`),
  ]);
}
