export const PARK_ATTRACTIONS = [
  { code: "ZIPRIDER", name: "ZipRider" },
  { code: "VIA_FERRATA", name: "Vía Ferrata" },
  { code: "CIRCUITO_TIROLESA", name: "Circuito de tirolesas" },
  { code: "BOSQUE_AEREO", name: "Bosque Aéreo" }
];

const PARK_ATTRACTION_CODES = PARK_ATTRACTIONS.map((item) => item.code);

export function sortParkAttractions(items) {
  const order = new Map(PARK_ATTRACTIONS.map((item, index) => [item.code, index]));
  return [...items].sort(
    (a, b) => (order.get(a.code) ?? 99) - (order.get(b.code) ?? 99)
  );
}

export async function ensureParkAttractions(Attraction, defaultWaiverText) {
  for (const spec of PARK_ATTRACTIONS) {
    await Attraction.findOneAndUpdate(
      { code: spec.code },
      {
        $set: {
          name: spec.name,
          active: true,
          stripeEnabled: false
        },
        $setOnInsert: {
          description: "",
          waiverText: defaultWaiverText
        }
      },
      { upsert: true }
    );
  }

  await Attraction.updateMany(
    { code: { $nin: PARK_ATTRACTION_CODES } },
    { $set: { active: false } }
  );
}
