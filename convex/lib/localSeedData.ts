export const LOCAL_FIXTURE = {
  operator: {
    email: "terry@claritylabs.inc",
    name: "Terry Wang",
  },
  broker: {
    name: "Montgomery Risk",
    slug: "montgomery-risk",
    website: "https://montgomeryrisk.com",
    admin: {
      email: "terry@montgomeryrisk.com",
      name: "Terry Wang",
    },
  },
  client: {
    name: "Cove",
    website: "https://cove.dev",
    industry: "technology",
    industryVertical: "fintech",
    agentHandle: "cove",
    context:
      "Cove builds underwriting tools for the relationship-based parts of the housing and finance ecosystem. It works with realtors, property managers, brokers, and mortgage agents. Cove is a technology company focused on underwriting and credit products.",
    admin: {
      email: "adyan@cove.dev",
      name: "Adyan Tanver",
    },
  },
  policy: {
    carrier: "Northwoods Continental Insurance Company",
    broker: "Montgomery Risk",
    policyNumber: "NWC-TEC-3110-26-01",
    linesOfBusiness: ["EO", "CYBER"],
    policyYear: 2026,
    effectiveDate: "03/15/2026",
    expirationDate: "03/15/2027",
    insuredName: "Cove Technologies Inc.",
    insuredAddress: {
      street1: "111 Richmond Street West",
      street2: "Suite 700",
      city: "Toronto",
      state: "ON",
      zip: "M5H 2G4",
      country: "Canada",
    },
    operationsDescription:
      "Technology company providing underwriting, credit, and workflow software for housing and finance professionals.",
    producer: {
      agencyName: "Montgomery Risk",
      address: {
        street1: "161 Bay Street",
        street2: "Suite 2700",
        city: "Toronto",
        state: "ON",
        zip: "M5J 2S1",
        country: "Canada",
      },
    },
    insurer: {
      legalName: "Northwoods Continental Insurance Company",
      address: {
        street1: "200 Front Street West",
        city: "Toronto",
        state: "ON",
        zip: "M5V 3J1",
        country: "Canada",
      },
    },
    generalAgent: {
      agencyName: "Highland Risk Services",
      address: {
        street1: "100 King Street West",
        city: "Toronto",
        state: "ON",
        zip: "M5X 1A9",
        country: "Canada",
      },
    },
    premium: "$48,200",
    premiumAmount: 48_200,
    summary:
      "Northwoods Continental Insurance Company policy #NWC-TEC-3110-26-01 for Cove Technologies Inc. covering Technology Errors & Omissions and Cyber Liability",
    coverages: [
      {
        name: "Technology Errors & Omissions Liability",
        lineOfBusiness: "EO",
        limit: "$5,000,000",
      },
      {
        name: "Network Security & Privacy Liability (Cyber)",
        lineOfBusiness: "CYBER",
        limit: "$3,000,000",
      },
      {
        name: "Media Content Liability",
        lineOfBusiness: "EO",
        limit: "$1,000,000",
      },
    ],
  },
} as const;
