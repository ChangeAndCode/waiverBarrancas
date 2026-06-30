import { FolioCounter } from "../models/FolioCounter.js";
import { Waiver } from "../models/Waiver.js";

const COUNTER_ID = "waiver";

async function ensureFolioCounter() {
  const exists = await FolioCounter.exists({ _id: COUNTER_ID });
  if (exists) return;

  const waivers = await Waiver.find({ folio: { $regex: /^PB\d+$/ } })
    .select("folio")
    .lean();

  let max = 0;
  for (const w of waivers) {
    const n = Number.parseInt(String(w.folio).slice(2), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }

  try {
    await FolioCounter.create({ _id: COUNTER_ID, seq: max });
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
}

export async function generateWaiverFolio() {
  await ensureFolioCounter();
  const doc = await FolioCounter.findByIdAndUpdate(
    COUNTER_ID,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return `PB${doc.seq}`;
}

export function waiverDisplayId(waiver) {
  if (!waiver) return "";
  return waiver.folio || String(waiver._id || waiver.id || "");
}
