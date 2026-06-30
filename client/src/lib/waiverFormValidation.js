export const REFERENCE_MIN_LENGTH = 2;
export const PHONE_MIN_LENGTH = 7;

export function meaningfulText(value, minLength = REFERENCE_MIN_LENGTH) {
  return String(value || "").trim().length >= minLength;
}

export function indicatesNoMedications(medications) {
  const text = String(medications || "").trim().toLowerCase();
  return !text || text === "no" || text === "ninguno" || text === "ninguna";
}

export function requiresPhysicianInfo(takesMedications, medications) {
  if (takesMedications === "no") return false;
  if (takesMedications === "yes") return true;
  return !indicatesNoMedications(medications);
}

export function collectWaiverFieldErrors({
  form,
  selectedAttractionId,
  takesMedications,
  selectedNationality,
  selectedState,
  selectedCity,
  customCity,
  foreignCityState
}) {
  const errors = {};

  if (!selectedAttractionId) errors.attractionId = true;
  if (!meaningfulText(form.fullName, 3)) errors.fullName = true;
  if (!form.birthDate) errors.birthDate = true;
  if (!form.gender) errors.gender = true;
  if (!meaningfulText(form.phone, PHONE_MIN_LENGTH)) errors.phone = true;
  if (!meaningfulText(form.email, 5) || !String(form.email).includes("@")) errors.email = true;

  if (!selectedNationality) errors.nationality = true;

  if (selectedNationality === "México") {
    if (!selectedState) errors.state = true;
    if (!selectedCity) errors.city = true;
    if (selectedCity === "Otra" && !meaningfulText(customCity, 2)) errors.customCity = true;
  } else if (!meaningfulText(foreignCityState, 3)) {
    errors.foreignCityState = true;
  }

  if (!takesMedications) errors.takesMedications = true;
  if (takesMedications === "yes") {
    if (!meaningfulText(form.medications, 2)) errors.medications = true;
    if (!meaningfulText(form.treatingPhysician, 2)) errors.treatingPhysician = true;
    if (!meaningfulText(form.physicianPhone, PHONE_MIN_LENGTH)) errors.physicianPhone = true;
  }

  if (!meaningfulText(form.emergencyContactName)) errors.emergencyContactName = true;
  if (!meaningfulText(form.emergencyContactRelationship)) errors.emergencyContactRelationship = true;
  if (!meaningfulText(form.emergencyContactPhone, PHONE_MIN_LENGTH)) errors.emergencyContactPhone = true;
  if (!meaningfulText(form.familyReference2Name)) errors.familyReference2Name = true;
  if (!meaningfulText(form.familyReference2Relationship)) errors.familyReference2Relationship = true;
  if (!meaningfulText(form.familyReference2Phone, PHONE_MIN_LENGTH)) errors.familyReference2Phone = true;

  if (form.acceptsSafetyRules !== true) errors.acceptsSafetyRules = true;
  if (form.acceptedText !== true) errors.acceptedText = true;

  return errors;
}
