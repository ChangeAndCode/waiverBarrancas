function getResendConfig() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.RESEND_FROM_EMAIL || "").trim();
  return { apiKey, from };
}

export function canSendEmails() {
  const { apiKey, from } = getResendConfig();
  return Boolean(apiKey && from);
}

function resolveEmailLocale(locale) {
  return String(locale || "").trim().toLowerCase() === "en" ? "en" : "es";
}

const EMAIL_COPY = {
  es: {
    header: "Confirmación de registro",
    greeting: (name) => `Hola ${name}`,
    registered: "Tu waiver quedó registrado correctamente para:",
    folio: "Folio",
    attractions: "Atracciones",
    date: "Fecha",
    showQr: "Presenta este código QR al ingresar:",
    qrAlt: "QR de acceso",
    viewLink: "Ver enlace de validación",
    footer:
      "Guarda este correo como comprobante. Si no se visualiza el QR, usa este enlace:",
    subject: (names) => `Tu QR de acceso - ${names}`
  },
  en: {
    header: "Registration confirmation",
    greeting: (name) => `Hello ${name}`,
    registered: "Your waiver was successfully registered for:",
    folio: "Reference",
    attractions: "Activities",
    date: "Date",
    showQr: "Show this QR code when you arrive:",
    qrAlt: "Access QR code",
    viewLink: "Open validation link",
    footer:
      "Keep this email as your receipt. If the QR code does not display, use this link:",
    subject: (names) => `Your access QR - ${names}`
  }
};

function formatAttractionsHtml(attractionNames) {
  const names = Array.isArray(attractionNames) ? attractionNames.filter(Boolean) : [];
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  const items = names.map((name) => `<li style="margin:0;">${name}</li>`).join("");
  return `<ul style="margin:6px 0 0;padding-left:18px;line-height:1.45;">${items}</ul>`;
}

export async function sendWaiverQrEmail({
  to,
  participantName,
  attractionName,
  attractionNames,
  waiverId,
  signedAt,
  qrUrl,
  qrImageUrl,
  logoUrl,
  locale
}) {
  const { apiKey, from } = getResendConfig();
  if (!apiKey || !from || !to) {
    return { sent: false };
  }

  const lang = resolveEmailLocale(locale);
  const copy = EMAIL_COPY[lang];
  const names =
    Array.isArray(attractionNames) && attractionNames.length
      ? attractionNames
      : String(attractionName || "")
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean);
  const attractionsHtml = formatAttractionsHtml(names);
  const signedAtText = new Date(signedAt).toLocaleString(lang === "en" ? "en-US" : "es-MX");
  const html = `
      <div style="margin:0;padding:24px;background:#F5F5F7;font-family:Arial,sans-serif;color:#25252B;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px;margin:0 auto;background:#F5F5F7;border:1px solid rgba(37,37,43,0.12);border-radius:12px;">
          <tr>
            <td style="padding:18px 20px;background:#25252B;border-radius:12px 12px 0 0;text-align:center;">
              ${
                logoUrl
                  ? `<img src="${logoUrl}" alt="Parque Barrancas" style="max-width:140px;width:100%;height:auto;display:block;margin:0 auto 10px;" />`
                  : ""
              }
              <p style="margin:0;color:#F5F5F7;font-size:14px;letter-spacing:.2px;">${copy.header}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 20px;background:#F5F5F7;">
              <h2 style="margin:0 0 8px;font-size:20px;color:#25252B;">${copy.greeting(participantName)}</h2>
              <p style="margin:0 0 12px;line-height:1.45;color:#25252B;">${copy.registered}</p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#F5F5F7;border:1px solid rgba(37,37,43,0.12);border-radius:8px;">
                <tr>
                  <td style="padding:10px 12px;font-size:14px;color:#25252B;"><b>${copy.folio}:</b> ${waiverId}</td>
                </tr>
                ${
                  attractionsHtml
                    ? `<tr>
                  <td style="padding:0 12px 10px;font-size:14px;color:#25252B;"><b>${copy.attractions}:</b> ${attractionsHtml}</td>
                </tr>`
                    : ""
                }
                <tr>
                  <td style="padding:0 12px 10px;font-size:14px;color:#25252B;"><b>${copy.date}:</b> ${signedAtText}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 20px 8px;text-align:center;background:#F5F5F7;">
              <p style="margin:0 0 8px;font-size:14px;color:#25252B;">${copy.showQr}</p>
              ${
                qrImageUrl
                  ? `<img src="${qrImageUrl}" alt="${copy.qrAlt}" style="max-width:220px;width:100%;height:auto;margin:0 auto;display:block;border:1px solid rgba(37,37,43,0.12);border-radius:8px;background:#F5F5F7;" />`
                  : ""
              }
            </td>
          </tr>
          <tr>
            <td style="padding:8px 20px 10px;text-align:center;background:#F5F5F7;">
              <a href="${qrUrl}" style="display:inline-block;background:#25252B;color:#F5F5F7;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:700;">
                ${copy.viewLink}
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 20px 18px;background:#F5F5F7;">
              <p style="margin:8px 0 0;font-size:12px;line-height:1.4;color:rgba(37,37,43,0.65);">
                ${copy.footer}
                <a href="${qrUrl}" style="color:#25252B;">${qrUrl}</a>
              </p>
            </td>
          </tr>
        </table>
      </div>
    `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: copy.subject(names.join(", ") || attractionName),
      html
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend error ${response.status}: ${body}`);
  }

  return { sent: true };
}
