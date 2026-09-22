const OTP_MIN = 100000;
const OTP_RANGE = 900000; // 6-digit codes: 100000-999999

export function generateOtpCode(): string {
  const maxUint32 = 0xffffffff;
  const limit = maxUint32 - (maxUint32 % OTP_RANGE);
  const buf = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return (OTP_MIN + (value % OTP_RANGE)).toString();
}
