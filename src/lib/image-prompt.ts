import { z } from "zod";
import { nearestColorName } from "./color";
import { themeDef } from "./themes";

/**
 * Words that make an image model paint a title, a sign or a caption (a real result: "invitation banner" produced
 * a garbled "SPOOKY HARLOWENENS"). They're removed from every prompt, whoever wrote it, because this model follows
 * a negative prompt only weakly. Describe the scene and the lettering problem never starts.
 */
const TRIGGERS = [
  "invitation", "invitations", "invite", "invites", "banner", "banners", "poster", "posters", "flyer", "flyers", "card", "cards",
  "sign", "signs", "signage", "text", "title", "titles", "typography", "lettering", "letters", "caption", "captions", "headline",
  "logo", "logos", "quote", "label", "labels", "announcement", "advertisement", "advert", "ad", "brochure", "magazine", "book cover",
];
const TRIGGER_RE = new RegExp(`\\b(?:${TRIGGERS.map((t) => t.replace(" ", "\\s+")).join("|")})\\b`, "gi");

export function sanitizeImagePrompt(prompt: string): string {
  return prompt
    .replace(TRIGGER_RE, " ")
    .split(",")
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 1)
    .join(", ")
    .slice(0, 700);
}

const SYSTEM = `You write prompts for a text-to-image model.
Given a short idea for the mood of an event, write ONE prompt of 35 to 60 words as comma-separated visual phrases covering: the main subject, the setting, the lighting, the colors, the mood, and an art style such as "digital illustration" or "cinematic lighting", ending with "wide scene".
Rules:
- Describe a scene only. Never mention invitations, banners, posters, flyers, cards, signs, text, words, titles, logos, or the event's name.
- No real people, celebrities, brands, or real places. No addresses.
- Use the given color words for the palette.
Reply as JSON: {"prompt": "..."}.`;

const Out = z.object({ prompt: z.string().min(20).max(800) });
type Ask = <T>(system: string, user: string, schema: z.ZodType<T>) => Promise<T>;

/** Color words for a theme, so the picture can match the event's colors. */
export function themeColorWords(theme: string): string[] {
  const d = themeDef(theme);
  return [...new Set([d.bg, d.accent, d.fg].map(nearestColorName))];
}

/** Turn a short idea into an image prompt with the local language model. */
export async function writeImagePrompt(idea: string, theme: string, ask: Ask): Promise<string> {
  const colors = themeColorWords(theme);
  const out = await ask(SYSTEM, `Idea: ${idea.trim().slice(0, 300)}\nColors: ${colors.join(", ")}`, Out);
  const clean = sanitizeImagePrompt(out.prompt.replace(/^["'\s]+|["'\s]+$/g, ""));
  if (clean.length < 20) throw new Error("The model's prompt wasn't usable. Try again or write one yourself.");
  return clean;
}
