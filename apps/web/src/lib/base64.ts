export function base64FromArrayBuffer(buffer: ArrayBuffer): string {
  // Small frames (~640 bytes @ 20ms/16kHz) => simple btoa is fine.
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

