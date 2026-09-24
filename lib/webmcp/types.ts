export type WebMcpJsonSchema = {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  additionalProperties?: boolean;
};

type ToolBase = {
  title: string;
  description: string;
  readOnly: boolean;
  /** Sends outside Spot, costs model time, or cannot be undone. Never blocks. */
  consequential?: boolean;
  untrustedContent?: boolean;
};

export type DeclarativeToolDefinition = ToolBase & {
  surface: "declarative";
  /** Where the form renders, for agents and docs. */
  registeredOn: string;
  /** Named form fields and their `toolparamdescription`. */
  params?: Record<string, string>;
};

export type ImperativeToolDefinition = ToolBase & {
  surface: "imperative";
  inputSchema: WebMcpJsonSchema;
  /**
   * `client`: signed-in, onboarded client accounts. `public`: token pages that
   * need no session.
   */
  audience: "client" | "public";
  /** Route prefixes where the tool registers; omitted means every client page. */
  pages?: readonly string[];
  /** Registered only for organization admins, matching the UI's admin-only controls. */
  adminOnly?: boolean;
};

export type WebMcpToolDefinition =
  | DeclarativeToolDefinition
  | ImperativeToolDefinition;

type Property = Record<string, unknown>;

export const param = {
  string: (description: string, extra?: Property): Property => ({
    type: "string",
    description,
    ...extra,
  }),
  boolean: (description: string): Property => ({ type: "boolean", description }),
  integer: (description: string, extra?: Property): Property => ({
    type: "integer",
    description,
    ...extra,
  }),
  number: (description: string): Property => ({ type: "number", description }),
  enum: (values: readonly string[], description: string): Property => ({
    type: "string",
    enum: [...values],
    description,
  }),
  date: (description: string): Property => ({
    type: "string",
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    description: `${description} (YYYY-MM-DD).`,
  }),
  stringArray: (description: string): Property => ({
    type: "array",
    items: { type: "string" },
    description,
  }),
  object: (
    description: string,
    properties: Record<string, Property>,
    required: string[] = [],
  ): Property => ({
    type: "object",
    description,
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }),
  array: (description: string, items: Property): Property => ({
    type: "array",
    items,
    description,
  }),
};

export function schema(
  properties: Record<string, Property> = {},
  required: string[] = [],
): WebMcpJsonSchema {
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

/** Shared parameter shapes. */
export const fileParams = {
  file_name: param.string("File name including extension, for example lease.pdf."),
  content_type: param.string("MIME type, for example application/pdf."),
  content_base64: param.string("File contents, base64-encoded (max 20 MB decoded)."),
};

export const holderAddressParams = {
  holder_contact_name: param.string("Optional holder contact person."),
  holder_email: param.string("Optional holder email (stored on the certificate; not emailed)."),
  holder_phone: param.string("Optional holder phone."),
  address_line1: param.string("Optional holder street address."),
  address_line2: param.string("Optional suite or unit."),
  city: param.string("Optional city."),
  state: param.string("Optional state or province code."),
  postal_code: param.string("Optional postal code."),
  country: param.string("Optional country."),
};

export function imperative(
  tool: Omit<ImperativeToolDefinition, "surface" | "audience"> & {
    audience?: ImperativeToolDefinition["audience"];
  },
): ImperativeToolDefinition {
  return { surface: "imperative", audience: "client", ...tool };
}
