import { redirect } from "next/navigation";
import { can, currentUser } from "@/lib/auth";
import { parseMapCenter, resolveTileUrl } from "@/lib/map-input";
import { NewEventForm } from "./new-event-form";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  if (!can(await currentUser(), "coordinator")) redirect("/login");
  return (
    <>
      <h1>New event</h1>
      <p className="muted">
        The details are encrypted in this step. The server keeps only the sealed blob, and the shard codes are shown
        once on the next screen.
      </p>
      <NewEventForm
        tileUrl={resolveTileUrl(process.env.MAP_TILE_URL)}
        fallbackCenter={parseMapCenter(process.env.MAP_CENTER) ?? { lat: 39.8, lon: -98.6, zoom: 4 }}
      />
    </>
  );
}
