/** Local VIN structure/check-digit validation; no registry lookup or ownership claim. */
export function vinError(
  raw: string,
  country = "United States",
): string | undefined {
  const vin = raw.trim().toUpperCase();
  if (!vin) return;
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))
    return "Enter a complete 17-character VIN using letters and numbers, without I, O or Q, or clear it to skip.";
  if (/^(.)\1{16}$/.test(vin))
    return "Enter the vehicle’s VIN, or clear it to skip.";
  // US/Canadian-market VINs use the mandatory position-nine check digit.
  if (
    ["United States", "Canada", "US", "CA"].includes(country) ||
    /^[1-5]/.test(vin)
  ) {
    const values: Record<string, number> = {
      A: 1,
      B: 2,
      C: 3,
      D: 4,
      E: 5,
      F: 6,
      G: 7,
      H: 8,
      J: 1,
      K: 2,
      L: 3,
      M: 4,
      N: 5,
      P: 7,
      R: 9,
      S: 2,
      T: 3,
      U: 4,
      V: 5,
      W: 6,
      X: 7,
      Y: 8,
      Z: 9,
    };
    const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
    const remainder =
      [...vin].reduce(
        (sum, char, index) =>
          sum + (values[char] ?? Number(char)) * weights[index],
        0,
      ) % 11;
    if (vin[8] !== (remainder === 10 ? "X" : String(remainder)))
      return "This VIN’s check digit does not match. Check the VIN against the vehicle, or clear it to skip.";
  }
}
