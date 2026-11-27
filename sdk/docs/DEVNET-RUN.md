# Paytruth devnet demo run

- Started: 2026-11-27 12:25:16 WAT (2026-11-27T11:25:16.507Z)
- Finished: 2026-11-27 12:26:20 WAT (2026-11-27T11:26:20.502Z)
- RPC: https://api.devnet.solana.com
- Program: D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H
- Config PDA: C9nFHNFgdTZ27PTz4pvrjxgmkWVyng4RNVFcpc4xLEPx
- USDC mint: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
- Overall: PASS

## Steps

| Step | Title | Result |
|---|---|---|
| 1 | Merchant creates invoice A | PASS |
| 2 | Payer pays A exact | PASS |
| 3 | Merchant claims A | PASS |
| 4 | Payer attempts a duplicate payment on A | PASS |
| 5 | Overpayment on invoice B is refunded | PASS |
| 6 | Expired invoice C, failed pay, expire and close | PASS |
| 7 | Independent observer verifies A, B and C (no wallet) | PASS |

### Step 1: Merchant creates invoice A
- PASS invoice A is Open on-chain — status=Open
- PASS invoice A amount_due matches — amountDue=1000000
- PASS escrow ATA exists — 4LPaDfSjYK1wZpRthGutpfkLkSvbxkdfZWVH7yLjLDtZ
- PASS escrow ATA balance is 0

### Step 2: Payer pays A exact
- PASS invoice A is Paid
- PASS paid_amount == due — paid=1000000 due=1000000
- PASS payer recorded — DB1MjDJmMp2DUgVzqvUDBqSVmS2cJfjLExmV8tCgXx5b
- PASS escrow balance == due
- PASS payer balance decreased by due

### Step 3: Merchant claims A
- PASS invoice A claimed
- PASS merchant USDC increased by due
- PASS escrow A empty

### Step 4: Payer attempts a duplicate payment on A
- PASS recorded on-chain duplicate pay failed
- PASS failure maps to DuplicatePayment — DuplicatePayment
- PASS invoice state unchanged
- PASS payer balance unchanged

### Step 5: Overpayment on invoice B is refunded
- PASS invoice B is Paid with excess — paid=1500000
- PASS refunded_excess == excess — refunded=500000 excess=500000
- PASS payer balance restored to before - due
- PASS invoice B claimed (clean)

### Step 6: Expired invoice C, failed pay, expire and close
- PASS recorded on-chain expired pay failed
- PASS failure maps to InvoiceExpired — InvoiceExpired
- PASS invoice C still Open after failed pay
- PASS invoice C is Expired
- PASS invoice C account remains (Closed tombstone)
- PASS escrow ATA closed

### Step 7: Independent observer verifies A, B and C (no wallet)
- PASS invoice A status Paid — status=Paid escrow=0
- PASS invoice A fields
- PASS invoice B status Paid — status=Paid escrow=0
- PASS invoice B fields
- PASS invoice C status Closed — status=Closed escrow=0

## Transactions

| Step | Label | Signature | Result |
|---|---|---|---|
| 1 | createInvoice A | [5grqTPzkL7j9rs2pkSvsMq6BmTEGRcZwPK7QYDTZPrjtsoEvNQ8Bh3VD3vcUUbiuiGGBps1EbBgfvYKT7HbKMxu1](https://explorer.solana.com/tx/5grqTPzkL7j9rs2pkSvsMq6BmTEGRcZwPK7QYDTZPrjtsoEvNQ8Bh3VD3vcUUbiuiGGBps1EbBgfvYKT7HbKMxu1?cluster=devnet) | ok |
| 2 | payInvoice A exact | [3qt3LGCZV4R9EYM97rCQuFLTPvSzs7E6i7DKrpFJS2GwtXVj9Pc2bUY33BVpsDksVuDR69SAJXPbBUZx7TBL5Jqt](https://explorer.solana.com/tx/3qt3LGCZV4R9EYM97rCQuFLTPvSzs7E6i7DKrpFJS2GwtXVj9Pc2bUY33BVpsDksVuDR69SAJXPbBUZx7TBL5Jqt?cluster=devnet) | ok |
| 3 | merchantClaim A | [2FjQDzZC3ynGN5UoKd8BcDEpg1fFc5vRxpGHmDPg9A7P5hKGAcBDpLSXh9jTymZBS3SFyASWcemypymPoqdFbpSF](https://explorer.solana.com/tx/2FjQDzZC3ynGN5UoKd8BcDEpg1fFc5vRxpGHmDPg9A7P5hKGAcBDpLSXh9jTymZBS3SFyASWcemypymPoqdFbpSF?cluster=devnet) | ok |
| 4 | duplicate payInvoice A | [2YkEoUbag9w6ZF95hcxpkxTet9sCTJcQvNif2FXdjXg6SqNhxBhbgnmT9q8fX5fwzXUaMkKiRv9mP8Bg17K7GG7P](https://explorer.solana.com/tx/2YkEoUbag9w6ZF95hcxpkxTet9sCTJcQvNif2FXdjXg6SqNhxBhbgnmT9q8fX5fwzXUaMkKiRv9mP8Bg17K7GG7P?cluster=devnet) | expected-failure (DuplicatePayment) |
| 5 | createInvoice B | [5ocFRMxthXBnqwM1AGtrwGLowGYYVB6rUhbqrC9ivSDAgehnZAqr5qFDfXtLb9VpmoFWGaHXLW6yob2mNE6XWCFA](https://explorer.solana.com/tx/5ocFRMxthXBnqwM1AGtrwGLowGYYVB6rUhbqrC9ivSDAgehnZAqr5qFDfXtLb9VpmoFWGaHXLW6yob2mNE6XWCFA?cluster=devnet) | ok |
| 5 | payInvoice B (overpay) | [2CjpS8nYegn9pjtTxJntgYNsPkTqLdeijfzzzgD7g8Vn8CTuBuy3nfJvL6CHZC1WWYYFXCReiDUypKR9XopscL9U](https://explorer.solana.com/tx/2CjpS8nYegn9pjtTxJntgYNsPkTqLdeijfzzzgD7g8Vn8CTuBuy3nfJvL6CHZC1WWYYFXCReiDUypKR9XopscL9U?cluster=devnet) | ok |
| 5 | refundOverpayment B | [3SwCWt611G41DND8ftSgaP8NaufMnZpfmYhT1mUhEwjhi2vnH9SNGnNy5ktV2W9SSST55ZtDt6s79F47PJgs9XNK](https://explorer.solana.com/tx/3SwCWt611G41DND8ftSgaP8NaufMnZpfmYhT1mUhEwjhi2vnH9SNGnNy5ktV2W9SSST55ZtDt6s79F47PJgs9XNK?cluster=devnet) | ok |
| 5 | merchantClaim B | [3zh84brCk5cx6YQtnwPEwRQQXMYAAsrfFo3zck44UC16pN7yFcERArHbGonEteAzMoWnwr7MLWpFffAmUcN6SRYE](https://explorer.solana.com/tx/3zh84brCk5cx6YQtnwPEwRQQXMYAAsrfFo3zck44UC16pN7yFcERArHbGonEteAzMoWnwr7MLWpFffAmUcN6SRYE?cluster=devnet) | ok |
| 6 | createInvoice C | [51PNhoF5xt9PFCCq4AfBycnWWg83gYXhoxyDiFac2yT99zpDUCn2mALa1hht8oA52o8Th5JazCDe1oX8ongMptp1](https://explorer.solana.com/tx/51PNhoF5xt9PFCCq4AfBycnWWg83gYXhoxyDiFac2yT99zpDUCn2mALa1hht8oA52o8Th5JazCDe1oX8ongMptp1?cluster=devnet) | ok |
| 6 | payInvoice C (expired) | [4nidYVg8EUDrmNLdeCCpGgDz6BDorzpoWVwR52QwKWsmS7xvaxbevV1E8FkGakN5Bm3u638eYHEsR8b9nhapgu3M](https://explorer.solana.com/tx/4nidYVg8EUDrmNLdeCCpGgDz6BDorzpoWVwR52QwKWsmS7xvaxbevV1E8FkGakN5Bm3u638eYHEsR8b9nhapgu3M?cluster=devnet) | expected-failure (InvoiceExpired) |
| 6 | expireInvoice C | [cSXPmVqAeubnfDZ2Shz8aE4sq1As9bt94TVpjyBfWVUeU6Ya5yjp74QJtJRL7JNq6MVsGCQtv4uokWvSAFj5uzM](https://explorer.solana.com/tx/cSXPmVqAeubnfDZ2Shz8aE4sq1As9bt94TVpjyBfWVUeU6Ya5yjp74QJtJRL7JNq6MVsGCQtv4uokWvSAFj5uzM?cluster=devnet) | ok |
| 6 | closeInvoice C | [eHe5jrJTvjbmFeFBFJXFQc7sXmryYnwdC55BSDaW9m2N3PTZwP5FdTiGaCUSHLuHG89Vsmep5nBeuLsMR2VoVaN](https://explorer.solana.com/tx/eHe5jrJTvjbmFeFBFJXFQc7sXmryYnwdC55BSDaW9m2N3PTZwP5FdTiGaCUSHLuHG89Vsmep5nBeuLsMR2VoVaN?cluster=devnet) | ok |

## Verify pages

- Invoice A: /verify/Er18wwcfa4sqbFq6kAKHYLefB1TQnM5X6aFwtrdmSqDA
- Invoice B: /verify/3vdhiiF1YjCmo5m8Y6H3A1nAEcCn2BXQ9rk1JPx4KaCW
- Invoice C: /verify/Gf8EFcdfrj8LJg9pC6T74UqCsv4LsP6S25PjHmktRVdW
