// Prints fresh secrets for the server's environment.
//
//   pnpm --filter @townsquare/scripts keygen
import { randomBytes } from "node:crypto";

const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", kp.privateKey)).toString("base64");
console.log(`LOG_SIGNING_KEY=${pkcs8}`);
console.log(`APP_NULLIFIER_SEED=${randomBytes(24).toString("hex")}`);
