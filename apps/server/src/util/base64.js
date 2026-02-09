export function base64ToUint8Array(base64) {
    // Node.js base64 decode
    return new Uint8Array(Buffer.from(base64, "base64"));
}
export function uint8ArrayToBase64(bytes) {
    // Node.js base64 encode
    return Buffer.from(bytes).toString("base64");
}
