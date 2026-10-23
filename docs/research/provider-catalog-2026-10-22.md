# Spot provider catalog import — 2026-10-22

Imported the complete [Spot insurance reviews catalog](https://spot.insure/insurance-reviews) into **local dev Convex** at `127.0.0.1:3220`, using Spot Insurance Research MCP's published provider profiles and their cited primary product sources. Production was not changed.

- Catalog: 55 providers; 47 created, eight matched by normalized name or official website hostname.
- Dev provider count: 82 → 129. New records are prospects, without portal accounts or invitations.
- Added 585 ACORD line assignments to 45 new profiles; Armilla and Layr remain unassigned for the reasons below.
- Added 97 evidenced line assignments across the eight existing profiles, retaining every previous selection. Existing network status, addresses and geographic appetite were preserved.
- All 55 have a dated coverage-research section in their private company wiki, including published role, product qualifiers, citations and unmapped products. Existing wiki content was retained with revision-checked saves.
- Used existing authenticated operator mutations (`brokerProfiles:createStandalone`, `brokerProfiles:upsert`, `orgWiki:saveForOperator`). No migrations, schema changes or tests were written.

## Research and mapping

The [reviewed catalog](provider-catalog-2026-10-22.json) retains per-product evidence, primary links, published role, profile update date and exact ACORD mappings. Profiles were retrieved in full, without truncation. Coverage research describes publicly offered or arranged classes; it does not establish universal eligibility, standalone availability, carrier appointment or binding authority.

Mappings use the repository's ACORD PCS 2.11.0 LOBCd catalog. Technology E&O and professional E&O map to EO. Builders risk maps to the commercial inland marine family (INMRC); product liability maps to CGL. Umbrella maps to UMBRC; EXLIA is added only when the accompanying evidence names excess. Existing broader or alternate valid codes were retained.

AI-specific liability, digital assets, intellectual property, key person, recall and other products without a clear class remain in sourced prose instead of being forced into unrelated codes. Hired/non-owned auto alone does not imply full commercial-auto appetite. Counterpart's package-only GL statement did not receive a broad CGL assignment. Pie's discontinued commercial-auto program was excluded. Package/add-on restrictions remain in the wiki evidence, including Simply Business property and cyber offerings.

- **Armilla:** [official AI insurance brief](https://www.armilla.ai/ai-insurance-brief), checked directly on 2026-10-22, confirms standalone affirmative AI liability. No exact AI LOBCd exists in the current catalog, so no generic cyber/E&O assignment was invented.
- **Layr:** its profile describes broker-facing software and licensed support, with no confirmed Coverage Offered list. The [official quoting page](https://withlayr.com/platform/insurance-quote), checked directly on 2026-10-22, confirms a platform proposition. No direct underwriting appetite was assigned.
- Countries and subdivisions were not inferred from headquarters or a product's name. New geographic appetite is unknown.

## Verification

Read back all 55 organizations, profiles and wiki documents after import. Every researched code is stored; all old codes are retained; network status, addresses and geographic fields on existing profiles are unchanged. There are 129 active external provider records. No contact mutations were used.

The portal list displayed the new providers and their ACORD codes. At-Bay's Appetite tab displayed CYBER and EO; screenshot: `.context/provider-catalog-import/at-bay-appetite.png`.

Creation automatically queued the app's separate company enrichment. Those 47 background runs failed to obtain public research evidence. The MCP-backed coverage data and dated wiki research above were saved successfully and verified independently; background research was not marked successful or its evidence fabricated.

## Providers

| Provider profile | Import | Researched ACORD codes |
| --- | --- | --- |
| [Amelia Risk](https://spot.insure/insurance-providers/amelia-risk) | Added | AUTOB, BOP, CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDUC, UMBRC, WORK |
| [AIG](https://spot.insure/insurance-providers/aig) | Added | AUTOB, BANDM, CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDTY, FIDUC, HLTH, INMRC, KIDRA, LL, MEDIA, MGMLI, PROP, TRUCK, UMBRC, WORK |
| [Alliance Risk](https://spot.insure/insurance-providers/alliance-risk) | Added | AUTOB, BANDM, BOP, CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDUC, INMRC, LL, MEDIA, MGMLI, PROP, UMBRC, WORK |
| [At-Bay](https://spot.insure/insurance-providers/at-bay) | Added | CYBER, EO |
| [Aon](https://spot.insure/insurance-providers/aon) | Added | AUTOB, CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDUC, INMRC, KIDRA, MGMLI, PROP, SURE, UMBRC, WORK |
| [Armilla](https://spot.insure/insurance-providers/armilla) | Added | Unassigned; see notes |
| [CNA](https://spot.insure/insurance-providers/cna) | Added | AUTOB, BANDM, BOP, CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDTY, FIDUC, INMRC, KIDRA, MEDIA, MGMLI, MMAL, PROP, SURE, UMBRC, WORK |
| [Chubb](https://spot.insure/insurance-providers/chubb) | Added | AUTOB, BANDM, BOP, CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDUC, INMRC, KIDRA, MEDIA, MGMLI, PROP, SURE, UMBRC, WORK |
| [Berkshire Hathaway Specialty Insurance](https://spot.insure/insurance-providers/berkshire-hathaway-specialty-insurance) | Added | CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDUC, INMRC, MEDIA, PROP, SURE, UMBRC |
| [biBerk](https://spot.insure/insurance-providers/biberk) | Added | AUTOB, BOP, CGL, CYBER, EO, UMBRC, WORK |
| [Beazley](https://spot.insure/insurance-providers/beazley) | Added | CGL, CRIME, CYBER, DO, EO, EPLI, FIDTY, FIDUC, MEDIA, MGMLI, MMAL, PROP |
| [CFC](https://spot.insure/insurance-providers/cfc) | Added | CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDUC, KIDRA, MEDIA, MGMLI, PROP, UMBRC |
| [Coterie Insurance](https://spot.insure/insurance-providers/coterie) | Added | BOP, CGL, EO |
| [Corgi](https://spot.insure/insurance-providers/corgi) | Matched existing | AUTOB, BOP, CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, FIDUC, KIDRA, LL, MEDIA, MMAL, UMBRC, WORK |
| [Cowbell](https://spot.insure/insurance-providers/cowbell) | Added | CRIME, CYBER, DO, EO, EPLI, FIDUC, MGMLI |
| [Counterpart](https://spot.insure/insurance-providers/counterpart) | Added | CRIME, DO, EO, EPLI, FIDUC, MMAL |
| [Coalition](https://spot.insure/insurance-providers/coalition) | Added | CRIME, CYBER, DO, EO, EPLI, FIDUC, MEDIA |
| [Coverdash](https://spot.insure/insurance-providers/coverdash) | Added | AUTOB, BANDM, BOP, CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDTY, FIDUC, INMRC, KIDRA, LL, MEDIA, MGMLI, PROP, SURE, TRUCK, UMBRC, WORK |
| [Embroker](https://spot.insure/insurance-providers/embroker) | Matched existing | AUTOB, BOP, CGL, CRIME, CYBER, DO, EO, EPLI, FIDUC, MGMLI, PROP, SURE, WORK |
| [Harper](https://spot.insure/insurance-providers/harper) | Matched existing | AUTOB, BOP, CGL, CYBER, EO, GARAG, INMRC, LL, MGMLI, MMAL, PROP, SURE, UMBRC, WORK |
| [Gallagher](https://spot.insure/insurance-providers/gallagher) | Added | AUTOB, BANDM, BOP, CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDTY, FIDUC, HLTH, INMRC, KIDRA, PROP, SURE, UMBRC, WORK |
| [Founder Shield](https://spot.insure/insurance-providers/foundershield) | Matched existing | CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, FIDTY, FIDUC, HLTH, MEDIA, PROP, UMBRC, WORK |
| [Foxquilt](https://spot.insure/insurance-providers/foxquilt) | Added | AUTOB, BOP, CGL, CRIME, CYBER, EO, EXLIA, INMRC, PROP, UMBRC, WORK |
| [ERGO NEXT Insurance](https://spot.insure/insurance-providers/next-insurance) | Added | BOP, CGL, EO, PROP, WORK |
| [Layr](https://spot.insure/insurance-providers/layr) | Added | Unassigned; see notes |
| [Insureon](https://spot.insure/insurance-providers/insureon) | Matched existing | AUTOB, BOP, CGL, CYBER, EO, FIDTY, INMRC, PROP, SURE, UMBRC, WORK |
| [Heffernan Insurance Brokers](https://spot.insure/insurance-providers/heffernan) | Matched existing | AUTOB, BOP, CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDTY, FIDUC, HLTH, INMRC, KIDRA, MGMLI, MMAL, PROP, SURE, TRUCK, UMBRC, WORK |
| [Hiscox](https://spot.insure/insurance-providers/hiscox) | Added | BOP, CGL, CYBER, EO, WORK |
| [Kinro](https://spot.insure/insurance-providers/kinro) | Added | AUTOB, BOP, CGL, CYBER, DO, EO, EXLIA, INMRC, PROP, TRUCK, UMBRC, WORK |
| [HUB International](https://spot.insure/insurance-providers/hub-international) | Added | AUTOB, BANDM, BOP, CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDTY, FIDUC, HLTH, INMRC, KIDRA, MGMLI, MMAL, PROP, SURE, TRUCK, UMBRC, WORK |
| [Marsh McLennan Agency](https://spot.insure/insurance-providers/marsh-mclennan-agency) | Added | AUTOB, CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, FIDUC, INMRC, KIDRA, MEDIA, PROP, SURE, WORK |
| [Markel](https://spot.insure/insurance-providers/markel) | Added | BANDM, CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDUC, INMRC, LL, MEDIA, MGMLI, PROP, SURE, UMBRC, WORK |
| [Marsh](https://spot.insure/insurance-providers/marsh) | Added | BANDM, CGL, CRIME, CYBER, DO, EO, EPLI, FIDTY, FIDUC, HLTH, INMRC, KIDRA, MEDIA, MGMLI, PROP, SURE, WORK |
| [Lockton](https://spot.insure/insurance-providers/lockton) | Added | AUTOB, CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDUC, HLTH, PROP, SURE, UMBRC, WORK |
| [Mylo](https://spot.insure/insurance-providers/mylo) | Added | AUTOB, BOP, CGL, CYBER, EO, HLTH, MMAL, SURE, UMBRC, WORK |
| [Liberty Mutual](https://spot.insure/insurance-providers/liberty-mutual) | Added | AUTOB, BANDM, BOP, CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, FIDTY, FIDUC, INMRC, KIDRA, MGMLI, MMAL, PROP, SURE, UMBRC, WORK |
| [Pie Insurance](https://spot.insure/insurance-providers/pie-insurance) | Added | BOP, CGL, CYBER, EO, WORK |
| [Nationwide](https://spot.insure/insurance-providers/nationwide) | Added | AUTOB, BANDM, BOP, CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDUC, INMRC, MGMLI, PROP, SURE, UMBRC, WORK |
| [Newfront](https://spot.insure/insurance-providers/newfront) | Matched existing | AUTOB, BANDM, CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDTY, FIDUC, HLTH, KIDRA, MGMLI, PROP, SURE, UMBRC, WORK |
| [Resilience](https://spot.insure/insurance-providers/resilience) | Added | CYBER, EO |
| [RiskCube](https://spot.insure/insurance-providers/riskcube) | Added | CGL, CRIME, CYBER, DO, EO, EPLI, FIDUC |
| [Relm](https://spot.insure/insurance-providers/relm) | Added | CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDUC, INMRC, KIDRA, MEDIA, PROP, SURE, UMBRC |
| [The Baldwin Group](https://spot.insure/insurance-providers/baldwin) | Added | AUTOB, BANDM, CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, FIDTY, FIDUC, HLTH, INMRC, KIDRA, MGMLI, PROP, SURE, UMBRC, WORK |
| [Simply Business](https://spot.insure/insurance-providers/simply-business) | Added | BOP, CGL, CYBER, EO, INMRC, PROP, WORK |
| [TechInsurance](https://spot.insure/insurance-providers/techinsurance) | Added | AUTOB, BOP, CGL, CYBER, DO, EO, EPLI, FIDTY, INMRC, PROP, SURE, UMBRC, WORK |
| [Risklytics](https://spot.insure/insurance-providers/risklytics) | Added | CGL, CYBER, DO, EO, INMRC, PROP, UMBRC, WORK |
| [The Hartford](https://spot.insure/insurance-providers/the-hartford) | Added | AUTOB, BOP, CGL, CRIME, CYBER, DO, EO, EPLI, FIDUC, INMRC, KIDRA, MGMLI, PROP, UMBRC, WORK |
| [StartupInsurance.ai](https://spot.insure/insurance-providers/startupinsurance) | Added | AUTOB, CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDUC, INMRC, PROP, SURE, UMBRC, WORK |
| [WTW](https://spot.insure/insurance-providers/wtw) | Added | CARGO, CRIME, CYBER, EO, EPLI, MGMLI, PROP, SURE |
| [THREE](https://spot.insure/insurance-providers/three) | Added | AUTOB, BANDM, BOP, CGL, CYBER, DO, EO, EPLI, FIDUC, INMRC, LL, PROP, WORK |
| [USI Insurance Services](https://spot.insure/insurance-providers/usi) | Added | AUTOB, CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDUC, HLTH, KIDRA, MGMLI, MMAL, PROP, SURE, UMBRC, WORK |
| [WithCoverage](https://spot.insure/insurance-providers/withcoverage) | Added | CARGO, CGL, CYBER, DO, EO, INMRC, LL, PROP, UMBRC, WORK |
| [Travelers](https://spot.insure/insurance-providers/travelers) | Added | AUTOB, BANDM, BOP, CARGO, CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDTY, FIDUC, INMRC, KIDRA, MEDIA, MGMLI, PROP, SURE, UMBRC, WORK |
| [Vouch](https://spot.insure/insurance-providers/vouch) | Matched existing | CGL, CRIME, CYBER, DO, EO, EPLI, FIDTY, MMAL, PROP, UMBRC, WORK |
| [Zurich U.S.](https://spot.insure/insurance-providers/zurich) | Added | AUTOB, CGL, CRIME, CYBER, DO, EO, EPLI, EXLIA, FIDTY, FIDUC, INMRC, MGMLI, PROP, SURE, UMBRC, WORK |
