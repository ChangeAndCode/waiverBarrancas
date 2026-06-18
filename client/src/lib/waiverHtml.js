import DOMPurify from "dompurify";

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "ul",
  "ol",
  "li",
  "h2",
  "h3",
  "blockquote",
  "mark"
];

export function looksLikeHtml(text) {
  return /<[a-z][\s\S]*>/i.test(String(text || ""));
}

export function isWaiverTextEmpty(html) {
  const text = String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return !text;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function toDisplayHtml(content) {
  const raw = String(content || "");
  if (!raw) return "";
  if (looksLikeHtml(raw)) return raw;
  return raw
    .split(/\n\n+/)
    .map((paragraph) => {
      const lines = escapeHtml(paragraph.trim()).replace(/\n/g, "<br>");
      return lines ? `<p>${lines}</p>` : "";
    })
    .filter(Boolean)
    .join("");
}

export function sanitizeWaiverHtml(html) {
  return DOMPurify.sanitize(toDisplayHtml(html), {
    ALLOWED_TAGS,
    ALLOWED_ATTR: []
  });
}
