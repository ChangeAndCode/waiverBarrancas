const STATES = [
  "Aguascalientes",
  "Baja California",
  "Baja California Sur",
  "Campeche",
  "Chiapas",
  "Chihuahua",
  "Ciudad de México",
  "Coahuila",
  "Colima",
  "Durango",
  "Estado de México",
  "Guanajuato",
  "Guerrero",
  "Hidalgo",
  "Jalisco",
  "Michoacán",
  "Morelos",
  "Nayarit",
  "Nuevo León",
  "Oaxaca",
  "Puebla",
  "Querétaro",
  "Quintana Roo",
  "San Luis Potosí",
  "Sinaloa",
  "Sonora",
  "Tabasco",
  "Tamaulipas",
  "Tlaxcala",
  "Veracruz",
  "Yucatán",
  "Zacatecas"
];
const NATIONALITIES = [
  "México",
  "Estados Unidos",
  "Canadá",
  "Guatemala",
  "Colombia",
  "Argentina",
  "España",
  "Francia",
  "Alemania",
  "Reino Unido",
  "Brasil",
  "Chile",
  "Perú",
  "Otra"
];
// Strict classification: exact captured country and a known state suffix, with a nonempty city.
export function provenanceExpression() {
  const nationality = { $trim: { input: { $ifNull: ['$participant.nationality', ''] } } };
  const city = { $trim: { input: { $ifNull: ['$participant.cityState', ''] } } };
  return { $switch: { branches: [
    { case: { $eq: [city, ''] }, then: 'Sin procedencia' },
    ...STATES.map(state => ({ case: { $and: [
      { $eq: [nationality, 'México'] },
      { $regexMatch: { input: city, regex: `^[^,]*[^\\s,][^,]*, ${state}$` } }
    ] }, then: state })),
    { case: { $in: [nationality, NATIONALITIES.filter(n => !['México', 'Otra'].includes(n))] }, then: 'Extranjero' }
  ], default: 'Procedencia no clasificable' } };
}
export const PROVENANCE_CATEGORIES = [...STATES, 'Extranjero', 'Sin procedencia', 'Procedencia no clasificable'];
