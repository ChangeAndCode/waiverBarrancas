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

const STATE_CAPITALS = {
  Aguascalientes: "Aguascalientes",
  "Baja California": "Mexicali",
  "Baja California Sur": "La Paz",
  Campeche: "Campeche",
  Chiapas: "Tuxtla Gutiérrez",
  Chihuahua: "Chihuahua",
  "Ciudad de México": "Ciudad de México",
  Coahuila: "Saltillo",
  Colima: "Colima",
  Durango: "Durango",
  "Estado de México": "Toluca",
  Guanajuato: "León",
  Guerrero: "Chilpancingo",
  Hidalgo: "Pachuca",
  Jalisco: "Guadalajara",
  Michoacán: "Morelia",
  Morelos: "Cuernavaca",
  Nayarit: "Tepic",
  "Nuevo León": "Monterrey",
  Oaxaca: "Oaxaca",
  Puebla: "Puebla",
  Querétaro: "Querétaro",
  "Quintana Roo": "Cancún",
  "San Luis Potosí": "San Luis Potosí",
  Sinaloa: "Culiacán",
  Sonora: "Hermosillo",
  Tabasco: "Villahermosa",
  Tamaulipas: "Ciudad Victoria",
  Tlaxcala: "Tlaxcala",
  Veracruz: "Xalapa",
  "Yucatán": "Mérida",
  Zacatecas: "Zacatecas"
};

const EXTRA_CITIES = {
  Chihuahua: [
    "Chihuahua",
    "Ciudad Juárez",
    "Delicias",
    "Cuauhtémoc",
    "Parral",
    "Creel",
    "Urique",
    "Divisadero",
    "Barrancas del Cobre"
  ],
  "Baja California": ["Tijuana", "Mexicali", "Ensenada", "Rosarito"],
  Jalisco: ["Guadalajara", "Puerto Vallarta", "Zapopan"],
  "Nuevo León": ["Monterrey", "San Pedro Garza García"],
  "Quintana Roo": ["Cancún", "Playa del Carmen", "Tulum", "Chetumal"],
  Sonora: ["Hermosillo", "Nogales", "Ciudad Obregón"],
  Sinaloa: ["Culiacán", "Mazatlán", "Los Mochis"]
};

export function citiesForState(state) {
  if (!state) return [];
  const extras = EXTRA_CITIES[state] || [];
  const capital = STATE_CAPITALS[state];
  const cities = [...new Set([...(capital ? [capital] : []), ...extras])].sort((a, b) =>
    a.localeCompare(b, "es")
  );
  cities.push("Otra");
  return cities;
}

export function buildCityStateLabel({ nationality, state, city, customCity, foreignCityState }) {
  if (nationality === "México") {
    const cityLabel = city === "Otra" ? String(customCity || "").trim() : city;
    if (!cityLabel || !state) return "";
    return `${cityLabel}, ${state}`;
  }
  return String(foreignCityState || "").trim();
}
