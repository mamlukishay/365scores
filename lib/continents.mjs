// Maps each team (by its English url-name) to a geographic continent.
// Used for the "performance by region" analysis.

export const CONTINENTS = ["Europe", "South America", "Africa", "Asia", "North America", "Oceania"];

const MAP = {
  // Europe
  austria: "Europe", belgium: "Europe", "bosnia-&-herzegovina": "Europe", croatia: "Europe",
  "czech-republic": "Europe", england: "Europe", france: "Europe", germany: "Europe",
  netherlands: "Europe", norway: "Europe", portugal: "Europe", scotland: "Europe",
  spain: "Europe", sweden: "Europe", switzerland: "Europe", turkiye: "Europe",
  // South America
  argentina: "South America", brazil: "South America", colombia: "South America",
  ecuador: "South America", paraguay: "South America", uruguay: "South America",
  // Africa
  algeria: "Africa", "cape-verde": "Africa", "dr-congo": "Africa", egypt: "Africa",
  ghana: "Africa", "ivory-coast": "Africa", morocco: "Africa", senegal: "Africa",
  "south-africa": "Africa", tunisia: "Africa",
  // Asia
  iran: "Asia", iraq: "Asia", japan: "Asia", jordan: "Asia", qatar: "Asia",
  "saudi-arabia": "Asia", "south-korea": "Asia", uzbekistan: "Asia",
  // North America
  canada: "North America", curacao: "North America", haiti: "North America",
  mexico: "North America", panama: "North America", usa: "North America",
  // Oceania
  australia: "Oceania", "new-zealand": "Oceania",
};

export function continentOf(nameForUrl) {
  return MAP[nameForUrl] || "Other";
}
