import "mailauth";

// mailauth 5.0.3 emits these verification fields but omits them from its declarations.
declare module "mailauth" {
  interface DKIMResult {
    algo?: string;
    signingHeaders?: { keys: string; headers: string[]; canonicalizedHeader: string };
    canonBodyLengthLimited?: boolean;
    signatureTimeValid?: boolean;
  }
}
