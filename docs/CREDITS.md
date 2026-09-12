# Credits and usage tracking

LabCD meters design/LLM jobs against a dual-balance credit wallet.

## Model

- **Bonus balance** — persists (new-user bonus, referral bonuses, admin adjusts).
- **Daily balance** — reset each UTC day to the configured allotment; unused daily credits do not roll over.
- **Spendable** = bonus + daily. Debits take daily first, then bonus.
- **Hard gate** — when enabled, job starts return HTTP 402 if spendable ≤ 0.

Defaults (editable in **Admin → Credits**):

| Setting | Default |
|---------|---------|
| New-user bonus | 100 |
| Referral inviter / invitee | 100 / 50 |
| Daily allotment | 20 |
| Per 1k tokens / per minute | 1 / 1 |
| Min charge per job | 1 |

Charge formula: `max(min_charge, ceil(tokens/1000 * per_1k + minutes * per_minute))`.

## Lifecycle

1. Register (optional `referral_code` / `?ref=`).
2. On email verify (or verified SSO/admin create): grant new-user + referral bonuses once.
3. Job start: open `CreditUsageSession`, gate on balance.
4. Job end: finalize session (tokens + duration), debit ledger.

## Admin E2E checklist

- [ ] Admin → Credits: change allotment/bonuses/rates/hard-gate and Save; reload confirms values.
- [ ] Admin → Users → user detail: Credits panel shows balances; Adjust amount applies and appears in ledger.
- [ ] Register with `?ref=CODE` from an existing user’s referral code; after verify, inviter and invitee bonus balances increase once.
- [ ] Profile → Credits: spendable / daily / bonus, ledger, usage sessions, copy invite link.
- [ ] With hard gate on and balance forced to 0 (admin adjust), starting a job returns “Insufficient credits”.
- [ ] After a UTC day change (or set `daily_date` back one day in DB), next balance read refills daily without changing bonus.
