function formatMxDateTime(date) {
  const datePart = new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(date);
  const timePart = new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
  return `${datePart}, ${timePart} h`;
}

function normalizeWaiverTextLayout(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n\n")
    .map((paragraph) => paragraph.replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

export function renderWaiverTextForSignature(text, signedAt = new Date()) {
  return normalizeWaiverTextLayout(text).replaceAll("{{SIGN_DATE}}", formatMxDateTime(signedAt));
}

export const defaultWaiverTextMx2026 = `
Aguascalientes, Mexico a {{SIGN_DATE}}

Con plena capacidad legal para celebrar el presente instrumento y sin que exista vicio alguno en mi consentimiento,
incluyendo error, violencia o dolo, manifiesto de manera voluntaria y expresa mi total conformidad con lo estipulado
en el clausulado del presente instrumento y que rige la actividad de Parque Barrancas, administrado por la persona moral
Promotora de Simbolos !Ah Chihuahua!, S.C., implementada en el marco de la Feria de San Marcos 2026.

1. La persona participante en el presente acto reconoce y acepta que ha solicitado de manera libre, consciente y voluntaria
su participacion en la actividad del Parque Barrancas, implementada en el marco de la Feria de San Marcos 2026, consistente
en una tirolesa de 213 metros de longitud, con una torre de salida de 14 metros de altura y una zona de llegada a nivel de piso.

2. La persona participante manifiesta que esta plenamente consciente de que la actividad del Parque Barrancas es de alto riesgo
y que implica peligros inherentes (incluyendo la posibilidad de lesiones severas y/o muerte), mismos que no pueden eliminarse
aun cuando se adopten todas las medidas de seguridad, cuidado, prevencion, capacitacion o supervision. En virtud de lo anterior,
la persona participante manifiesta que comprende la naturaleza y el alcance de los riesgos asociados a dicha actividad y que,
de manera libre, voluntaria e informada, asume total responsabilidad por su participacion.

3. La persona participante reconoce que ha sido informada de las caracteristicas de la actividad, asi como de las medidas de
seguridad y uso del equipo correspondiente.

4. La persona participante se obliga a obedecer en todo momento las instrucciones del personal de Parque Barrancas y a respetar
las restricciones de seguridad establecidas para la actividad.

5. La persona participante declara que no se encuentra bajo los efectos del alcohol, drogas o estupefacientes, ni en estado de embarazo,
que pudieran afectar su habilidad para participar en la actividad de Parque Barrancas. Asimismo, manifiesta que no padece ninguna de las
siguientes enfermedades ni se encuentra bajo tratamiento de las mismas: enfermedad y/o condicion cardiaca o pulmonar, presion sanguinea baja
o alta, desmayos o convulsiones, perdida o impedimento de vista u oido, desordenes nerviosos, diabetes, enfermedades del higado o relacionadas,
falta de respiracion o aliento, enfermedades relacionadas que requieren tratamiento o evaluacion medica, cirugias, o lesiones previas,
u operaciones en la columna. Ademas, declara que no esta bajo medicamentos y no ha ingerido bebidas alcoholicas, drogas o estupefacientes
dentro de las ultimas doce (12) horas y acepta sujetarse a la evaluacion y restricciones que determine el personal de Parque Barrancas.

6. Restricciones de edad y peso:
- Edad maxima: 84 anos.
- Peso permitido: 45 kg a 118 kg.
- Altura minima: 1.50 m; altura maxima: 2.00 m.
- Por seguridad, en caso de estar cercano al limite maximo de peso se realizara una prueba fisica por parte del encargado de la actividad.

LA PERSONA PARTICIPANTE DECLARA HABER LEIDO EL PRESENTE DOCUMENTO, COMPRENDER SU CONTENIDO Y ALCANCE LEGAL,
Y FIRMARLO DE CONFORMIDAD, SIN QUE MEDIE ERROR, DOLO O MALA FE.
`.trim();
