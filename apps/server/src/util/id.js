import { randomUUID } from "node:crypto";
export function newId(prefix) {
    const id = randomUUID();
    return prefix ? `${prefix}_${id}` : id;
}
