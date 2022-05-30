// anchor test --provider.cluster localnet --provider.wallet ~/.config/solana/id.json --detach -- --features test
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Connection,
  Transaction,
  sendAndConfirmRawTransaction
} from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, Token, AccountInfo } from "@solana/spl-token";
import * as anchor from '@project-serum/anchor';
import { Program, BN, IdlTypes, IdlAccounts, AnchorError } from '@project-serum/anchor';
import { Msp } from '../target/types/msp';
import { getWorkspace } from "./workspace";
import { assert, expect } from "chai";
import node_assert from "assert";
import { base64, bs58 } from '@project-serum/anchor/dist/cjs/utils/bytes';
import https from 'https';
import {
  connection,
  payer,
  createMspSetup,
  MspSetup,
  TREASURY_TYPE_OPEN,
  TREASURY_TYPE_LOCKED,
  MSP_FEES_PUBKEY,
  TREASURY_POOL_MINT_DECIMALS,
  WhitelistedAddress,
  StreamAllocationType,
  sleep,
  ONE_SOL,
  MSP_TREASURY_ACCOUNT_SIZE_IN_BYTES,
  SOLANA_MINT_ACCOUNT_SIZE_IN_BYTES,
  MSP_CREATE_TREASURY_FEE_IN_LAMPORTS,
  MSP_WITHDRAW_FEE_PCT_NUMERATOR,
  MSP_FEE_PCT_DENOMINATOR,
  StreamEvent,
  expectAnchorError,
} from './setup';

describe('msp', () => {

  let program: Program<Msp>;
  let fromTokenClient: Token = new Token(connection, PublicKey.default, TOKEN_PROGRAM_ID, payer); // dummy new to make it non-null; it will be overwritten soon;

  it("Initializes the state-of-the-world", async () => {
    const provider = anchor.AnchorProvider.env();

    anchor.setProvider(provider);
    program = anchor.workspace.Msp as Program<Msp>;

    // Airdropping tokens to a payer.
    await connection.confirmTransaction(
      await connection.requestAirdrop(payer.publicKey, 10000000000),
      "confirmed"
    );

    // Prevent 'Error: failed to send transaction: Transaction simulation failed: Transaction leaves an account with a lower balance than rent-exempt minimum' because fee account having zero sol
    // https://discord.com/channels/428295358100013066/517163444747894795/958728019973910578
    // https://discord.com/channels/428295358100013066/749579745645166592/956262753365008465
    await connection.confirmTransaction(
      await connection.requestAirdrop(new PublicKey("3TD6SWY9M1mLY2kZWJNavPLhwXvcRsWdnZLRaMzERJBw"), 10000000000),
      "confirmed"
    );

    fromTokenClient = await Token.createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      TREASURY_POOL_MINT_DECIMALS,
      TOKEN_PROGRAM_ID
    );
  });

  it('create treasury', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup(
      fromTokenClient,
      treasurerKeypair,
      "test_treasury",
      TREASURY_TYPE_OPEN,
      false,
      1_000_000,
      ONE_SOL,
    );

    await mspSetup.createTreasury();

  });

  it('create treasury (fails because the treasurer has insufficient SOL to pay creation fee)', async () => {
    const treasurerKeypair = Keypair.generate();

    const treasurerLamports = (await connection.getMinimumBalanceForRentExemption(MSP_TREASURY_ACCOUNT_SIZE_IN_BYTES)) +
      (await connection.getMinimumBalanceForRentExemption(SOLANA_MINT_ACCOUNT_SIZE_IN_BYTES))
      + 2_039_280;
    // intentionally excluding the lamports needed to pay creation fees

    const mspSetup = await createMspSetup(
      fromTokenClient,
      treasurerKeypair,
      "test_treasury",
      TREASURY_TYPE_OPEN,
      false,
      1_000_000,
      treasurerLamports,
    );

    await node_assert.rejects(async () => {
      await mspSetup.createTreasury();
    },
      (error: anchor.web3.SendTransactionError) => {
        expect(error.message).contains("Error processing Instruction 0: custom program error: 0x1");
        expect(error.logs?.join('\n')).contains(`Transfer: insufficient lamports 0, need ${MSP_CREATE_TREASURY_FEE_IN_LAMPORTS}`);
        return true;
      });

  });

  it('create treasury -> add funds (unallocated)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup(
      fromTokenClient,
      treasurerKeypair,
      "test_treasury",
      TREASURY_TYPE_OPEN,
      false,
      100_000_000,
      ONE_SOL,
    );

    await mspSetup.createTreasury();

    await mspSetup.addFunds(100_000_000);

  });

  it('create treasury -> add funds (unallocated)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup(
      fromTokenClient,
      treasurerKeypair,
      "test_treasury",
      TREASURY_TYPE_OPEN,
      false,
      100_000_000,
      ONE_SOL,
    );

    await mspSetup.createTreasury();

    await mspSetup.addFunds(100_000_000);

  });

  it('create treasury -> add funds -> close treasury', async () => {

    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup(
      fromTokenClient,
      treasurerKeypair,
      "test_treasury",
      TREASURY_TYPE_OPEN,
      false,
      1000_000_000,
      1_000_000_000,
    );

    await mspSetup.createTreasury();
    await mspSetup.addFunds(100_000_000);
    await mspSetup.closeTreasury();

  });

  it('create treasury -> close treasury', async () => {

    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup(
      fromTokenClient,
      treasurerKeypair,
      "test_treasury",
      TREASURY_TYPE_OPEN,
      false,
      1000_000_000,
      1_000_000_000,
    );

    await mspSetup.createTreasury();
    await mspSetup.closeTreasury();

  });

  //#region TREASURY WITHDRAW

  it('treasury withdraw', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup(
      fromTokenClient,
      treasurerKeypair,
      "test_treasury",
      TREASURY_TYPE_OPEN,
      false,
      1000_000_000,
      1_000_000_000,
    );

    await mspSetup.createTreasury();
    await mspSetup.addFunds(100_000_000);

    await mspSetup.treasuryWithdraw(100_000_000, treasurerKeypair.publicKey, mspSetup.treasurerFrom);

    const postState = await mspSetup.getMspWorldState();
    expect(postState.treasurerFromAccountInfo?.amount.toNumber()).eq(999_750_000);
    expect(postState.treasuryFromAccountInfo?.amount.toNumber()).eq(0);
    expect(postState.treasuryAccount?.lastKnownBalanceUnits.toNumber()).eq(0);
  });

  it('treasury withdraw half', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup(
      fromTokenClient,
      treasurerKeypair,
      "test_treasury",
      TREASURY_TYPE_OPEN,
      false,
      1000_000_000,
      1_000_000_000,
    );

    await mspSetup.createTreasury();
    await mspSetup.addFunds(100_000_000);

    await mspSetup.treasuryWithdraw(50_000_000, treasurerKeypair.publicKey, mspSetup.treasurerFrom);

    const postState = await mspSetup.getMspWorldState();
    expect(postState.treasurerFromAccountInfo?.amount.toNumber()).eq(949_875_000);
    expect(postState.treasuryFromAccountInfo?.amount.toNumber()).eq(50_000_000);
    expect(postState.treasuryAccount?.lastKnownBalanceUnits.toNumber()).eq(50_000_000);
  });

  it('treasury withdraw -> insufficient treasury balance', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup(
      fromTokenClient,
      treasurerKeypair,
      "test_treasury",
      TREASURY_TYPE_OPEN,
      false,
      1000_000_000,
      1_000_000_000,
    );

    await mspSetup.createTreasury();
    await mspSetup.addFunds(100_000_000);

    await node_assert.rejects(async () => {
      await mspSetup.treasuryWithdraw(100_000_001, treasurerKeypair.publicKey, mspSetup.treasurerFrom);
    },
      (error: AnchorError) => {
        expectAnchorError(error, 6039, undefined, "Insufficient treasury balance");
        return true;
      });
  });

  it('treasury withdraw -> invalid withdrawal amount', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup(
      fromTokenClient,
      treasurerKeypair,
      "test_treasury",
      TREASURY_TYPE_OPEN,
      false,
      1000_000_000,
      1_000_000_000,
    );

    await mspSetup.createTreasury();
    await mspSetup.addFunds(100_000_000);

    await node_assert.rejects(async () => {
      await mspSetup.treasuryWithdraw(0, treasurerKeypair.publicKey, mspSetup.treasurerFrom);
    },
      (error: AnchorError) => {
        expectAnchorError(error, 6022, undefined, "Invalid withdrawal amount");
        return true;
      });
  });

  it('treasury withdraw -> invalid treasurer', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup(
      fromTokenClient,
      treasurerKeypair,
      "test_treasury",
      TREASURY_TYPE_OPEN,
      false,
      1000_000_000,
      1_000_000_000,
    );

    await mspSetup.createTreasury();
    await mspSetup.addFunds(100_000_000);

    const treasurer2From = await mspSetup.findTreasuryFromAssociatedTokenAddress(mspSetup.program.provider.wallet.publicKey);

    await node_assert.rejects(async () => {
      await mspSetup.treasuryWithdraw(100_000_000,
        mspSetup.program.provider.wallet.publicKey,
        treasurer2From,
        [],
        mspSetup.program.provider.wallet.publicKey,
        treasurer2From,
      );
    },
      (error: AnchorError) => {
        expectAnchorError(error, 6013, undefined, "Invalid treasurer");
        return true;
      });
  });

  it('create treasury -> add funds', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup(
      fromTokenClient,
      treasurerKeypair,
      "test_treasury",
      TREASURY_TYPE_OPEN,
      false,
      100_000_000,
      ONE_SOL,
    );

    await mspSetup.createTreasury();

    await mspSetup.addFunds(100_000_000);

  });

  //#endregion

  it('create treasury (solFeePayedByTreasury=true) -> close treasury', async () => {

    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup(
      fromTokenClient,
      treasurerKeypair,
      "v2t4_open_2022-02-02",
      TREASURY_TYPE_OPEN,
      false,
      1000_000_000,
      1000_000_000,
    );

    await mspSetup.createTreasury(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true // solFeePayedByTreasury
    );

    await connection.confirmTransaction(
      await connection.requestAirdrop(mspSetup.treasury, 1_000_000_000),
      "confirmed"
    );

    await mspSetup.closeTreasury();

  });

  it('create treasury (solFeePayedByTreasury=true) -> addFunds -> close treasury', async () => {

    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup(
      fromTokenClient,
      treasurerKeypair,
      "v2t4_open_2022-02-02",
      TREASURY_TYPE_OPEN,
      false,
      1000_000_000,
      1000_000_000,
    );

    await mspSetup.createTreasury(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true // solFeePayedByTreasury
    );

    await connection.confirmTransaction(
      await connection.requestAirdrop(mspSetup.treasury, 1_000_000_000),
      "confirmed"
    );

    await mspSetup.addFunds(1_000_000);

    await mspSetup.closeTreasury();

  });

});
