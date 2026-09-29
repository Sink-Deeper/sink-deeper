/** Build-time theme id (VITE_THEME). "violet" is the default look; others are previews built side by side. */
export const THEME: "violet" | "ember" | "paper" | "noir" | "rose" | "grape" = ((import.meta.env.VITE_THEME as string) || "violet") as any;
