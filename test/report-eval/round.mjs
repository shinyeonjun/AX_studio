// Half-up rounding on the decimal value, as a person or a spreadsheet writes it: 28.45 → 28.5.
// Number#toFixed rounds the binary double (28.449999…) and writes 28.4, which no report would.
export function fixed(value, digits) {
  const [whole, fraction = ''] = Math.abs(value).toPrecision(15).split('.');
  const padded = (fraction + '0'.repeat(digits + 1)).slice(0, digits + 1);
  let scaled = BigInt(whole + padded.slice(0, digits));
  if (Number(padded[digits]) >= 5) scaled += 1n;
  const text = scaled.toString().padStart(digits + 1, '0');
  const result = digits > 0 ? `${text.slice(0, -digits)}.${text.slice(-digits)}` : text;
  return `${value < 0 && Number(result) !== 0 ? '-' : ''}${result}`;
}
