# Procurement follow-up questions

Original Spot wording. Draft for product and underwriting review. Source-code equivalence has not been verified. The canonical records are in [question-catalog.json](question-catalog.json).

475 questions across 36 sections. Shared questions should reuse existing answers when their entity, meaning, and reporting period agree.

| Section | Subject | Questions |
| --- | --- | ---: |
| [Company and request](#shared-identity) | `company` | 20 |
| [Operations and financial exposure](#shared-operations) | `company` | 21 |
| [Operating locations](#shared-location) | `location` | 8 |
| [Existing insurance and history](#shared-insurance) | `company` | 10 |
| [Policy schedule](#shared-prior_policy) | `prior_policy` | 10 |
| [Individual loss or incident](#shared-loss) | `loss` | 8 |
| [General liability terms](#gl-coverage) | `coverage` | 14 |
| [General liability operations](#gl-exposure) | `company` | 21 |
| [Property insurance terms](#property-terms) | `coverage` | 16 |
| [Building characteristics](#property-building) | `building` | 32 |
| [Contents and interruption](#property-contents) | `location` | 14 |
| [Workers’ compensation scope](#wc-terms) | `coverage` | 11 |
| [Payroll and duties](#wc-class) | `employee_class` | 9 |
| [Employment practices and workplace safety](#wc-safety) | `company` | 16 |
| [Owner and officer elections](#wc-person) | `person` | 6 |
| [Commercial auto coverage](#auto-terms) | `coverage` | 14 |
| [Vehicle schedule](#auto-vehicle) | `vehicle` | 19 |
| [Driver schedule](#auto-driver) | `driver` | 11 |
| [Fleet management](#auto-fleet) | `company` | 9 |
| [Professional liability coverage](#eo-terms) | `coverage` | 8 |
| [Professional services and controls](#eo-services) | `company` | 22 |
| [Cyber coverage scope](#cyber-terms) | `coverage` | 8 |
| [Data and technology exposure](#cyber-data) | `company` | 14 |
| [Identity and access controls](#cyber-access) | `company` | 10 |
| [Security operations](#cyber-defense) | `company` | 17 |
| [Recovery and incident response](#cyber-recovery) | `company` | 13 |
| [People, vendors, and payment controls](#cyber-people) | `company` | 8 |
| [Umbrella and excess structure](#umbrella-terms) | `coverage` | 10 |
| [Excess liability exposure](#umbrella-exposure) | `company` | 10 |
| [Construction and contracting](#supplement-contractor) | `company` | 20 |
| [Manufacturing, importing, and distribution](#supplement-products) | `company` | 13 |
| [Food, lodging, and liquor](#supplement-hospitality) | `location` | 14 |
| [Technology services and software](#supplement-technology) | `company` | 11 |
| [Healthcare and licensed care services](#supplement-healthcare) | `company` | 10 |
| [Freight and transportation](#supplement-transport) | `company` | 10 |
| [Property ownership and management](#supplement-real_estate) | `company` | 8 |

<a id="shared-identity"></a>
## Company and request

Use for every requested line; reuse confirmed shared intake facts before asking.

Coverage: `general_liability`, `property`, `workers_compensation`, `commercial_auto`, `professional_liability`, `cyber`, `umbrella`. Subject: `company`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `shared.identity.legal_name` | What is the full legal name of the business applying for coverage? | `text` | If selected for this subject |
| `shared.identity.trading_names` | Which other names does this business trade under? | `text_list` | If selected for this subject |
| `shared.identity.website` | What is the business website? | `text` | If selected for this subject |
| `shared.identity.entity_type` | How is the business legally organized? | `single_choice`: Sole proprietor, Partnership, Corporation, Limited liability company, Nonprofit, Other | If selected for this subject |
| `shared.identity.formation_jurisdiction` | Where was the business legally formed? | `text` | If selected for this subject |
| `shared.identity.start_year` | In what year did this business begin operating? | `year` | If selected for this subject |
| `shared.identity.management_experience` | How much experience does the person responsible for operations have in this industry? | `duration` | If selected for this subject |
| `shared.identity.tax_identifier` | What business tax identifier should appear on the application? | `sensitive_text` | If selected for this subject |
| `shared.identity.mailing_address` | Where should insurance correspondence be sent? | `address` | If selected for this subject |
| `shared.identity.contact_name` | Who should answer follow-up questions about this application? | `text` | If selected for this subject |
| `shared.identity.contact_email` | What email address should we use for application follow-up? | `email` | If selected for this subject |
| `shared.identity.contact_phone` | What phone number should we use for application follow-up? | `phone` | If selected for this subject |
| `shared.identity.has_related_entities` | Are there related legal entities that may need coverage under this request? | `boolean` | If selected for this subject |
| `shared.identity.related_entity_scope` | Which related entities need coverage, and what is each entity's relationship to this business? | `long_text` | `shared.identity.has_related_entities` = true |
| `shared.identity.requested_start` | On what date should the requested coverage begin? | `date` | If selected for this subject |
| `shared.identity.contractual_requirements` | Does a contract, lease, lender, or customer impose insurance requirements? | `boolean` | If selected for this subject |
| `shared.identity.requirements_document` | Provide the insurance requirements or the relevant contract section. | `file_refs` | `shared.identity.contractual_requirements` = true |
| `shared.identity.requirements_deadline` | When must evidence of the required insurance be delivered? | `date` | `shared.identity.contractual_requirements` = true |
| `shared.identity.planned_changes` | Are material changes to ownership, staffing, locations, products, or operations planned during the requested policy term? | `boolean` | If selected for this subject |
| `shared.identity.changes_description` | Describe the planned changes and when they are expected. | `long_text` | `shared.identity.planned_changes` = true |

<a id="shared-operations"></a>
## Operations and financial exposure

Use company facts to identify relevant business supplements; preserve reporting periods.

Coverage: `general_liability`, `property`, `workers_compensation`, `commercial_auto`, `professional_liability`, `cyber`, `umbrella`. Subject: `company`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `shared.operations.activities` | Describe the products and services the business provides and how customers use them. | `long_text` | If selected for this subject |
| `shared.operations.customers` | Who buys the business's products or services? | `long_text` | If selected for this subject |
| `shared.operations.annual_revenue` | What revenue did the business earn in its latest completed reporting period? | `period_money` | If selected for this subject |
| `shared.operations.projected_revenue` | What revenue does the business project for the next reporting period? | `period_money` | If selected for this subject |
| `shared.operations.full_time_staff` | How many full-time employees currently work for the business? | `count` | If selected for this subject |
| `shared.operations.part_time_staff` | How many part-time employees currently work for the business? | `count` | If selected for this subject |
| `shared.operations.contractor_count` | How many independent contractors currently work for the business? | `count` | If selected for this subject |
| `shared.operations.annual_payroll` | What is the employee payroll for the stated reporting period? | `period_money` | If selected for this subject |
| `shared.operations.operating_territories` | In which countries and states or provinces does the business perform work or sell products? | `text_list` | If selected for this subject |
| `shared.operations.foreign_operations` | Does the business operate outside its home country? | `boolean` | If selected for this subject |
| `shared.operations.foreign_operations_detail` | Describe the overseas activities, locations, and entities involved. | `long_text` | `shared.operations.foreign_operations` = true |
| `shared.operations.subcontracts` | Does the business hire other businesses to perform work on its behalf? | `boolean` | If selected for this subject |
| `shared.operations.subcontracted_share` | What percentage of the business's work is performed by subcontractors? | `percentage` | `shared.operations.subcontracts` = true |
| `shared.operations.seasonal` | Do operations or staffing vary substantially by season? | `boolean` | If selected for this subject |
| `shared.operations.seasonality` | Describe the seasonal changes in activities, staffing, and sales. | `long_text` | `shared.operations.seasonal` = true |
| `shared.operations.business_continuity` | Does the business maintain a documented plan for continuing operations after a major disruption? | `boolean` | If selected for this subject |
| `shared.operations.continuity_testing` | When was the continuity plan last exercised, and what was improved afterward? | `text` | `shared.operations.business_continuity` = true |
| `shared.operations.safety_owner` | Who is responsible for workplace safety and risk management? | `text` | If selected for this subject |
| `shared.operations.safety_training` | What safety training is provided, and how is completion recorded? | `long_text` | If selected for this subject |
| `shared.operations.outstanding_safety_actions` | Are any identified safety problems still awaiting correction? | `boolean` | If selected for this subject |
| `shared.operations.safety_actions` | Describe the unresolved safety problems and the planned corrective actions. | `long_text` | `shared.operations.outstanding_safety_actions` = true |

<a id="shared-location"></a>
## Operating locations

Repeat for each operating location relevant to a selected line; do not merge locations.

Coverage: `general_liability`, `property`, `workers_compensation`, `commercial_auto`, `professional_liability`, `cyber`, `umbrella`. Subject: `location`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `shared.location.address` | What is the street address of this operating location? | `address` | If selected for this subject |
| `shared.location.activities` | What work takes place at this location? | `long_text` | If selected for this subject |
| `shared.location.ownership` | What is the business's relationship to this location? | `single_choice`: Owned, Leased, Shared premises, Customer site, Other | If selected for this subject |
| `shared.location.staff_count` | How many employees normally work at this location? | `count` | If selected for this subject |
| `shared.location.public_access` | Can customers or other members of the public enter this location? | `boolean` | If selected for this subject |
| `shared.location.public_hours` | When is this location open to the public? | `text` | `shared.location.public_access` = true |
| `shared.location.shared_occupancy` | Does another business occupy part of the premises? | `boolean` | If selected for this subject |
| `shared.location.other_occupants` | Describe the other occupants and their activities. | `long_text` | `shared.location.shared_occupancy` = true |

<a id="shared-insurance"></a>
## Existing insurance and history

Reuse policy evidence and shared answers; obtain an explicit history period before date-bounded questions.

Coverage: `general_liability`, `property`, `workers_compensation`, `commercial_auto`, `professional_liability`, `cyber`, `umbrella`. Subject: `company`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `shared.insurance.has_current_insurance` | Does the business currently carry insurance for any of the requested exposures? | `boolean` | If selected for this subject |
| `shared.insurance.policy_documents` | Provide the current policies or coverage summaries available for review. | `file_refs` | `shared.insurance.has_current_insurance` = true |
| `shared.insurance.has_uninsured_period` | Has any requested exposure been uninsured during the history period specified for this application? | `boolean` | If selected for this subject; requires explicit history dates |
| `shared.insurance.uninsured_details` | Which exposures were uninsured, for what dates, and why? | `long_text` | `shared.insurance.has_uninsured_period` = true |
| `shared.insurance.adverse_insurance_action` | During the specified history period, has an insurer declined, cancelled, or refused to renew coverage for this business? | `boolean` | If selected for this subject; requires explicit history dates |
| `shared.insurance.action_details` | Describe the affected coverage, insurer action, date, and reason. | `long_text` | `shared.insurance.adverse_insurance_action` = true |
| `shared.insurance.has_losses` | During the specified history period, has the business experienced losses, claims, or incidents that could lead to a claim? | `boolean` | If selected for this subject; requires explicit history dates |
| `shared.insurance.loss_runs` | Provide available loss runs for the specified history period. | `file_refs` | `shared.insurance.has_losses` = true; requires explicit history dates |
| `shared.insurance.has_open_disputes` | Are any insurance claims or coverage disputes unresolved? | `boolean` | If selected for this subject |
| `shared.insurance.dispute_details` | Describe the unresolved claims or coverage disputes. | `long_text` | `shared.insurance.has_open_disputes` = true |

<a id="shared-prior_policy"></a>
## Policy schedule

Repeat for each relevant current, previous, or underlying policy.

Coverage: `general_liability`, `property`, `workers_compensation`, `commercial_auto`, `professional_liability`, `cyber`, `umbrella`. Subject: `prior_policy`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `shared.prior_policy.carrier` | Which insurer issued this policy? | `text` | If selected for this subject |
| `shared.prior_policy.number` | What is the policy number? | `sensitive_text` | If selected for this subject |
| `shared.prior_policy.coverage_description` | Which exposures does this policy cover? | `text` | If selected for this subject |
| `shared.prior_policy.start` | When does this policy period begin? | `date` | If selected for this subject |
| `shared.prior_policy.end` | When does this policy period end? | `date` | If selected for this subject |
| `shared.prior_policy.limits` | What limits and sublimits apply to the relevant coverages? | `long_text` | If selected for this subject |
| `shared.prior_policy.retention` | What deductible or self-insured retention applies? | `money` | If selected for this subject |
| `shared.prior_policy.premium` | What is the premium for this policy period? | `money` | If selected for this subject |
| `shared.prior_policy.claims_basis` | What coverage trigger does this policy use? | `single_choice`: Occurrence, Claims made, Other | If selected for this subject |
| `shared.prior_policy.retroactive_date` | What retroactive date applies to this policy? | `date` | `shared.prior_policy.claims_basis` = "claims_made" |

<a id="shared-loss"></a>
## Individual loss or incident

Repeat for reported events, preserving the applicable line and insured entity.

Coverage: `general_liability`, `property`, `workers_compensation`, `commercial_auto`, `professional_liability`, `cyber`, `umbrella`. Subject: `loss`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `shared.loss.occurrence_date` | When did this event occur? | `date` | If selected for this subject |
| `shared.loss.reported_date` | When was this event first reported to the insurer? | `date` | If selected for this subject |
| `shared.loss.coverage` | Which coverage or business activity is involved? | `text` | If selected for this subject |
| `shared.loss.description` | What happened, and what harm or damage resulted? | `long_text` | If selected for this subject |
| `shared.loss.status` | What is the current status of this event? | `single_choice`: Open, Closed, Incident without a claim | If selected for this subject |
| `shared.loss.paid` | How much has been paid for this event so far? | `money` | If selected for this subject |
| `shared.loss.reserve` | What outstanding reserve has the insurer reported? | `money` | If selected for this subject |
| `shared.loss.corrective_action` | What steps were taken to reduce the chance of a similar event? | `long_text` | If selected for this subject |

<a id="gl-coverage"></a>
## General liability terms

Use for the requested general liability coverage instance.

Coverage: `general_liability`. Subject: `coverage`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `gl.coverage.occurrence_limit` | What limit is requested for a single liability occurrence? | `money` | If selected for this subject |
| `gl.coverage.aggregate_limit` | What overall general liability aggregate is requested? | `money` | If selected for this subject |
| `gl.coverage.products_aggregate` | What products and completed-operations aggregate is requested? | `money` | If selected for this subject |
| `gl.coverage.personal_advertising_limit` | What personal and advertising injury limit is requested? | `money` | If selected for this subject |
| `gl.coverage.rented_premises_limit` | What damage-to-rented-premises limit is requested? | `money` | If selected for this subject |
| `gl.coverage.medical_payments_limit` | What medical payments limit is requested? | `money` | If selected for this subject |
| `gl.coverage.retention` | What deductible or self-insured retention is requested? | `money` | If selected for this subject |
| `gl.coverage.coverage_basis` | Which coverage basis is being requested? | `single_choice`: Occurrence, Claims made, Need advice | If selected for this subject |
| `gl.coverage.retroactive_date` | What retroactive date needs to be preserved? | `date` | `gl.coverage.coverage_basis` = "claims_made" |
| `gl.coverage.additional_insureds` | Do any parties need additional-insured status? | `boolean` | If selected for this subject |
| `gl.coverage.additional_insured_detail` | Identify the parties and the operations or agreements that create the requirement. | `long_text` | `gl.coverage.additional_insureds` = true |
| `gl.coverage.waiver_requirements` | Does an agreement require a waiver of subrogation? | `boolean` | If selected for this subject |
| `gl.coverage.waiver_detail` | Identify the parties and contracts requiring the waiver. | `long_text` | `gl.coverage.waiver_requirements` = true |
| `gl.coverage.primary_requirement` | Does an agreement require this liability insurance to respond before another party's insurance? | `boolean` | If selected for this subject |

<a id="gl-exposure"></a>
## General liability operations

Select questions matching the business activities and premises exposures.

Coverage: `general_liability`, `umbrella`. Subject: `company`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `gl.exposure.work_offsite` | Do employees perform work at customer premises or other offsite locations? | `boolean` | If selected for this subject |
| `gl.exposure.offsite_detail` | Describe the offsite activities and the types of customer premises involved. | `long_text` | `gl.exposure.work_offsite` = true |
| `gl.exposure.products` | Does the business manufacture, distribute, import, or sell physical products? | `boolean` | If selected for this subject |
| `gl.exposure.product_detail` | Describe the product categories and the business's role in supplying them. | `long_text` | `gl.exposure.products` = true |
| `gl.exposure.completed_work` | Could work performed by the business cause injury or damage after that work is finished? | `boolean` | If selected for this subject |
| `gl.exposure.completed_work_detail` | Describe the completed-work exposures and how work is inspected before handover. | `long_text` | `gl.exposure.completed_work` = true |
| `gl.exposure.customer_property` | Does the business take possession of property belonging to customers or other parties? | `boolean` | If selected for this subject |
| `gl.exposure.customer_property_detail` | What property is held, what is done with it, and what is its maximum value? | `long_text` | `gl.exposure.customer_property` = true |
| `gl.exposure.contractual_liability` | Does the business accept responsibility for another party's losses under written agreements? | `boolean` | If selected for this subject |
| `gl.exposure.contractual_liability_detail` | Provide representative agreements containing those responsibility provisions. | `file_refs` | `gl.exposure.contractual_liability` = true |
| `gl.exposure.subcontractor_controls` | How does the business check subcontractor qualifications and insurance? | `long_text` | If selected for this subject |
| `gl.exposure.recreation` | Does the business provide recreational activities, events, or participant facilities? | `boolean` | If selected for this subject |
| `gl.exposure.recreation_detail` | Describe those activities, participants, supervision, and protective measures. | `long_text` | `gl.exposure.recreation` = true |
| `gl.exposure.children_vulnerable_people` | Do operations involve caring for, supervising, or transporting children or vulnerable adults? | `boolean` | If selected for this subject |
| `gl.exposure.safeguarding` | What screening, supervision, reporting, and conduct controls apply? | `long_text` | `gl.exposure.children_vulnerable_people` = true |
| `gl.exposure.security_staff` | Does the business use security personnel? | `boolean` | If selected for this subject |
| `gl.exposure.security_detail` | Are security personnel employees or contractors, and what duties do they perform? | `long_text` | `gl.exposure.security_staff` = true |
| `gl.exposure.pollutants` | Do operations involve substances that could contaminate air, soil, or water? | `boolean` | If selected for this subject |
| `gl.exposure.pollution_controls` | Describe the substances, handling procedures, and spill-response arrangements. | `long_text` | `gl.exposure.pollutants` = true |
| `gl.exposure.advertising_content` | Does the business publish advertisements or other content using third-party material? | `boolean` | If selected for this subject |
| `gl.exposure.content_permissions` | How are rights, permissions, and factual claims checked before publication? | `long_text` | `gl.exposure.advertising_content` = true |

<a id="property-terms"></a>
## Property insurance terms

Use for the requested property coverage instance and its insured locations.

Coverage: `property`. Subject: `coverage`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `property.terms.building_limit` | What building coverage amount is requested? | `money` | If selected for this subject |
| `property.terms.contents_limit` | What coverage amount is requested for business contents? | `money` | If selected for this subject |
| `property.terms.stock_peak` | What is the highest inventory value expected during the policy term? | `money` | If selected for this subject |
| `property.terms.valuation` | How should insured property be valued? | `single_choice`: Replacement cost, Actual cash value, Agreed value, Other, Need advice | If selected for this subject |
| `property.terms.property_deductible` | What property deductible is requested? | `money` | If selected for this subject |
| `property.terms.blanket_requested` | Should one combined limit apply across multiple properties or locations? | `boolean` | If selected for this subject |
| `property.terms.blanket_scope` | Which property values and locations should share the combined limit? | `long_text` | `property.terms.blanket_requested` = true |
| `property.terms.business_income` | Is coverage requested for lost income after an insured interruption? | `boolean` | If selected for this subject |
| `property.terms.income_limit` | What business-income limit is requested? | `money` | `property.terms.business_income` = true |
| `property.terms.restoration_period` | For how long could the business need financial support while restoring operations? | `duration` | `property.terms.business_income` = true |
| `property.terms.extra_expense` | Is coverage requested for extra costs incurred to keep operating after damage? | `boolean` | If selected for this subject |
| `property.terms.extra_expense_limit` | What extra-expense limit is requested? | `money` | `property.terms.extra_expense` = true |
| `property.terms.equipment_breakdown` | Is coverage requested for mechanical or electrical breakdown of equipment? | `boolean` | If selected for this subject |
| `property.terms.flood` | Should flood coverage be considered? | `boolean` | If selected for this subject |
| `property.terms.earthquake` | Should earthquake coverage be considered? | `boolean` | If selected for this subject |
| `property.terms.ordinance` | Could rebuilding require extra costs to comply with current building requirements? | `boolean` | If selected for this subject |

<a id="property-building"></a>
## Building characteristics

Repeat for each building to be insured; ask only for structures within requested scope.

Coverage: `property`. Subject: `building`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `property.building.location` | Which operating location contains this building? | `entity_ref` | If selected for this subject |
| `property.building.use` | How is this building used? | `long_text` | If selected for this subject |
| `property.building.year_built` | In what year was the building constructed? | `year` | If selected for this subject |
| `property.building.floor_area` | What is the building's total floor area? | `area` | If selected for this subject |
| `property.building.stories` | How many above-ground stories does the building have? | `count` | If selected for this subject |
| `property.building.basements` | How many below-ground levels does the building have? | `count` | If selected for this subject |
| `property.building.construction` | What materials form the structural frame and exterior walls? | `text` | If selected for this subject |
| `property.building.roof_material` | What material covers the roof? | `text` | If selected for this subject |
| `property.building.roof_update` | In what year was the roof most recently replaced? | `year` | If selected for this subject |
| `property.building.roof_condition` | Describe the roof's current condition and any known defects. | `long_text` | If selected for this subject |
| `property.building.electrical_update` | When was the electrical system last substantially updated? | `year` | If selected for this subject |
| `property.building.plumbing_update` | When was the plumbing system last substantially updated? | `year` | If selected for this subject |
| `property.building.heating_update` | When was the heating system last substantially updated? | `year` | If selected for this subject |
| `property.building.heating_type` | What systems heat the building? | `text` | If selected for this subject |
| `property.building.sprinklered` | Does the building have an automatic sprinkler system? | `boolean` | If selected for this subject |
| `property.building.sprinkler_extent` | What percentage of the building is protected by sprinklers? | `percentage` | `property.building.sprinklered` = true |
| `property.building.sprinkler_inspection` | When was the sprinkler system last inspected? | `date` | `property.building.sprinklered` = true |
| `property.building.fire_alarm` | Does the building have a fire-detection alarm? | `boolean` | If selected for this subject |
| `property.building.fire_alarm_monitoring` | How are fire alarms monitored and who receives an alert? | `text` | `property.building.fire_alarm` = true |
| `property.building.intrusion_alarm` | Does the building have an intrusion alarm? | `boolean` | If selected for this subject |
| `property.building.intrusion_monitoring` | How is the intrusion alarm monitored? | `text` | `property.building.intrusion_alarm` = true |
| `property.building.fire_station_distance` | How far is the building from the responding fire station? | `distance` | If selected for this subject |
| `property.building.hydrant_distance` | How far is the building from the nearest usable fire hydrant? | `distance` | If selected for this subject |
| `property.building.vacant_area` | What percentage of the building is currently vacant or unused? | `percentage` | If selected for this subject |
| `property.building.renovation` | Is construction, renovation, or demolition underway or planned at this building? | `boolean` | If selected for this subject |
| `property.building.renovation_detail` | Describe the work, schedule, contractor, and measures protecting occupied areas. | `long_text` | `property.building.renovation` = true |
| `property.building.unrepaired_damage` | Does the building have existing damage that has not been repaired? | `boolean` | If selected for this subject |
| `property.building.damage_detail` | Describe the damage and the planned repairs. | `long_text` | `property.building.unrepaired_damage` = true |
| `property.building.water_exposure` | Describe nearby water bodies, below-grade exposures, and known drainage problems. | `long_text` | If selected for this subject |
| `property.building.protective_devices` | What systems detect or reduce water leakage, freezing, or backup damage? | `long_text` | If selected for this subject |
| `property.building.neighbor_exposures` | What neighboring operations or physical conditions could affect this building? | `long_text` | If selected for this subject |
| `property.building.interest_holders` | Identify lenders, mortgagees, or other parties with an insurable interest in the building. | `long_text` | If selected for this subject |

<a id="property-contents"></a>
## Contents and interruption

Select for insured contents, inventory, and interruption exposures at this location.

Coverage: `property`. Subject: `location`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `property.contents.contents_description` | What equipment, furnishings, stock, and other contents need coverage here? | `long_text` | If selected for this subject |
| `property.contents.owned_contents_value` | What would it cost to replace the business-owned contents at this location? | `money` | If selected for this subject |
| `property.contents.others_contents` | Is property owned by other parties kept at this location? | `boolean` | If selected for this subject |
| `property.contents.others_contents_value` | What is the maximum value of other parties' property held here? | `money` | `property.contents.others_contents` = true |
| `property.contents.flammable_storage` | Are flammable materials stored at this location? | `boolean` | If selected for this subject |
| `property.contents.storage_controls` | Describe the materials, quantities, storage arrangements, and fire controls. | `long_text` | `property.contents.flammable_storage` = true |
| `property.contents.refrigerated_stock` | Does stock depend on refrigeration or controlled temperature? | `boolean` | If selected for this subject |
| `property.contents.spoilage_value` | What is the maximum value of temperature-sensitive stock at risk? | `money` | `property.contents.refrigerated_stock` = true |
| `property.contents.critical_equipment` | Which machines or systems are essential to operating this location? | `long_text` | If selected for this subject |
| `property.contents.replacement_lead_time` | How long would replacing the most critical equipment normally take? | `duration` | If selected for this subject |
| `property.contents.single_supplier_dependency` | Could disruption at one supplier or customer materially interrupt this location's operations? | `boolean` | If selected for this subject |
| `property.contents.dependency_detail` | Identify the dependencies and available alternatives. | `long_text` | `property.contents.single_supplier_dependency` = true |
| `property.contents.backup_utilities` | What backup power, communications, or water arrangements are available? | `long_text` | If selected for this subject |
| `property.contents.relocation_options` | What options exist for temporarily operating from another location? | `long_text` | If selected for this subject |

<a id="wc-terms"></a>
## Workers’ compensation scope

Confirm jurisdiction and employer scope before state-specific classification or elections.

Coverage: `workers_compensation`. Subject: `coverage`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `wc.terms.covered_jurisdictions` | Which states or jurisdictions need workers' compensation coverage? | `text_list` | If selected for this subject |
| `wc.terms.other_state_work` | Will employees work in additional jurisdictions during the policy term? | `boolean` | If selected for this subject |
| `wc.terms.other_state_details` | Where will that work occur, for how long, and what duties will employees perform? | `long_text` | `wc.terms.other_state_work` = true |
| `wc.terms.employers_accident_limit` | What employers' liability limit is requested for one accident? | `money` | If selected for this subject |
| `wc.terms.employers_disease_policy` | What employers' liability policy limit is requested for disease? | `money` | If selected for this subject |
| `wc.terms.employers_disease_employee` | What employers' liability limit is requested for disease affecting one employee? | `money` | If selected for this subject |
| `wc.terms.experience_modifier` | What is the current experience modification factor, if issued? | `decimal` | If selected for this subject |
| `wc.terms.modifier_document` | Provide the experience-rating worksheet available for this application. | `file_refs` | If selected for this subject |
| `wc.terms.owner_elections` | Do any owners, officers, partners, or members need individual inclusion or exclusion elections? | `boolean` | If selected for this subject |
| `wc.terms.maritime_work` | Do employees perform work on navigable waters or related maritime facilities? | `boolean` | If selected for this subject |
| `wc.terms.federal_contract_work` | Do employees perform work under contracts that may require a specialized workers' compensation program? | `boolean` | If selected for this subject |

<a id="wc-class"></a>
## Payroll and duties

Repeat by employer, jurisdiction, location, and distinct work classification; do not infer a rating code from a job title alone.

Coverage: `workers_compensation`. Subject: `employee_class`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `wc.class.jurisdiction` | In which jurisdiction is this group of employees assigned for payroll reporting? | `text` | If selected for this subject |
| `wc.class.location` | At which operating location is this employee group based? | `entity_ref` | If selected for this subject |
| `wc.class.duties` | What tasks do employees in this group perform? | `long_text` | If selected for this subject |
| `wc.class.class_code` | What workers' compensation classification code has been assigned to this group, if known? | `text` | If selected for this subject |
| `wc.class.headcount` | How many employees are in this group? | `count` | If selected for this subject |
| `wc.class.payroll` | What payroll is projected for this group during the requested policy period? | `period_money` | If selected for this subject |
| `wc.class.overtime` | What overtime payroll is included in that projection? | `period_money` | If selected for this subject |
| `wc.class.remote_work` | Do employees in this group work remotely from locations other than the listed workplace? | `boolean` | If selected for this subject |
| `wc.class.remote_detail` | Where do remote employees work, and what duties do they perform there? | `long_text` | `wc.class.remote_work` = true |

<a id="wc-safety"></a>
## Employment practices and workplace safety

Select according to workforce arrangements and actual work hazards.

Coverage: `workers_compensation`. Subject: `company`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `wc.safety.leased_workers` | Does the business use leased employees or a professional employer organization? | `boolean` | If selected for this subject |
| `wc.safety.leasing_details` | Describe the arrangement and which party provides workers' compensation coverage. | `long_text` | `wc.safety.leased_workers` = true |
| `wc.safety.temporary_workers` | Does the business obtain workers from staffing agencies? | `boolean` | If selected for this subject |
| `wc.safety.staffing_controls` | How are staffing-agency responsibilities and insurance verified? | `long_text` | `wc.safety.temporary_workers` = true |
| `wc.safety.workers_leased_out` | Does the business supply workers to other employers? | `boolean` | If selected for this subject |
| `wc.safety.leased_out_detail` | Describe those workers' duties and the contractual division of responsibilities. | `long_text` | `wc.safety.workers_leased_out` = true |
| `wc.safety.uninsured_subcontractors` | Does the business engage subcontractors without verified workers' compensation coverage? | `boolean` | If selected for this subject |
| `wc.safety.subcontractor_payments` | What payments are projected to subcontractors without verified coverage? | `period_money` | `wc.safety.uninsured_subcontractors` = true |
| `wc.safety.hazardous_work` | Describe work involving heights, excavation, machinery, chemicals, confined spaces, or other significant injury hazards. | `long_text` | If selected for this subject |
| `wc.safety.protective_equipment` | How is protective equipment selected, provided, and its use checked? | `long_text` | If selected for this subject |
| `wc.safety.new_hire_training` | What safety instruction is completed before a new employee begins work? | `long_text` | If selected for this subject |
| `wc.safety.incident_reporting` | How are workplace injuries reported and investigated? | `long_text` | If selected for this subject |
| `wc.safety.return_to_work` | Can the business offer suitable modified duties to injured employees? | `boolean` | If selected for this subject |
| `wc.safety.return_to_work_detail` | Describe the modified-duty process and who coordinates it. | `long_text` | `wc.safety.return_to_work` = true |
| `wc.safety.driver_safety` | What controls apply to employees who drive for work? | `long_text` | If selected for this subject |
| `wc.safety.occupational_exposures` | What ongoing monitoring addresses noise, dust, repetitive motion, or other occupational exposures? | `long_text` | If selected for this subject |

<a id="wc-person"></a>
## Owner and officer elections

Use only for people whose inclusion or exclusion requires an explicit jurisdiction-specific election.

Coverage: `workers_compensation`. Subject: `person`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `wc.person.name` | What is this person's full name? | `text` | If selected for this subject |
| `wc.person.role` | What ownership or officer role does this person hold? | `text` | If selected for this subject |
| `wc.person.ownership_share` | What percentage of the business does this person own? | `percentage` | If selected for this subject |
| `wc.person.duties` | What work does this person perform? | `long_text` | If selected for this subject |
| `wc.person.election` | What coverage election is requested for this person? | `single_choice`: Include, Exclude, Need advice | If selected for this subject |
| `wc.person.jurisdiction` | Which jurisdiction applies to this election? | `text` | If selected for this subject |

<a id="auto-terms"></a>
## Commercial auto coverage

Use for commercial vehicle liability and physical-damage scope.

Coverage: `commercial_auto`. Subject: `coverage`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `auto.terms.liability_limit` | What auto liability limit is requested? | `money` | If selected for this subject |
| `auto.terms.owned_vehicles` | Should the policy cover vehicles owned by the business? | `boolean` | If selected for this subject |
| `auto.terms.hired_vehicles` | Should coverage include vehicles the business rents or hires? | `boolean` | If selected for this subject |
| `auto.terms.nonowned_vehicles` | Do employees or other people use their own vehicles for business activities? | `boolean` | If selected for this subject |
| `auto.terms.nonowned_detail` | Describe who uses personal vehicles, how often, and for which activities. | `long_text` | `auto.terms.nonowned_vehicles` = true |
| `auto.terms.hired_vehicle_cost` | What rental or hiring cost is projected for the policy period? | `period_money` | `auto.terms.hired_vehicles` = true |
| `auto.terms.physical_damage` | Is physical-damage coverage requested for any vehicles? | `boolean` | If selected for this subject |
| `auto.terms.collision_deductible` | What collision deductible is requested? | `money` | `auto.terms.physical_damage` = true |
| `auto.terms.other_damage_deductible` | What deductible is requested for other covered physical damage? | `money` | `auto.terms.physical_damage` = true |
| `auto.terms.uninsured_election` | How should uninsured or underinsured motorist coverage be handled? | `single_choice`: Coverage requested, Review available options, Request to decline where permitted | If selected for this subject |
| `auto.terms.filings` | Are transportation permits or financial-responsibility filings required? | `boolean` | If selected for this subject |
| `auto.terms.filing_details` | Identify the required filings, permit holders, and jurisdictions. | `long_text` | `auto.terms.filings` = true |
| `auto.terms.foreign_travel` | Will insured vehicles be driven outside the policy's home country? | `boolean` | If selected for this subject |
| `auto.terms.foreign_travel_detail` | Identify the countries, frequency, and nature of that travel. | `long_text` | `auto.terms.foreign_travel` = true |

<a id="auto-vehicle"></a>
## Vehicle schedule

Repeat for every vehicle proposed for coverage, retaining its ownership and garaging location.

Coverage: `commercial_auto`. Subject: `vehicle`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `auto.vehicle.vin` | What is this vehicle's identification number? | `text` | If selected for this subject |
| `auto.vehicle.year` | What is the vehicle's model year? | `year` | If selected for this subject |
| `auto.vehicle.make` | Who manufactured this vehicle? | `text` | If selected for this subject |
| `auto.vehicle.model` | What is the vehicle model? | `text` | If selected for this subject |
| `auto.vehicle.body_type` | What type of body or equipment configuration does this vehicle have? | `text` | If selected for this subject |
| `auto.vehicle.ownership` | Who owns or leases this vehicle? | `single_choice`: Business owned, Leased by business, Employee owned, Other | If selected for this subject |
| `auto.vehicle.owner_name` | What is the legal name of the owner or lessor? | `text` | If selected for this subject |
| `auto.vehicle.garaging_address` | Where is this vehicle normally kept overnight? | `address` | If selected for this subject |
| `auto.vehicle.use` | What business activities is this vehicle used for? | `long_text` | If selected for this subject |
| `auto.vehicle.radius` | How far from its base does this vehicle normally travel? | `distance` | If selected for this subject |
| `auto.vehicle.annual_distance` | How far is this vehicle expected to travel in one year? | `distance` | If selected for this subject |
| `auto.vehicle.gross_vehicle_weight` | What is the vehicle's rated gross weight? | `weight` | If selected for this subject |
| `auto.vehicle.seats` | How many passenger seats does the vehicle have? | `count` | If selected for this subject |
| `auto.vehicle.replacement_value` | What value should be used when considering physical-damage coverage? | `money` | If selected for this subject |
| `auto.vehicle.custom_equipment` | Does this vehicle have nonstandard permanently installed equipment? | `boolean` | If selected for this subject |
| `auto.vehicle.custom_equipment_detail` | Describe the added equipment and its replacement value. | `long_text` | `auto.vehicle.custom_equipment` = true |
| `auto.vehicle.personal_use` | Is this vehicle used for personal trips? | `boolean` | If selected for this subject |
| `auto.vehicle.assigned_drivers` | Which listed drivers normally operate this vehicle? | `entity_refs` | If selected for this subject |
| `auto.vehicle.lienholder` | Which lender or lessor needs to be recorded for this vehicle? | `text` | If selected for this subject |

<a id="auto-driver"></a>
## Driver schedule

Repeat for drivers relevant to the requested business coverage; identifiers need restricted handling.

Coverage: `commercial_auto`, `umbrella`. Subject: `driver`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `auto.driver.name` | What is this driver's full name? | `text` | If selected for this subject |
| `auto.driver.date_of_birth` | What is this driver's date of birth? | `sensitive_date` | If selected for this subject |
| `auto.driver.license_number` | What is this driver's license number? | `sensitive_text` | If selected for this subject |
| `auto.driver.license_jurisdiction` | Which jurisdiction issued the license? | `text` | If selected for this subject |
| `auto.driver.license_class` | What license class and endorsements does the driver hold? | `text` | If selected for this subject |
| `auto.driver.experience` | How long has this person driven this type of vehicle? | `duration` | If selected for this subject |
| `auto.driver.hire_date` | When did this person begin driving for the business? | `date` | If selected for this subject |
| `auto.driver.violations` | During the specified driving-history period, has this driver had moving violations or license restrictions? | `boolean` | If selected for this subject; requires explicit history dates |
| `auto.driver.violation_details` | Describe each violation or restriction, its date, and its current status. | `long_text` | `auto.driver.violations` = true |
| `auto.driver.accidents` | During the specified driving-history period, has this driver been involved in vehicle accidents? | `boolean` | If selected for this subject; requires explicit history dates |
| `auto.driver.accident_details` | Describe each accident, its date, and any resulting claim. | `long_text` | `auto.driver.accidents` = true |

<a id="auto-fleet"></a>
## Fleet management

Select for businesses operating or supervising vehicles.

Coverage: `commercial_auto`. Subject: `company`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `auto.fleet.driver_checks` | How are driver qualifications and driving records checked before and after hiring? | `long_text` | If selected for this subject |
| `auto.fleet.maintenance` | How are vehicle inspections, maintenance, and repairs scheduled and recorded? | `long_text` | If selected for this subject |
| `auto.fleet.training` | What training is provided for the vehicles and routes used? | `long_text` | If selected for this subject |
| `auto.fleet.telematics` | Does the business use vehicle tracking or driver-behavior monitoring? | `boolean` | If selected for this subject |
| `auto.fleet.telematics_response` | How are monitoring alerts reviewed and acted on? | `long_text` | `auto.fleet.telematics` = true |
| `auto.fleet.passengers_for_hire` | Does the business transport passengers for payment? | `boolean` | If selected for this subject |
| `auto.fleet.passenger_detail` | Describe the passenger services, routes, and supervision arrangements. | `long_text` | `auto.fleet.passengers_for_hire` = true |
| `auto.fleet.hazardous_cargo` | Are hazardous materials transported? | `boolean` | If selected for this subject |
| `auto.fleet.hazardous_cargo_detail` | Describe the materials, quantities, permits, and handling controls. | `long_text` | `auto.fleet.hazardous_cargo` = true |

<a id="eo-terms"></a>
## Professional liability coverage

Use for the requested professional services coverage and continuity needs.

Coverage: `professional_liability`. Subject: `coverage`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `eo.terms.claim_limit` | What limit is requested for one professional liability claim? | `money` | If selected for this subject |
| `eo.terms.aggregate` | What annual aggregate is requested? | `money` | If selected for this subject |
| `eo.terms.retention` | What deductible or retention is requested? | `money` | If selected for this subject |
| `eo.terms.retroactive_date` | What retroactive date must be preserved for past professional work? | `date` | If selected for this subject |
| `eo.terms.continuous_coverage` | Has professional liability coverage remained continuous since that date? | `boolean` | If selected for this subject |
| `eo.terms.coverage_gaps` | Describe any interruptions in professional liability coverage. | `long_text` | `eo.terms.continuous_coverage` = false |
| `eo.terms.extended_reporting` | Is an extended reporting period needed for a prior policy or discontinued activity? | `boolean` | If selected for this subject |
| `eo.terms.reporting_detail` | Explain the change that creates the reporting-period need. | `long_text` | `eo.terms.extended_reporting` = true |

<a id="eo-services"></a>
## Professional services and controls

Select according to the actual profession, deliverables, clients, and contracts.

Coverage: `professional_liability`. Subject: `company`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `eo.services.services` | What professional services or advice does the business provide? | `long_text` | If selected for this subject |
| `eo.services.revenue_by_service` | How is revenue divided among those services? | `long_text` | If selected for this subject |
| `eo.services.client_industries` | Which industries do clients operate in? | `text_list` | If selected for this subject |
| `eo.services.largest_client_share` | What percentage of revenue comes from the largest client? | `percentage` | If selected for this subject |
| `eo.services.largest_contract` | What is the largest contract value expected during the requested policy period? | `money` | If selected for this subject |
| `eo.services.average_project_duration` | How long does a typical engagement last? | `duration` | If selected for this subject |
| `eo.services.credentials` | What licenses, certifications, or professional qualifications are required for the services offered? | `long_text` | If selected for this subject |
| `eo.services.license_issues` | Are any required professional credentials restricted, suspended, expired, or under investigation? | `boolean` | If selected for this subject |
| `eo.services.license_issue_details` | Describe the credential issues and the work affected. | `long_text` | `eo.services.license_issues` = true |
| `eo.services.written_contracts` | Are client engagements governed by written contracts? | `boolean` | If selected for this subject |
| `eo.services.contract_template` | Provide a representative engagement agreement. | `file_refs` | `eo.services.written_contracts` = true |
| `eo.services.scope_approval` | How are project scope and later changes approved by clients? | `long_text` | If selected for this subject |
| `eo.services.quality_review` | What review occurs before advice or deliverables are sent to clients? | `long_text` | If selected for this subject |
| `eo.services.client_acceptance` | How is client acceptance of completed work documented? | `long_text` | If selected for this subject |
| `eo.services.record_retention` | How long are engagement records retained? | `duration` | If selected for this subject |
| `eo.services.subcontracted_services` | Are professional services performed by subcontractors? | `boolean` | If selected for this subject |
| `eo.services.subcontractor_review` | How are subcontractors' work, qualifications, and insurance checked? | `long_text` | `eo.services.subcontracted_services` = true |
| `eo.services.performance_guarantees` | Does the business guarantee financial results, outcomes, or delivery performance? | `boolean` | If selected for this subject |
| `eo.services.guarantee_detail` | Describe the guarantees and the consequences if they are not met. | `long_text` | `eo.services.performance_guarantees` = true |
| `eo.services.conflicts` | How are conflicts of interest identified and managed? | `long_text` | If selected for this subject |
| `eo.services.known_service_disputes` | Are there unresolved complaints or circumstances that may lead to a professional liability claim? | `boolean` | If selected for this subject |
| `eo.services.service_dispute_detail` | Describe the unresolved matters and their current status. | `long_text` | `eo.services.known_service_disputes` = true |

<a id="cyber-terms"></a>
## Cyber coverage scope

Use to establish requested protection and retentions.

Coverage: `cyber`. Subject: `coverage`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `cyber.terms.incident_limit` | What cyber limit is requested for one incident? | `money` | If selected for this subject |
| `cyber.terms.aggregate` | What cyber policy aggregate is requested? | `money` | If selected for this subject |
| `cyber.terms.retention` | What cyber deductible or retention is requested? | `money` | If selected for this subject |
| `cyber.terms.response_cover` | Should coverage include incident investigation, notification, and recovery costs? | `boolean` | If selected for this subject |
| `cyber.terms.interruption_cover` | Should coverage include income loss caused by a cyber interruption? | `boolean` | If selected for this subject |
| `cyber.terms.provider_interruption` | Should coverage consider interruption caused by a technology provider? | `boolean` | If selected for this subject |
| `cyber.terms.fraud_cover` | Should coverage consider losses from fraudulent payment instructions? | `boolean` | If selected for this subject |
| `cyber.terms.media_cover` | Does the business need coverage for liability arising from published digital content? | `boolean` | If selected for this subject |

<a id="cyber-data"></a>
## Data and technology exposure

Select according to stored information, digital services, and operational dependence on technology.

Coverage: `cyber`. Subject: `company`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `cyber.data.records_categories` | What types of nonpublic information does the business handle? | `multi_choice`: Contact information, Financial information, Payment card information, Health information, Government identifiers, Account credentials, Other | If selected for this subject |
| `cyber.data.people_records` | Approximately how many individuals have nonpublic information held by the business? | `count` | If selected for this subject |
| `cyber.data.record_locations` | In which countries is nonpublic information stored or processed? | `text_list` | If selected for this subject |
| `cyber.data.data_retention` | How does the business determine when information should be deleted? | `long_text` | If selected for this subject |
| `cyber.data.payment_processing` | Does the business accept or process payment cards? | `boolean` | If selected for this subject |
| `cyber.data.payment_arrangement` | Describe how payment-card transactions are handled and which vendors are involved. | `long_text` | `cyber.data.payment_processing` = true |
| `cyber.data.payment_compliance` | What payment-security assessment or validation has been completed? | `text` | `cyber.data.payment_processing` = true |
| `cyber.data.online_services` | Does the business provide customer-facing online applications or services? | `boolean` | If selected for this subject |
| `cyber.data.online_service_detail` | Describe the services and how customers depend on them. | `long_text` | `cyber.data.online_services` = true |
| `cyber.data.critical_systems` | Which systems are essential to delivering products or services? | `long_text` | If selected for this subject |
| `cyber.data.critical_providers` | Which outside technology providers are essential to operations? | `long_text` | If selected for this subject |
| `cyber.data.maximum_tolerable_outage` | How long could essential systems be unavailable before operations suffer materially? | `duration` | If selected for this subject |
| `cyber.data.privacy_owner` | Who is responsible for privacy and information-security decisions? | `text` | If selected for this subject |
| `cyber.data.privacy_notices` | Are privacy notices and data-handling practices reviewed when business activities change? | `boolean` | If selected for this subject |

<a id="cyber-access"></a>
## Identity and access controls

Select for the business's users, administrators, remote connections, and hosted services.

Coverage: `cyber`. Subject: `company`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `cyber.access.mfa_email` | Is multifactor authentication enforced for business email accounts? | `boolean` | If selected for this subject |
| `cyber.access.mfa_remote` | Is multifactor authentication enforced for remote access to business systems? | `boolean` | If selected for this subject |
| `cyber.access.mfa_admin` | Is multifactor authentication enforced for privileged accounts? | `boolean` | If selected for this subject |
| `cyber.access.mfa_exceptions` | Which users or systems are exempt from multifactor authentication, and why? | `long_text` | If selected for this subject |
| `cyber.access.privileged_separation` | Do administrators use separate accounts for privileged work and ordinary daily tasks? | `boolean` | If selected for this subject |
| `cyber.access.access_reviews` | How are access permissions reviewed and removed when roles or employment change? | `long_text` | If selected for this subject |
| `cyber.access.shared_accounts` | Are credentials shared between people? | `boolean` | If selected for this subject |
| `cyber.access.shared_account_controls` | Describe where shared credentials remain and how their use is controlled. | `long_text` | `cyber.access.shared_accounts` = true |
| `cyber.access.password_controls` | What controls prevent weak passwords and reuse of compromised credentials? | `long_text` | If selected for this subject |
| `cyber.access.service_accounts` | How are service-account credentials stored, rotated, and restricted? | `long_text` | If selected for this subject |

<a id="cyber-defense"></a>
## Security operations

Select for networks, endpoints, applications, and cloud environments the business operates.

Coverage: `cyber`. Subject: `company`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `cyber.defense.asset_inventory` | Does the business maintain an inventory of devices, software, and cloud services? | `boolean` | If selected for this subject |
| `cyber.defense.endpoint_protection` | Is security monitoring installed on supported workstations and servers? | `boolean` | If selected for this subject |
| `cyber.defense.endpoint_response` | Who responds to endpoint alerts and during what hours? | `long_text` | `cyber.defense.endpoint_protection` = true |
| `cyber.defense.unsupported_systems` | Are systems in use that no longer receive security updates? | `boolean` | If selected for this subject |
| `cyber.defense.unsupported_controls` | Describe the unsupported systems and the controls isolating or replacing them. | `long_text` | `cyber.defense.unsupported_systems` = true |
| `cyber.defense.patch_process` | How are security updates prioritized, deployed, and checked? | `long_text` | If selected for this subject |
| `cyber.defense.critical_patch_target` | What is the target time for fixing a critical internet-facing vulnerability? | `duration` | If selected for this subject |
| `cyber.defense.vulnerability_scanning` | Are systems regularly scanned for vulnerabilities? | `boolean` | If selected for this subject |
| `cyber.defense.scan_remediation` | How are scan findings assigned, tracked, and verified as resolved? | `long_text` | `cyber.defense.vulnerability_scanning` = true |
| `cyber.defense.penetration_testing` | Are independent attempts made to test whether important systems can be compromised? | `boolean` | If selected for this subject |
| `cyber.defense.test_followup` | When was the latest assessment, and are material findings still open? | `long_text` | `cyber.defense.penetration_testing` = true |
| `cyber.defense.network_segmentation` | How are sensitive systems separated from ordinary user and guest networks? | `long_text` | If selected for this subject |
| `cyber.defense.email_filtering` | What controls detect malicious messages, attachments, and impersonation? | `long_text` | If selected for this subject |
| `cyber.defense.security_logging` | Which security events are logged, and how are suspicious events reviewed? | `long_text` | If selected for this subject |
| `cyber.defense.encryption_devices` | Is sensitive information encrypted on portable devices? | `boolean` | If selected for this subject |
| `cyber.defense.encryption_transfer` | Is sensitive information encrypted when transmitted outside trusted systems? | `boolean` | If selected for this subject |
| `cyber.defense.secure_development` | What security checks occur before business software is released? | `long_text` | If selected for this subject |

<a id="cyber-recovery"></a>
## Recovery and incident response

Select for restoration, interruption, and incident-management preparedness.

Coverage: `cyber`. Subject: `company`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `cyber.recovery.backups` | Are critical systems and data backed up? | `boolean` | If selected for this subject |
| `cyber.recovery.backup_frequency` | How much time passes between backups of critical information? | `duration` | `cyber.recovery.backups` = true |
| `cyber.recovery.backup_isolation` | Is at least one recovery copy protected from alteration using ordinary production credentials? | `boolean` | `cyber.recovery.backups` = true |
| `cyber.recovery.restore_testing` | Are backups tested by restoring representative systems or data? | `boolean` | `cyber.recovery.backups` = true |
| `cyber.recovery.restore_test_date` | When was the latest successful recovery test? | `date` | `cyber.recovery.restore_testing` = true |
| `cyber.recovery.recovery_time` | How long did restoring essential operations take in the latest test? | `duration` | `cyber.recovery.restore_testing` = true |
| `cyber.recovery.response_plan` | Is there a documented cyber incident response plan? | `boolean` | If selected for this subject |
| `cyber.recovery.response_exercise` | When was the incident response plan last exercised? | `date` | `cyber.recovery.response_plan` = true |
| `cyber.recovery.response_contacts` | Who can authorize containment, restoration, legal support, and external communications? | `long_text` | If selected for this subject |
| `cyber.recovery.external_response` | Has an external incident-response provider been identified or retained? | `boolean` | If selected for this subject |
| `cyber.recovery.response_provider` | Which provider would assist during a cyber incident? | `text` | `cyber.recovery.external_response` = true |
| `cyber.recovery.prior_incidents` | During the specified history period, has the business experienced a security incident or privacy complaint? | `boolean` | If selected for this subject; requires explicit history dates |
| `cyber.recovery.incident_details` | Describe the incidents, their impact, and the remediation completed. | `long_text` | `cyber.recovery.prior_incidents` = true |

<a id="cyber-people"></a>
## People, vendors, and payment controls

Select according to staff access, outsourced services, and payment workflows.

Coverage: `cyber`. Subject: `company`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `cyber.people.security_training` | Do employees receive training on phishing, data handling, and incident reporting? | `boolean` | If selected for this subject |
| `cyber.people.training_frequency` | How often is that training repeated? | `duration` | `cyber.people.security_training` = true |
| `cyber.people.phishing_exercises` | Does the business run phishing or impersonation exercises? | `boolean` | If selected for this subject |
| `cyber.people.payment_verification` | Are new or changed payment instructions verified through an independently established contact method? | `boolean` | If selected for this subject |
| `cyber.people.payment_dual_approval` | Do material transfers require approval from more than one person? | `boolean` | If selected for this subject |
| `cyber.people.vendor_assessment` | How are vendors assessed before receiving sensitive data or critical system access? | `long_text` | If selected for this subject |
| `cyber.people.vendor_access` | How is outside access granted, monitored, and revoked? | `long_text` | If selected for this subject |
| `cyber.people.vendor_contracts` | What security, notification, and responsibility terms are included in important vendor agreements? | `long_text` | If selected for this subject |

<a id="umbrella-terms"></a>
## Umbrella and excess structure

Use for the requested excess layer and reviewed underlying policy schedule.

Coverage: `umbrella`. Subject: `coverage`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `umbrella.terms.limit` | What umbrella or excess limit is requested? | `money` | If selected for this subject |
| `umbrella.terms.attachment` | At what underlying limit should the requested layer begin? | `money` | If selected for this subject |
| `umbrella.terms.structure` | What type of excess protection is being requested? | `single_choice`: Umbrella, Following-form excess, Need advice | If selected for this subject |
| `umbrella.terms.underlying_lines` | Which underlying coverage lines should the layer sit above? | `text_list` | If selected for this subject |
| `umbrella.terms.underlying_policies` | Which listed policies provide the underlying coverage? | `entity_refs` | If selected for this subject |
| `umbrella.terms.underlying_expirations` | Will all underlying policies remain in force throughout the requested excess period? | `boolean` | If selected for this subject |
| `umbrella.terms.underlying_gap_detail` | Describe any date mismatches or changes expected in the underlying coverage. | `long_text` | `umbrella.terms.underlying_expirations` = false |
| `umbrella.terms.retention` | What retained amount is acceptable for covered exposures without underlying insurance? | `money` | If selected for this subject |
| `umbrella.terms.foreign_scope` | Does the requested layer need to address operations outside the home country? | `boolean` | If selected for this subject |
| `umbrella.terms.contract_limit` | What total liability limit do relevant contracts require? | `money` | If selected for this subject |

<a id="umbrella-exposure"></a>
## Excess liability exposure

Reuse relevant liability, fleet, and employer facts; investigate differences from the underlying scope.

Coverage: `umbrella`. Subject: `company`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `umbrella.exposure.entities_match` | Do all entities needing excess coverage appear on the relevant underlying policies? | `boolean` | If selected for this subject |
| `umbrella.exposure.entity_gaps` | Identify entities or activities missing from the underlying policies. | `long_text` | `umbrella.exposure.entities_match` = false |
| `umbrella.exposure.underlying_exclusions` | What material exclusions or restricted activities appear in the underlying coverage? | `long_text` | If selected for this subject |
| `umbrella.exposure.large_loss_potential` | Which operations could result in multiple injuries or substantial third-party damage from one event? | `long_text` | If selected for this subject |
| `umbrella.exposure.aviation` | Does the business own, operate, charter, or arrange use of aircraft? | `boolean` | If selected for this subject |
| `umbrella.exposure.aviation_detail` | Describe the aircraft activities and the underlying insurance maintained. | `long_text` | `umbrella.exposure.aviation` = true |
| `umbrella.exposure.watercraft` | Does the business own, operate, or charter watercraft? | `boolean` | If selected for this subject |
| `umbrella.exposure.watercraft_detail` | Describe the vessels, uses, passenger exposures, and underlying insurance. | `long_text` | `umbrella.exposure.watercraft` = true |
| `umbrella.exposure.excess_claims` | During the specified history period, has any loss reached or threatened an underlying liability limit? | `boolean` | If selected for this subject; requires explicit history dates |
| `umbrella.exposure.excess_claim_detail` | Describe those losses and the available underlying limits. | `long_text` | `umbrella.exposure.excess_claims` = true |

<a id="supplement-contractor"></a>
## Construction and contracting

Select when the business performs construction, installation, repair, or trade contracting.

Coverage: `general_liability`, `property`, `workers_compensation`, `professional_liability`, `umbrella`. Subject: `company`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `supplement.contractor.trades` | Which construction or trade activities does the business perform? | `text_list` | If selected for this subject |
| `supplement.contractor.residential_share` | What percentage of work is residential? | `percentage` | If selected for this subject |
| `supplement.contractor.new_construction_share` | What percentage of work is new construction rather than repair or renovation? | `percentage` | If selected for this subject |
| `supplement.contractor.project_size` | What is the largest project value expected during the policy term? | `money` | If selected for this subject |
| `supplement.contractor.maximum_height` | What is the greatest working height involved in the business's work? | `distance` | If selected for this subject |
| `supplement.contractor.excavation` | Does the business excavate or perform below-ground work? | `boolean` | If selected for this subject |
| `supplement.contractor.excavation_depth` | What is the greatest excavation depth expected? | `distance` | `supplement.contractor.excavation` = true |
| `supplement.contractor.roofing` | Does the business perform roofing work? | `boolean` | If selected for this subject |
| `supplement.contractor.roofing_methods` | Describe roofing methods, heat use, and fall-protection measures. | `long_text` | `supplement.contractor.roofing` = true |
| `supplement.contractor.structural_work` | Does the business alter load-bearing structures? | `boolean` | If selected for this subject |
| `supplement.contractor.structural_review` | How are structural designs and work reviewed before execution? | `long_text` | `supplement.contractor.structural_work` = true |
| `supplement.contractor.demolition` | Does the business perform demolition? | `boolean` | If selected for this subject |
| `supplement.contractor.demolition_controls` | Describe the demolition methods and protection of surrounding property. | `long_text` | `supplement.contractor.demolition` = true |
| `supplement.contractor.hot_work` | Does work involve welding, cutting, or other ignition sources? | `boolean` | If selected for this subject |
| `supplement.contractor.hot_work_controls` | How are permits, fire watches, and post-work checks managed? | `long_text` | `supplement.contractor.hot_work` = true |
| `supplement.contractor.hazardous_material_removal` | Does the business remove or disturb asbestos, lead, mold, or other hazardous materials? | `boolean` | If selected for this subject |
| `supplement.contractor.removal_detail` | Describe that work, qualifications, and containment procedures. | `long_text` | `supplement.contractor.hazardous_material_removal` = true |
| `supplement.contractor.underground_utilities` | How are buried services located and protected before work begins? | `long_text` | If selected for this subject |
| `supplement.contractor.jobsite_security` | How are unfinished work, tools, and public access controlled at jobsites? | `long_text` | If selected for this subject |
| `supplement.contractor.subcontractor_cost` | What is the projected cost of subcontracted work? | `period_money` | If selected for this subject |

<a id="supplement-products"></a>
## Manufacturing, importing, and distribution

Select when the business supplies physical products; do not infer manufacturing responsibility from retail sales alone.

Coverage: `general_liability`, `property`, `professional_liability`, `umbrella`. Subject: `company`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `supplement.products.product_categories` | What product categories are manufactured, imported, or distributed? | `text_list` | If selected for this subject |
| `supplement.products.role` | Which roles does the business perform for these products? | `multi_choice`: Design, Manufacture, Assemble, Import, Wholesale, Retail, Repair | If selected for this subject |
| `supplement.products.safety_critical` | Could product failure affect human safety or essential infrastructure? | `boolean` | If selected for this subject |
| `supplement.products.safety_use` | Describe the safety-critical applications and quality controls. | `long_text` | `supplement.products.safety_critical` = true |
| `supplement.products.sales_territories` | Where are products sold or intended to be used? | `text_list` | If selected for this subject |
| `supplement.products.quality_program` | How are incoming materials, production, and finished products checked? | `long_text` | If selected for this subject |
| `supplement.products.batch_traceability` | Can affected products be traced to suppliers, production runs, and customers? | `boolean` | If selected for this subject |
| `supplement.products.recall_plan` | Is there a documented process for withdrawing unsafe products? | `boolean` | If selected for this subject |
| `supplement.products.recall_history` | During the specified history period, have products been recalled or withdrawn for safety or quality concerns? | `boolean` | If selected for this subject; requires explicit history dates |
| `supplement.products.recall_detail` | Describe the affected products, reasons, and corrective actions. | `long_text` | `supplement.products.recall_history` = true |
| `supplement.products.instructions` | How are product warnings, instructions, and labeling reviewed? | `long_text` | If selected for this subject |
| `supplement.products.contract_manufacture` | Are products manufactured by another business under this business's brand? | `boolean` | If selected for this subject |
| `supplement.products.supplier_controls` | How are those manufacturers' quality practices and insurance checked? | `long_text` | `supplement.products.contract_manufacture` = true |

<a id="supplement-hospitality"></a>
## Food, lodging, and liquor

Select for restaurants, bars, lodging, catering, and similar hospitality operations.

Coverage: `general_liability`, `property`, `workers_compensation`, `umbrella`. Subject: `location`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `supplement.hospitality.food_service` | Is food prepared or served at this location? | `boolean` | If selected for this subject |
| `supplement.hospitality.cooking_methods` | What cooking equipment and processes are used? | `long_text` | `supplement.hospitality.food_service` = true |
| `supplement.hospitality.kitchen_suppression` | Is cooking equipment protected by an appropriate fire-suppression system? | `boolean` | `supplement.hospitality.food_service` = true |
| `supplement.hospitality.kitchen_maintenance` | How are exhaust systems and suppression equipment cleaned and serviced? | `long_text` | `supplement.hospitality.food_service` = true |
| `supplement.hospitality.food_safety` | How are food storage, temperature, allergens, and sanitation controlled? | `long_text` | `supplement.hospitality.food_service` = true |
| `supplement.hospitality.alcohol` | Is alcohol sold, served, or supplied at this location? | `boolean` | If selected for this subject |
| `supplement.hospitality.alcohol_revenue_share` | What percentage of revenue comes from alcohol? | `percentage` | `supplement.hospitality.alcohol` = true |
| `supplement.hospitality.alcohol_controls` | How are age checks, service limits, and staff training managed? | `long_text` | `supplement.hospitality.alcohol` = true |
| `supplement.hospitality.entertainment` | Are live entertainment, dancing, or organized events offered? | `boolean` | If selected for this subject |
| `supplement.hospitality.entertainment_detail` | Describe the events, attendance, and crowd-management arrangements. | `long_text` | `supplement.hospitality.entertainment` = true |
| `supplement.hospitality.lodging` | Are overnight accommodations provided? | `boolean` | If selected for this subject |
| `supplement.hospitality.room_count` | How many guest rooms or accommodation units are provided? | `count` | `supplement.hospitality.lodging` = true |
| `supplement.hospitality.pool` | Is a swimming pool, spa, or similar water facility available? | `boolean` | If selected for this subject |
| `supplement.hospitality.pool_controls` | Describe access controls, supervision, inspections, and emergency equipment. | `long_text` | `supplement.hospitality.pool` = true |

<a id="supplement-technology"></a>
## Technology services and software

Select when the business develops, hosts, administers, or supports technology for customers.

Coverage: `professional_liability`, `cyber`, `general_liability`. Subject: `company`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `supplement.technology.service_model` | Describe the software, hosting, support, or managed services supplied to customers. | `long_text` | If selected for this subject |
| `supplement.technology.customer_dependence` | What would happen to customers if the service failed or produced incorrect results? | `long_text` | If selected for this subject |
| `supplement.technology.critical_sectors` | Which customer sectors depend on the service for safety, payments, healthcare, or other essential functions? | `text_list` | If selected for this subject |
| `supplement.technology.service_commitments` | What uptime, recovery, accuracy, or performance commitments are made to customers? | `long_text` | If selected for this subject |
| `supplement.technology.release_controls` | How are changes tested, approved, deployed, and rolled back? | `long_text` | If selected for this subject |
| `supplement.technology.customer_data_access` | Can personnel access customer systems or customer data? | `boolean` | If selected for this subject |
| `supplement.technology.access_controls` | How is that access restricted, logged, and reviewed? | `long_text` | `supplement.technology.customer_data_access` = true |
| `supplement.technology.third_party_components` | How are third-party software components and dependencies reviewed and maintained? | `long_text` | If selected for this subject |
| `supplement.technology.intellectual_property` | How does the business confirm its rights to use and distribute code and other materials? | `long_text` | If selected for this subject |
| `supplement.technology.automated_decisions` | Do products make automated decisions that materially affect customers or other people? | `boolean` | If selected for this subject |
| `supplement.technology.decision_controls` | How are automated outputs evaluated, monitored, and corrected? | `long_text` | `supplement.technology.automated_decisions` = true |

<a id="supplement-healthcare"></a>
## Healthcare and licensed care services

Select only for healthcare or care-service businesses; resolve profession and jurisdiction before specialized questions.

Coverage: `professional_liability`, `general_liability`, `workers_compensation`, `cyber`, `umbrella`. Subject: `company`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `supplement.healthcare.professions` | Which licensed professions provide services through the business? | `text_list` | If selected for this subject |
| `supplement.healthcare.services` | What patient or client services are delivered? | `long_text` | If selected for this subject |
| `supplement.healthcare.care_settings` | Where are services delivered, including remote and home-based care? | `text_list` | If selected for this subject |
| `supplement.healthcare.patient_volume` | How many patients or clients are served during the stated reporting period? | `period_count` | If selected for this subject |
| `supplement.healthcare.procedures` | Which procedures involve sedation, surgery, invasive treatment, or other elevated risk? | `long_text` | If selected for this subject |
| `supplement.healthcare.credential_checks` | How are licenses, qualifications, and privileges verified? | `long_text` | If selected for this subject |
| `supplement.healthcare.supervision` | How is work delegated and supervised among different professional roles? | `long_text` | If selected for this subject |
| `supplement.healthcare.consent` | How is informed consent documented for treatment? | `long_text` | If selected for this subject |
| `supplement.healthcare.records` | How are care records protected, retained, and made available for continuity of care? | `long_text` | If selected for this subject |
| `supplement.healthcare.emergency_response` | What arrangements exist for medical emergencies and transfer to a higher level of care? | `long_text` | If selected for this subject |

<a id="supplement-transport"></a>
## Freight and transportation

Select for carriage of goods, freight brokerage, or transport logistics.

Coverage: `commercial_auto`, `general_liability`, `property`, `workers_compensation`, `umbrella`. Subject: `company`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `supplement.transport.transport_role` | Which transportation roles does the business perform? | `multi_choice`: Carrier, Freight broker, Freight forwarder, Warehouse operator, Other | If selected for this subject |
| `supplement.transport.commodities` | What goods are transported or arranged for transport? | `text_list` | If selected for this subject |
| `supplement.transport.maximum_cargo_value` | What is the highest cargo value on one vehicle or conveyance? | `money` | If selected for this subject |
| `supplement.transport.routes` | Describe the operating routes and maximum travel distances. | `long_text` | If selected for this subject |
| `supplement.transport.owner_operators` | Does the business use independent owner-operators? | `boolean` | If selected for this subject |
| `supplement.transport.owner_operator_contracts` | How are vehicle responsibility and insurance allocated in owner-operator agreements? | `long_text` | `supplement.transport.owner_operators` = true |
| `supplement.transport.load_security` | How are loads secured and checked during transport? | `long_text` | If selected for this subject |
| `supplement.transport.theft_controls` | What measures protect loaded vehicles and cargo during stops and overnight parking? | `long_text` | If selected for this subject |
| `supplement.transport.temperature_control` | Does any cargo require controlled temperature? | `boolean` | If selected for this subject |
| `supplement.transport.temperature_monitoring` | How are temperatures monitored and failures handled? | `long_text` | `supplement.transport.temperature_control` = true |

<a id="supplement-real_estate"></a>
## Property ownership and management

Select for landlords, property managers, and real-estate service businesses.

Coverage: `general_liability`, `property`, `professional_liability`, `umbrella`. Subject: `company`.

| ID | Question | Answer | When |
| --- | --- | --- | --- |
| `supplement.real_estate.role` | Which real-estate activities does the business perform? | `multi_choice`: Property owner, Property manager, Brokerage, Leasing, Development, Other | If selected for this subject |
| `supplement.real_estate.property_types` | What types of properties are owned, managed, or serviced? | `text_list` | If selected for this subject |
| `supplement.real_estate.unit_count` | How many tenant units are within the requested scope? | `count` | If selected for this subject |
| `supplement.real_estate.maintenance` | How are inspections, maintenance requests, and urgent repairs managed? | `long_text` | If selected for this subject |
| `supplement.real_estate.tenant_insurance` | What insurance is required from tenants, and how is it checked? | `long_text` | If selected for this subject |
| `supplement.real_estate.security` | How are building access, common areas, and security complaints managed? | `long_text` | If selected for this subject |
| `supplement.real_estate.client_funds` | Does the business hold client rents, deposits, or other funds? | `boolean` | If selected for this subject |
| `supplement.real_estate.fund_controls` | How are client funds separated, reconciled, and authorized for payment? | `long_text` | `supplement.real_estate.client_funds` = true |
