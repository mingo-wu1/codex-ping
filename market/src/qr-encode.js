import QRCode from "qrcode";

function webCheckoutUrl(checkoutUrl) {
  const url = new URL(checkoutUrl);
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("checkout URL must use HTTP or HTTPS");
  return url.toString();
}

export function createCheckoutQrSvg(checkoutUrl) {
  return QRCode.toString(webCheckoutUrl(checkoutUrl), {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 4,
    width: 512,
    color: { dark: "#111827", light: "#ffffff" },
  });
}

export function normalizeCheckoutUrl(checkoutUrl) {
  return webCheckoutUrl(checkoutUrl);
}
