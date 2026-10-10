/**
 * OpenStreetMap data is ODbL: anyone using it has to credit "OpenStreetMap contributors" and say what license it is under.
 * Show this wherever OSM-derived places are shown.
 */
export function OsmCredit() {
  return (
    <p className="muted" style={{ fontSize: "0.85rem" }}>
      Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>,
      available under the{" "}
      <a href="https://opendatacommons.org/licenses/odbl/" target="_blank" rel="noreferrer">
        Open Database License
      </a>
      .
    </p>
  );
}
