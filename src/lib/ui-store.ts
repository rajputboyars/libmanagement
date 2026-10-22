import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type SiteLang = "en" | "hi";

// `lang` is the public website language (English default, Hinglish toggle) and is remembered per browser.
// skipHydration keeps the first render in English on server and client; AppEntry rehydrates after mount.
export const useUI = create<{ dark: boolean; toggle: () => void; lang: SiteLang; setLang: (lang: SiteLang) => void }>()(
  persist(
    (set) => ({
      dark: false,
      toggle: () => set((s) => ({ dark: !s.dark })),
      lang: "en",
      setLang: (lang) => set({ lang }),
    }),
    {
      name: "sq-site",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ lang: s.lang }),
      skipHydration: true,
    },
  ),
);
