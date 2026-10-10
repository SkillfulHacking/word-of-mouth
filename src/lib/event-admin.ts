import { db, type User } from "./db";
import { canManageEvent, type Fail } from "./invites";
import { isThemeValue } from "./themes";

const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

/** Change how an event's public pages look. Only the event's coordinator or an admin. */
export function setEventTheme(actor: User, eventId: string, theme: string): { ok: true } | Fail {
  const event = db.prepare("SELECT id, coordinator_id FROM events WHERE id = ?").get(eventId) as { id: string; coordinator_id: number } | undefined;
  if (!event) return fail(404, "No such event.");
  if (!canManageEvent(actor, event)) return fail(403, "Only the event's coordinator or an admin can do that.");
  if (!isThemeValue(theme)) return fail(400, "That isn't a theme.");
  db.prepare("UPDATE events SET theme = ? WHERE id = ?").run(theme, eventId);
  return { ok: true };
}
