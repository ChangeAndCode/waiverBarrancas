import mexicoMunicipios from "./data/mexico-municipios.json";

export const NATIONALITIES = [
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

export const MEXICO_STATES = [
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

const MUNICIPALITIES_BY_STATE = mexicoMunicipios.byState;

export function citiesForState(state) {
  if (!state) return [];
  const municipalities = MUNICIPALITIES_BY_STATE[state] || [];
  return [...municipalities, "Otra"];
}

export function buildCityStateLabel({ nationality, state, city, customCity, foreignCityState }) {
  if (nationality === "México") {
    const cityLabel = city === "Otra" ? String(customCity || "").trim() : city;
    if (!cityLabel || !state) return "";
    return `${cityLabel}, ${state}`;
  }
  return String(foreignCityState || "").trim();
}
