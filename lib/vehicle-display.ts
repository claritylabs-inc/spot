const makeNames: Record<string, string> = {
  bmw: "BMW",
  gmc: "GMC",
  ram: "Ram",
  mini: "MINI",
  byd: "BYD",
  mg: "MG",
  ds: "DS",
  amgeneral: "AM General",
  mclaren: "McLaren",
  landrover: "Land Rover",
  mercedesbenz: "Mercedes-Benz",
  alfaromeo: "Alfa Romeo",
  astonmartin: "Aston Martin",
  rollsroyce: "Rolls-Royce",
  volkswagen: "Volkswagen",
  fiat: "Fiat",
  kia: "Kia",
};
/** Format catalog make names for display without changing stored identifiers. */
export function vehicleMakeLabel(value: string) {
  const known = makeNames[value.toLowerCase().replace(/[^a-z0-9]/g, "")];
  if (known) return known;
  if (value !== value.toUpperCase()) return value;
  return value
    .toLowerCase()
    .replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toUpperCase());
}
