import { themeCss } from "@/lib/themes";

/**
 * Restyles the whole page (header included) in an event's theme. The CSS is built only from validated
 * #rrggbb colors, so injecting it as raw text is safe. The default theme renders nothing.
 */
export function ThemeStyle({ theme }: { theme: string }) {
  const css = themeCss(theme);
  return css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null;
}
