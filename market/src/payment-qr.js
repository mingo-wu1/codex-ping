import QRCode from "qrcode";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { normalizeCheckoutUrl } from "./qr-encode.js";

export async function createCheckoutQr(checkoutUrl) {
  return QRCode.toBuffer(normalizeCheckoutUrl(checkoutUrl), {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 4,
    width: 512,
    color: { dark: "#111827", light: "#ffffff" },
  });
}

export function decodeCheckoutQr(pngBytes) {
  const image = PNG.sync.read(pngBytes);
  const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
  if (!decoded?.data) throw new Error("QR code could not be decoded");
  return decoded.data;
}
