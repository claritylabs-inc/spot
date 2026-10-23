The UI 0.12.0 patch adds the same Calendar and DateField source proposed in https://github.com/claritylabs-inc/clarity-ui/pull/31. It is applied by postinstall so a clean install has the date primitives. Calendar comes from the stock shadcn Base UI registry; DateField composes shared input-group, field, popover, and button primitives. Upgrade the shared UI package and remove this patch and the temporary direct calendar dependencies once the shared change is released.

The UI patch also aligns InputGroup’s background with the shared Input and Select primitives (`bg-popover`), retaining transparent inner controls and disabled-state styling. This prevents currency amount fields from showing a different fill than their currency selector in dark mode.

The react-phone-number-input 3.4.18 patch reports input changes in the input event instead of a prop-synchronization effect, avoiding stale-value feedback loops in controlled intake fields. Both ESM and CommonJS builds are patched.

Searchable Select also accepts an explicit `typographyRole` so compact provider dropdowns can use the shared `control.menu` role for their trigger, search, options and empty state. A data attribute carries that role through the portal; Spot's CSS preserves its typography against the operator form overrides. The default input role remains available to existing callers.
