/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/paytruth.json`.
 */
export type Paytruth = {
  "address": "D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H",
  "metadata": {
    "name": "paytruth",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "closeInvoice",
      "discriminator": [
        217,
        64,
        46,
        247,
        231,
        36,
        118,
        252
      ],
      "accounts": [
        {
          "name": "merchant",
          "writable": true,
          "signer": true,
          "relations": [
            "invoice"
          ]
        },
        {
          "name": "invoice",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  118,
                  111,
                  105,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "invoice.merchant",
                "account": "invoice"
              },
              {
                "kind": "account",
                "path": "invoice.invoiceId",
                "account": "invoice"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "escrow",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "createInvoice",
      "discriminator": [
        154,
        170,
        31,
        135,
        134,
        100,
        156,
        146
      ],
      "accounts": [
        {
          "name": "merchant",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "invoice",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  118,
                  111,
                  105,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "merchant"
              },
              {
                "kind": "arg",
                "path": "invoiceId"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "invoice"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "invoiceId",
          "type": "u64"
        },
        {
          "name": "amountDue",
          "type": "u64"
        },
        {
          "name": "expiresAt",
          "type": "i64"
        },
        {
          "name": "memo",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        }
      ]
    },
    {
      "name": "expireInvoice",
      "discriminator": [
        239,
        203,
        58,
        150,
        67,
        51,
        55,
        84
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "invoice",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  118,
                  111,
                  105,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "invoice.merchant",
                "account": "invoice"
              },
              {
                "kind": "account",
                "path": "invoice.invoiceId",
                "account": "invoice"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "initializeConfig",
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint",
          "docs": [
            "owner, an `spl_token::state::Mint` layout, and `decimals == USDC_DECIMALS`."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "usdcMint",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "merchantClaim",
      "discriminator": [
        184,
        206,
        238,
        15,
        55,
        16,
        78,
        39
      ],
      "accounts": [
        {
          "name": "merchant",
          "writable": true,
          "signer": true,
          "relations": [
            "invoice"
          ]
        },
        {
          "name": "invoice",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  118,
                  111,
                  105,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "invoice.merchant",
                "account": "invoice"
              },
              {
                "kind": "account",
                "path": "invoice.invoiceId",
                "account": "invoice"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "escrow",
          "writable": true
        },
        {
          "name": "merchantAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "merchant"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "payInvoice",
      "discriminator": [
        104,
        6,
        62,
        239,
        197,
        206,
        208,
        220
      ],
      "accounts": [
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "invoice",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  118,
                  111,
                  105,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "invoice.merchant",
                "account": "invoice"
              },
              {
                "kind": "account",
                "path": "invoice.invoiceId",
                "account": "invoice"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "payerAta",
          "writable": true
        },
        {
          "name": "escrow",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "expectedAmountDue",
          "type": "u64"
        }
      ]
    },
    {
      "name": "recoverUnattributed",
      "discriminator": [
        65,
        35,
        239,
        112,
        160,
        111,
        171,
        100
      ],
      "accounts": [
        {
          "name": "merchant",
          "writable": true,
          "signer": true,
          "relations": [
            "invoice"
          ]
        },
        {
          "name": "invoice",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  118,
                  111,
                  105,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "invoice.merchant",
                "account": "invoice"
              },
              {
                "kind": "account",
                "path": "invoice.invoiceId",
                "account": "invoice"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "escrow",
          "writable": true
        },
        {
          "name": "destinationAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "merchant"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "refundOverpayment",
      "discriminator": [
        193,
        10,
        58,
        199,
        177,
        164,
        211,
        223
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "invoice",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  118,
                  111,
                  105,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "invoice.merchant",
                "account": "invoice"
              },
              {
                "kind": "account",
                "path": "invoice.invoiceId",
                "account": "invoice"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "escrow",
          "writable": true
        },
        {
          "name": "payer",
          "docs": [
            "constraint ties it to `invoice.payer`."
          ]
        },
        {
          "name": "payerAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "payer"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "invoice",
      "discriminator": [
        51,
        194,
        250,
        114,
        6,
        104,
        18,
        164
      ]
    }
  ],
  "events": [
    {
      "name": "invoiceClaimed",
      "discriminator": [
        217,
        171,
        5,
        26,
        181,
        133,
        111,
        248
      ]
    },
    {
      "name": "invoiceClosed",
      "discriminator": [
        73,
        15,
        241,
        78,
        178,
        104,
        112,
        196
      ]
    },
    {
      "name": "invoiceCreated",
      "discriminator": [
        189,
        114,
        235,
        219,
        193,
        125,
        47,
        54
      ]
    },
    {
      "name": "invoiceExpired",
      "discriminator": [
        135,
        245,
        53,
        40,
        249,
        47,
        126,
        95
      ]
    },
    {
      "name": "invoicePaid",
      "discriminator": [
        200,
        211,
        168,
        170,
        46,
        82,
        83,
        186
      ]
    },
    {
      "name": "overpaymentRefunded",
      "discriminator": [
        27,
        53,
        1,
        51,
        105,
        114,
        108,
        111
      ]
    },
    {
      "name": "unattributedRecovered",
      "discriminator": [
        210,
        21,
        27,
        226,
        152,
        155,
        217,
        218
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "underpayment",
      "msg": "Payment amount is less than the invoice amount due"
    },
    {
      "code": 6001,
      "name": "duplicatePayment",
      "msg": "Invoice has already been paid"
    },
    {
      "code": 6002,
      "name": "invoiceNotOpen",
      "msg": "Invoice is not open"
    },
    {
      "code": 6003,
      "name": "invoiceExpired",
      "msg": "Invoice has expired"
    },
    {
      "code": 6004,
      "name": "invoiceNotPaid",
      "msg": "Invoice is not paid"
    },
    {
      "code": 6005,
      "name": "alreadyClaimed",
      "msg": "Invoice has already been claimed"
    },
    {
      "code": 6006,
      "name": "alreadyRefunded",
      "msg": "Overpayment has already been refunded"
    },
    {
      "code": 6007,
      "name": "nothingToRefund",
      "msg": "Invoice has no excess to refund"
    },
    {
      "code": 6008,
      "name": "notExpired",
      "msg": "Invoice has not expired yet"
    },
    {
      "code": 6009,
      "name": "invalidAmount",
      "msg": "Invalid amount"
    },
    {
      "code": 6010,
      "name": "invalidExpiry",
      "msg": "Invalid expiry"
    },
    {
      "code": 6011,
      "name": "invalidMint",
      "msg": "Invalid mint"
    },
    {
      "code": 6012,
      "name": "invalidEscrow",
      "msg": "Invalid escrow account"
    },
    {
      "code": 6013,
      "name": "unauthorizedMerchant",
      "msg": "Signer is not the invoice merchant"
    },
    {
      "code": 6014,
      "name": "invalidPayerAta",
      "msg": "Invalid payer associated token account"
    },
    {
      "code": 6015,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6016,
      "name": "vaultNotEmpty",
      "msg": "Vault is not empty"
    },
    {
      "code": 6017,
      "name": "invoiceNotTerminal",
      "msg": "Invoice is not in a terminal state"
    },
    {
      "code": 6018,
      "name": "excessOutstanding",
      "msg": "Recorded excess has not been refunded"
    },
    {
      "code": 6019,
      "name": "nothingToRecover",
      "msg": "Nothing to recover"
    },
    {
      "code": 6020,
      "name": "payerNotRecorded",
      "msg": "Payer is not recorded on the invoice"
    },
    {
      "code": 6021,
      "name": "configMintMismatch",
      "msg": "Mint does not match config usdc mint"
    },
    {
      "code": 6022,
      "name": "invoiceMismatch",
      "msg": "Invoice does not match the expected amount due (stale or substituted invoice)"
    }
  ],
  "types": [
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "invoice",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "invoiceId",
            "type": "u64"
          },
          {
            "name": "amountDue",
            "type": "u64"
          },
          {
            "name": "paidAmount",
            "type": "u64"
          },
          {
            "name": "refundedExcess",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "claimed",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "memo",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "invoiceClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "invoice",
            "type": "pubkey"
          },
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "amountDue",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "invoiceClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "invoice",
            "type": "pubkey"
          },
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "invoiceCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "invoice",
            "type": "pubkey"
          },
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "invoiceId",
            "type": "u64"
          },
          {
            "name": "amountDue",
            "type": "u64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "invoiceExpired",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "invoice",
            "type": "pubkey"
          },
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "invoicePaid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "invoice",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "excess",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "overpaymentRefunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "invoice",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "excess",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "unattributedRecovered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "invoice",
            "type": "pubkey"
          },
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "configSeed",
      "type": "bytes",
      "value": "[99, 111, 110, 102, 105, 103]"
    },
    {
      "name": "invoiceSeed",
      "type": "bytes",
      "value": "[105, 110, 118, 111, 105, 99, 101]"
    }
  ]
};
