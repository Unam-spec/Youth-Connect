// School & university suggestions for registration / profile forms.
//
// The youth group is based in Limpopo's Waterberg District (South Africa), so
// these lists are South African. Centralised here so every form (register, my,
// the leader edit dialog) stays in sync — previously each kept its own copy and
// they drifted out of date.
//
// The forms always allow a free-typed custom school, so this list only needs to
// cover the common cases, not every school in the district.

// High schools in / around the Waterberg District (Limpopo). These are the
// primary suggestions — most of our youth attend one of these. Forms still allow
// a free-typed custom school, so this only needs to cover the common cases.
export const WATERBERG_SCHOOLS = [
  "MSTS",
  "Waterberg Academy",
  "Hoërskool Ellisras",
  "Hoërskool Frikkie Meyer",
  "Hoërskool Nylstroom",
  "Hoërskool Bela-Bela",
  "Hoërskool Piet Potgieter",
];

// Kept short and locally relevant — the audience is mostly high-schoolers, so we
// only surface the tertiary institutions our older youth actually attend rather
// than the full national list. Custom entries remain possible.
export const SA_UNIVERSITIES = [
  "University of Limpopo", "TUT", "UNISA", "UP",
];

export const NONE_SCHOOL = "None / Completed Schooling";

// Flat list of every suggestion, for forms that present a single combined dropdown.
export const SCHOOL_OPTIONS = [
  ...WATERBERG_SCHOOLS,
  ...SA_UNIVERSITIES,
  NONE_SCHOOL,
];
