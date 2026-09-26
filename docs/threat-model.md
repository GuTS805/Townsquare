# Threat model

The design rule: even the strongest observer in the system can learn, at most, that you took part. Nobody
can learn what you said, and nobody can change what was said without it showing up.

## Who can link what

| Observer | Person ↔ membership | Membership ↔ pseudonym | Pseudonym ↔ votes | Same person across conversations |
|---|---|---|---|---|
| Host / server operator | No (1) | No (2) | Yes, needed for the math | No |
| Public (audit bundle) | No | No | Yes, like any Polis export | No |
| Aadhaar issuer (UIDAI) | Possibly (3) | No | n/a | Membership only |

1. With invite codes, a host who writes down who got which code can link a person to membership, but still not to votes.
2. Cryptographically impossible. A malicious operator could still try timing or IP correlation (see below).
3. The Anon Aadhaar nullifier is derived from data UIDAI holds, and the per-conversation seed is public.

## Threats

| Threat | Mitigation | What's left |
|---|---|---|
| One person, many accounts | Gate proof plus one nullifier per credential per conversation, unique in Postgres and in `TownsquareHub.gateNullifierUsed` | Invite codes are only as strong as their distribution |
| Host adds fake members | Code gate: the code set's Merkle root is fixed onchain at creation and every member's code has a public inclusion proof (check A) | A host could hand spare codes to sock puppets; the code count is public |
| Double voting, replay | pid is the Semaphore nullifier; one vote row per (pid, sid); signed, strictly increasing nonces | None |
| Host edits or deletes votes | Hash chain, contiguous onchain anchors, signed receipts (checks C, D, R) | Events not yet anchored (up to 2 minutes); receipts cover them |
| Host rewrites a vote and recomputes all hashes | The batch root no longer matches the onchain anchor (check D) and the participant's signature fails (check C) | None once anchored |
| Host hides statements | Moderation is a logged event with a public reason code | The host can still reject, but everyone can see it |
| Server links person to pid (timing or IP) | No IP logging (the logger redacts addresses, rate limits use a salted hash rotated hourly), timestamps rounded to the minute, minimum anonymity set, "register now, vote later" | An operator watching live traffic could still correlate. Relays or mixnets are future work |
| Proof theft or front-running | Join proofs are bound to the session key (Semaphore message = H(session key)) | None |
| Session key theft (XSS) | Non-extractable WebCrypto key, no third-party scripts on participant pages | A compromised device can still vote as its owner |
| Small-group inference | Groups under 3 people get no published statistics; per-cell and residual suppression from Pocket Polis | None |
| Prompt injection through statements | The model has no tools, output must match a schema, statements are passed as data, and every claim is checked against the numbers (check F) | The tone could be skewed, so numbers sit next to every claim |
| Relayer key leak | `onlyRelayer` can only create, add members, anchor or close; the owner can rotate it; small balance | Damage until rotation, visible onchain |
| DB admin bypasses the append-only trigger | Nothing in the database is trusted by the checks: hashes, signatures and anchors are recomputed from content | None once anchored |

## Honest limitations

- **Liveness.** The server can refuse service. A refusal after accepting (receipt issued) is provable; a
  refusal before accepting isn't. A future fix is an onchain submission fallback.
- **Public vote vectors.** Pseudonymous vote vectors are public, as in every Polis open-data export. With very
  few participants, patterns might hint at identity, which is why the minimum anonymity set exists.
- **Not an election system.** Townsquare is for consultation and deliberation, not legally binding votes.
- **AI output isn't reproducible bit for bit.** What is reproducible is that no claim survives without
  statements whose numbers back it up. Anyone can regenerate a summary with a local model and compare.
