const LIMITS = {
  ZIPRIDER: { min: 45, max: 99 },
  VIA_FERRATA: { min: 40, max: 99 },
  CIRCUITO_TIROLESA: { min: 45, max: 118 },
  BOSQUE_AEREO: { min: 40, max: 80 }
};

function attractionCode(attraction) {
  return String(attraction?.code || "").toUpperCase() || String(attraction?.name || "").toUpperCase();
}

export function waiverAlerts(waiver, attraction = {}) {
  const alerts = [];
  const answers = waiver?.answers || {};
  const participant = waiver?.participant || {};
  if (answers.hasMedicalCondition) alerts.push({ code: "medical_condition", severity: "high", message: "El visitante declaró una condición médica." });
  if (answers.consumedAlcoholOrDrugs) alerts.push({ code: "alcohol_or_drugs", severity: "high", message: "El visitante declaró consumo de alcohol o drogas." });
  if (participant.medications && !/^no$/i.test(String(participant.medications).trim())) alerts.push({ code: "medication", severity: "medium", message: "El visitante indicó medicamentos." });
  const birth = participant.birthDate ? new Date(`${participant.birthDate}T00:00:00`) : null;
  if (birth && !Number.isNaN(birth.getTime())) {
    const age = Math.floor((Date.now() - birth.getTime()) / 31557600000);
    if (age > 84) alerts.push({ code: "age_limit", severity: "high", message: "El visitante supera la edad máxima de 84 años." });
  }
  const limit = LIMITS[attractionCode(attraction)];
  const weight = Number(waiver?.safetyVerification?.weightVerified ?? participant.weight);
  if (limit && Number.isFinite(weight) && (weight < limit.min || weight > limit.max)) {
    alerts.push({ code: "weight_out_of_range", severity: "high", message: `Peso fuera de rango para la actividad (${limit.min}-${limit.max} kg).` });
  }
  return alerts;
}

export function weightRangeFor(attraction) {
  return LIMITS[attractionCode(attraction)] || null;
}
