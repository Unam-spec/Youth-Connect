// School & university suggestions for registration / profile forms.
//
// The youth group is based in Limpopo's Waterberg District (South Africa), so
// these lists are South African. Centralised here so every form (register, my,
// the leader edit dialog) stays in sync — previously each kept its own copy and
// they drifted out of date.
//
// The forms always allow a free-typed custom school, so this list only needs to
// cover the common cases, not every school in the district.

export const WATERBERG_SCHOOLS = [
  "Hoërskool Ellisras",
  "Hoërskool Frikkie Meyer",
];

export const SA_UNIVERSITIES = [
  "UP", "UCT", "Wits", "Stellenbosch", "UJ", "UNISA", "DUT", "UKZN", "NWU",
  "UFS", "WSU", "MUT", "CUT", "UFH", "UWC", "RU", "SMU", "VUT", "TUT", "CPUT", "NMU",
];

export const NONE_SCHOOL = "None / Completed Schooling";

// Flat list of every suggestion, for forms that present a single combined dropdown.
export const SCHOOL_OPTIONS = [
  ...WATERBERG_SCHOOLS,
  ...SA_UNIVERSITIES,
  NONE_SCHOOL,
];
