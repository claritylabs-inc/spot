# Vehicle manufacturer logos

The picker manifest is `lib/vehicle-make-logos.json`. All 32 local SVGs are enabled. Each asset uses a standalone emblem where available; Ford, GMC, Jeep, Kia and Fiat retain their minimal identifying brand lettering, and lettering integral to badges remains intact. There are no separate manufacturer captions or taglines.

Sources, licenses, artist credits and modifications are recorded in `sources.json`. Cardog assets retain their MIT notice in `LICENSE-cardog`; Peugeot is from Simple Icons under CC0. Manufacturer marks remain trademarks of their owners and identify makes only. Unknown makes use the generic vehicle icon; never obtain a logo by an ambiguous acronym search or alias General Motors to GMC.

When updating, verify manufacturer identity, remove separate wordmarks, fit the SVG viewBox to the visible emblem, update source metadata, and bump the image cache version in `components/insurance-intake/vehicle-fields.tsx`. Review every asset at the actual 20px size in light and dark themes as well as enlarged. The audit artifact and repeatable procedure are recorded in `docs/testing/workflow-qa.md`.
