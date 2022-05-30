// anchor test --provider.cluster localnet --provider.wallet ~/.config/solana/id.json --detach -- --features test
// node_modules/.bin/ts-mocha -p ./tsconfig.json -t 1000000 tests/msp_treasury_add_funds_stream.ts
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

  // TODO: why should we support this use case?
  it('create treasury -> add funds -> create stream (initializer is not the treasurer, nor the beneficiary)', async () => {
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

    const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(Date.now() / 1000);
    const startTs = nowBn.addn(10).toNumber();
    console.log("nowTs:", nowTs);

    const initializerKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(initializerKeypair.publicKey, 1_000_000_000),
      "confirmed"
    );

    const beneficiaryKeypair = Keypair.generate();
    const streamKeypair = Keypair.generate();

    await mspSetup.createStream(
      "test_stream",
      startTs, // startUtc
      10,    // rateAmountUnits
      1,     // rateIntervalInSeconds
      1000,  // allocationAssignedUnits
      0,     // cliffVestAmountUnits
      0,     // cliffVestPercent

      initializerKeypair, // initializerKeypair
      beneficiaryKeypair.publicKey, // beneficiary
      streamKeypair,
    );

  });

  it('create treasury -> add funds -> create stream (should fail because assigned units > available in the treasury)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup(
      fromTokenClient,
      treasurerKeypair,
      "test_treasury",
      TREASURY_TYPE_OPEN,
      false,
      100_000_000,
      1_000_000_000,
    );

    await mspSetup.createTreasury();

    await mspSetup.addFunds(100_000_000);

    const nowBn = new anchor.BN(Date.now() / 1000);
    const startTs = nowBn.addn(10).toNumber();

    const beneficiaryKeypair = Keypair.generate();
    const streamKeypair = Keypair.generate();

    await node_assert.rejects(async () => {
      await mspSetup.createStream(
        "test_stream",
        startTs, // startUtc
        10,    // rateAmountUnits
        1,     // rateIntervalInSeconds
        101_000_000,  // allocationAssignedUnits (passing more than available)
        0,     // cliffVestAmountUnits
        0,     // cliffVestPercent

        treasurerKeypair, // initializerKeypair
        beneficiaryKeypair.publicKey, // beneficiary
        streamKeypair,
      );
    },
      (error: AnchorError) => {
        expectAnchorError(error, 6039, undefined, 'Insufficient treasury balance');
        return true;
      });

  });

  it('create treasury -> add funds -> create stream (initializer = beneficiary)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup(
      fromTokenClient,
      treasurerKeypair,
      "test_treasury",
      TREASURY_TYPE_OPEN,
      false,
      100_000_000,
      1_000_000_000,
    );

    await mspSetup.createTreasury();

    await mspSetup.addFunds(100_000_000);

    const slot = await mspSetup.connection.getSlot("finalized");
    const nowTs = await mspSetup.connection.getBlockTime(slot) as number;
    const nowBn = new anchor.BN(nowTs);

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      "confirmed"
    );
    const streamKeypair = Keypair.generate();

    await mspSetup.createStream(
      "test_stream",
      nowBn.toNumber(), // startUtc
      10,    // rateAmountUnits
      1,     // rateIntervalInSeconds
      100,  // allocationAssignedUnits
      0,     // cliffVestAmountUnits
      0,     // cliffVestPercent

      beneficiaryKeypair, // initializerKeypair
      beneficiaryKeypair.publicKey, // beneficiary
      streamKeypair,
    );

  });

  it('create treasury -> add funds -> create stream (initializer = treasurer)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup(
      fromTokenClient,
      treasurerKeypair,
      "test_treasury",
      TREASURY_TYPE_OPEN,
      false,
      1000_000_000,
      1_000_000_000,
    )

    await mspSetup.createTreasury();

    await mspSetup.addFunds(100_000_000);

    const slot = await mspSetup.connection.getSlot("finalized");
    const nowTs = await mspSetup.connection.getBlockTime(slot) as number;
    // const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log("nowTs:", nowTs);


    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      "confirmed"
    );
    const streamKeypair = Keypair.generate();

    await mspSetup.createStream(
      "test_stream",
      nowBn.toNumber(), // startUtc
      10,    // rateAmountUnits
      1,     // rateIntervalInSeconds
      1000,  // allocationAssignedUnits
      0,     // cliffVestAmountUnits
      0,     // cliffVestPercent

      treasurerKeypair, // initializerKeypair
      beneficiaryKeypair.publicKey, // beneficiary
      streamKeypair,
    );

  });

  it('create treasury -> add funds -> create stream (fee payer = treasurer)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup(
      fromTokenClient,
      treasurerKeypair,
      "test_treasury",
      TREASURY_TYPE_OPEN,
      false,
      1000_000_000,
      1_000_000_000,
    )

    await mspSetup.createTreasury();

    await mspSetup.addFunds(100_000_000);

    const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log("nowTs:", nowTs);


    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      "confirmed"
    );

    const streamKeypair = Keypair.generate();

    await mspSetup.createStream(
      "test_stream",
      nowBn.toNumber(), // startUtc
      10,    // rateAmountUnits
      1,     // rateIntervalInSeconds
      1000,  // allocationAssignedUnits
      0,     // cliffVestAmountUnits
      0,     // cliffVestPercent

      treasurerKeypair, // initializerKeypair
      beneficiaryKeypair.publicKey, // beneficiary
      streamKeypair,
      undefined,
      undefined,
      true
    );
  });

  it('create lock treasury -> add funds -> create stream (should fail because treasurer is paying for fees but there isnt enough to pay for it in the treasury)', async () => {

    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup(
      fromTokenClient,
      treasurerKeypair,
      "test_treasury",
      TREASURY_TYPE_OPEN,
      false,
      100_000_000,
      1_000_000_000,
    );

    await mspSetup.createTreasury();

    await mspSetup.addFunds(100_000_000);

    const slot = await mspSetup.connection.getSlot("finalized");
    const nowTs = await mspSetup.connection.getBlockTime(slot) as number;
    let nowBn = new anchor.BN(nowTs);
    console.log(`now: ${nowBn.toNumber()}`);


    const beneficiary = Keypair.generate().publicKey;

    await connection.confirmTransaction(
      await connection.requestAirdrop(beneficiary, 1_000_000_000),
      "confirmed"
    );
    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiary,
      true
    );

    const streamKeypair = Keypair.generate();
    const streamStartTs = nowBn.addn(1);
    console.log(`streamStartTs: ${streamStartTs.toNumber()}`);

    await node_assert.rejects(async () => {
      await mspSetup.createStream(
        "test_stream",
        streamStartTs.toNumber(), // startUtc
        100_000_000,      // rateAmountUnits
        1,                // rateIntervalInSeconds
        100_000_000,      // allocationAssignedUnits
        0,                // cliffVestAmountUnits
        0,                // cliffVestPercent
  
        treasurerKeypair, // initializerKeypair
        beneficiary,      // beneficiary
        streamKeypair,
        undefined,
        undefined,
        true,             // feePayedByTreasurer
      );
    },
      (error: any) => {
        expect(error.code === 6021, "Invalid requested stream allocation");
        return true;
      });

  });

  it('create lock treasury -> add funds -> create stream (does not fail if the reserved allocation IS NOT EQUAL to the assigned allocation because reserved is deprecated and thus ignored)', async () => {

    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup(
      fromTokenClient,
      treasurerKeypair,
      "test_treasury",
      TREASURY_TYPE_LOCKED,
      false,
      1000_000_000,
      1_000_000_000,
    );

    await mspSetup.createTreasury();

    await mspSetup.addFunds(100_000_000);

    const slot = await mspSetup.connection.getSlot("finalized");
    const nowTs = await mspSetup.connection.getBlockTime(slot) as number;
    // const nowTs = Date.now() / 1000;
    let nowBn = new anchor.BN(nowTs);
    console.log("nowTs:", nowTs);


    const beneficiaryKeypair = Keypair.generate();
    const streamKeypair = Keypair.generate();
    const streamStartTs = nowBn.addn(1);

    const txId = await mspSetup.createStream(
      "test_stream",
      streamStartTs.toNumber(), // startUtc
      10,    // rateAmountUnits
      1,     // rateIntervalInSeconds
      1000,  // allocationAssignedUnits
      0,     // cliffVestAmountUnits
      0,     // cliffVestPercent

      treasurerKeypair, // initializerKeypair
      beneficiaryKeypair.publicKey, // beneficiary
      streamKeypair,
    );
    console.log(txId);

  });
  
  it('create treasury -> add funds -> create stream (treasurer = "2ScK..w8w4")', async () => {
    const treasurerKeypair = Keypair.fromSecretKey(bs58.decode("FyPg7NCnGzNQfPXnd9eEB35ifVmKCd95DvyM4CnFgvawjVTnA3PtdpEvuyxLkAM2BrSimgKMQhyDxXU3i3p91op"));

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

    const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log("nowTs:", nowTs);

    const beneficiaryKeypair = Keypair.fromSecretKey(bs58.decode("8PhHB3rWEJbMXtsn6gJSfhv2M9CCFeEdtQV9xcoZL9S4gNrrurtKcwNEwV1YRBapvPHa8h3ce5oZvTwM4cedheu"));
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      "confirmed"
    );
    const streamKeypair = Keypair.generate();

    await mspSetup.createStream(
      "test_stream",
      nowBn.addn(10).toNumber(), // startUtc
      2_875_000,      // rateAmountUnits
      2_629_750,      // rateIntervalInSeconds one month
      50_000_000,     // allocationAssignedUnits 50 UI tokens
      0,              // cliffVestAmountUnits
      100_000,        // cliffVestPercent 10%

      beneficiaryKeypair, // initializerKeypair
      beneficiaryKeypair.publicKey, // beneficiary
      streamKeypair,
    );

  });

});