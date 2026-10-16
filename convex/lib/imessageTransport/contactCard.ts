export function resolveContactCardPhone(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.SPOT_IMESSAGE_CONTACT_PHONE?.trim() ??
    env.NEXT_PUBLIC_SPOT_IMESSAGE_NUMBER?.trim() ??
    env.GLASS_IMESSAGE_CONTACT_PHONE?.trim() ??
    env.NEXT_PUBLIC_GLASS_IMESSAGE_NUMBER?.trim() ??
    ""
  );
}
