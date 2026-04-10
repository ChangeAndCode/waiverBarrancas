function getResendConfig() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.RESEND_FROM_EMAIL || "").trim();
  return { apiKey, from };
}

export function canSendEmails() {
  const { apiKey, from } = getResendConfig();
  return Boolean(apiKey && from);
}

export async function sendWaiverQrEmail({
  to,
  participantName,
  attractionName,
  waiverId,
  signedAt,
  qrUrl,
  qrImageUrl
}) {
  const { apiKey, from } = getResendConfig();
  if (!apiKey || !from || !to) {
    return { sent: false };
  }

  const signedAtText = new Date(signedAt).toLocaleString("es-MX");
  const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.45;color:#233528;">
        <h2 style="margin:0 0 8px;">Hola ${participantName}</h2>
        <p>Aqui tienes tu registro para <b>${attractionName}</b>.</p>
        <p><b>Folio:</b> ${waiverId}<br /><b>Fecha:</b> ${signedAtText}</p>
        <p>Presenta este enlace QR al ingresar:</p>
        <p><a href="${qrUrl}">${qrUrl}</a></p>
        ${
          qrImageUrl
            ? `<p>Imagen QR directa: <a href="${qrImageUrl}">${qrImageUrl}</a></p>`
            : ""
        }
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
      subject: `Tu QR de acceso - ${attractionName}`,
      html
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend error ${response.status}: ${body}`);
  }

  return { sent: true };
}
