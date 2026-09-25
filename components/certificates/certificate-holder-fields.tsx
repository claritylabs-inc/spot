import { AddressAutofillInput } from "@/components/ui/address-autofill-input";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Label } from "@claritylabs-inc/ui/components/label";
import { PhoneInput } from "@claritylabs-inc/ui/components/marketing/phone-input";
import type { CertificateHolderDraft } from "./certificate-workspace";
import { typeStyle } from "@/lib/typography";

export function CertificateHolderFields({
  value,
  onChange,
  idPrefix,
  disabled,
  autoFocusName,
  invalidName,
  invalidEmail,
  invalidPhone,
  phonePlaceholder,
}: {
  value: CertificateHolderDraft;
  onChange: (patch: Partial<CertificateHolderDraft>) => void;
  idPrefix: string;
  disabled: boolean;
  autoFocusName?: boolean;
  invalidName?: boolean;
  invalidEmail?: boolean;
  invalidPhone?: boolean;
  phonePlaceholder?: string;
}) {
  const fieldId = (name: string) => `${idPrefix}-${name}`;
  const errorClass = `text-destructive ${typeStyle("caption.default")}`;
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={fieldId("holder-name")}>Certificate holder</Label>
        <Input id={fieldId("holder-name")} value={value.displayName} onChange={(event) => onChange({ displayName: event.target.value })} placeholder="Company or individual name" autoComplete="organization" autoFocus={autoFocusName} disabled={disabled} aria-invalid={invalidName} />
        {invalidName ? <p className={errorClass}>Enter a certificate holder name.</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor={fieldId("contact")}>Holder contact</Label>
        <Input id={fieldId("contact")} value={value.contactName} onChange={(event) => onChange({ contactName: event.target.value })} placeholder="Attention contact" autoComplete="name" disabled={disabled} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={fieldId("email")}>Holder email</Label>
        <Input id={fieldId("email")} type="email" value={value.email} onChange={(event) => onChange({ email: event.target.value })} placeholder="certificates@example.com" autoComplete="email" disabled={disabled} aria-invalid={invalidEmail} />
        {invalidEmail ? <p className={errorClass}>Enter a valid email address.</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor={fieldId("phone")}>Holder phone</Label>
        <PhoneInput id={fieldId("phone")} value={value.phone || undefined} onChange={(phone) => onChange({ phone: phone ?? "" })} defaultCountry="US" placeholder={phonePlaceholder} autoComplete="tel" disabled={disabled} aria-invalid={invalidPhone} />
        {invalidPhone ? <p className={errorClass}>Enter a valid phone number with country code.</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor={fieldId("address-1")}>Address</Label>
        <AddressAutofillInput
          id={fieldId("address-1")}
          value={{ street1: value.addressLine1, street2: value.addressLine2, city: value.city, state: value.state, zip: value.postalCode, country: value.country }}
          onChange={(address) => onChange({ addressLine1: address.street1 ?? "", addressLine2: address.street2 ?? "", city: address.city ?? "", state: address.state ?? "", postalCode: address.zip ?? "", country: address.country ?? "" })}
          display="street1"
          placeholder="Search for an address"
          autoComplete={`section-${idPrefix} address-line1`}
          disabled={disabled}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={fieldId("address-2")}>Address line 2</Label>
        <Input id={fieldId("address-2")} value={value.addressLine2} onChange={(event) => onChange({ addressLine2: event.target.value })} placeholder="Suite, floor, attention line" autoComplete={`section-${idPrefix} address-line2`} disabled={disabled} />
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_72px_96px]">
        {([[
          "city", "City", "city", "address-level2",
        ], ["state", "State", "state", "address-level1"], ["postal-code", "ZIP", "postalCode", "postal-code"]] as const).map(([id, label, key, autocomplete]) => (
          <div key={id} className="space-y-2">
            <Label htmlFor={fieldId(id)}>{label}</Label>
            <Input id={fieldId(id)} value={value[key]} onChange={(event) => onChange({ [key]: event.target.value })} autoComplete={`section-${idPrefix} ${autocomplete}`} disabled={disabled} />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Label htmlFor={fieldId("country")}>Country</Label>
        <Input id={fieldId("country")} value={value.country} onChange={(event) => onChange({ country: event.target.value })} placeholder="United States" autoComplete={`section-${idPrefix} country-name`} disabled={disabled} />
      </div>
    </>
  );
}
