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
  qrImageUrl,
  logoUrl
}) {
  const { apiKey, from } = getResendConfig();
  if (!apiKey || !from || !to) {
    return { sent: false };
  }

  const signedAtText = new Date(signedAt).toLocaleString("es-MX");
  const html = `
      <div style="margin:0;padding:24px;background:#f3efe6;font-family:Arial,sans-serif;color:#233528;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px;margin:0 auto;background:#fffaf3;border:1px solid #e3d7c4;border-radius:12px;">
          <tr>
            <td style="padding:18px 20px;background:#1f4a3b;border-radius:12px 12px 0 0;text-align:center;">
              ${
                logoUrl
                  ? `<img src="${logoUrl}" alt="Parque Barrancas" style="max-width:140px;width:100%;height:auto;display:block;margin:0 auto 10px;" />`
                  : ""
              }
              <p style="margin:0;color:#f8f3e9;font-size:14px;letter-spacing:.2px;">Confirmacion de registro</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 20px;">
              <h2 style="margin:0 0 8px;font-size:20px;color:#1f4a3b;">Hola ${participantName}</h2>
              <p style="margin:0 0 12px;line-height:1.45;">Tu waiver para <b>${attractionName}</b> quedo registrado correctamente.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f7f2e7;border:1px solid #e3d7c4;border-radius:8px;">
                <tr>
                  <td style="padding:10px 12px;font-size:14px;"><b>Folio:</b> ${waiverId}</td>
                </tr>
                <tr>
                  <td style="padding:0 12px 10px;font-size:14px;"><b>Fecha:</b> ${signedAtText}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 20px 8px;text-align:center;">
              <p style="margin:0 0 8px;font-size:14px;">Presenta este codigo QR al ingresar:</p>
              ${
                qrImageUrl
                  ? `<img src="${qrImageUrl}" alt="QR de acceso" style="max-width:220px;width:100%;height:auto;margin:0 auto;display:block;border:1px solid #e3d7c4;border-radius:8px;background:#fff;" />`
                  : ""
              }
            </td>
          </tr>
          <tr>
            <td style="padding:8px 20px 10px;text-align:center;">
              <a href="${qrUrl}" style="display:inline-block;background:#1f4a3b;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:700;">
                Ver enlace de validacion
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 20px 18px;">
              <p style="margin:8px 0 0;font-size:12px;line-height:1.4;color:#55675e;">
                Guarda este correo como comprobante. Si no se visualiza el QR, usa este enlace:
                <a href="${qrUrl}" style="color:#1f4a3b;">${qrUrl}</a>
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
