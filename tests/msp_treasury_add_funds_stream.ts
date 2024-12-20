// anchor test --provider.cluster localnet --provider.wallet ~/.config/solana/id.json --detach -- --features test
// node_modules/.bin/ts-mocha -p ./tsconfig.json -t 1000000 tests/msp_treasury_add_funds_stream.ts
import { PublicKey, Keypair } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, Token } from '@solana/spl-token';
import * as anchor from '@project-serum/anchor';
import { Program, AnchorError } from '@project-serum/anchor';
import { Msp } from '../target/types/msp';
import { expect } from 'chai';
import node_assert from 'assert';
import { bs58 } from '@project-serum/anchor/dist/cjs/utils/bytes';
import {
  connection,
  payer,
  createMspSetup,
  TREASURY_TYPE_OPEN,
  TREASURY_TYPE_LOCKED,
  TREASURY_ASSOCIATED_MINT_DECIMALS,
  expectAnchorError,
  Category,
  SubCategory,
  sleep
} from './setup';

describe('msp', () => {
  let program: Program<Msp>;
  let fromTokenClient: Token = new Token(connection, PublicKey.default, TOKEN_PROGRAM_ID, payer); // dummy new to make it non-null; it will be overwritten soon;

  it('Initializes the state-of-the-world', async () => {
    const provider = anchor.AnchorProvider.env();

    anchor.setProvider(provider);
    program = anchor.workspace.Msp as Program<Msp>;

    // Airdropping tokens to a payer.
    await connection.confirmTransaction(await connection.requestAirdrop(payer.publicKey, 10000000000), 'confirmed');

    // Prevent 'Error: failed to send transaction: Transaction simulation failed: Transaction leaves an account with a lower balance than rent-exempt minimum' because fee account having zero sol
    // https://discord.com/channels/428295358100013066/517163444747894795/958728019973910578
    // https://discord.com/channels/428295358100013066/749579745645166592/956262753365008465
    await connection.confirmTransaction(
      await connection.requestAirdrop(new PublicKey('3TD6SWY9M1mLY2kZWJNavPLhwXvcRsWdnZLRaMzERJBw'), 10000000000),
      'confirmed'
    );

    fromTokenClient = await Token.createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      TREASURY_ASSOCIATED_MINT_DECIMALS,
      TOKEN_PROGRAM_ID
    );
  });

  it('create treasury -> add funds -> create stream (should fail because assigned units > available in the treasury)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 100_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const nowBn = new anchor.BN(Date.now() / 1000);
    const startTs = nowBn.addn(10).toNumber();

    const beneficiaryKeypair = Keypair.generate();
    const streamKeypair = Keypair.generate();

    await node_assert.rejects(
      async () => {
        await mspSetup.createStream({
          name: 'test_stream',
          startTs,
          rateAmountUnits: 10,
          rateIntervalInSeconds: 1,
          allocationAssignedUnits: 101_000_000, // (passing more than available)
          cliffVestAmountUnits: 0,
          cliffVestPercent: 0,
          payerKeypair: treasurerKeypair,
          beneficiary: beneficiaryKeypair.publicKey,
          streamKeypair
        });
      },
      (error: AnchorError) => {
        expectAnchorError(error, 6039, undefined, 'Insufficient treasury balance');
        return true;
      }
    );
  });

  it('create treasury -> add funds -> create stream (fee payer = treasurer)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    const streamKeypair = Keypair.generate();

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: nowBn.toNumber(),
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 1000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      payerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair,
      feePayedByTreasurer: true
    });
  });

  it('create lock treasury -> add funds -> create stream (should fail because treasurer is paying for fees but there isnt enough to pay for it in the treasury)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 100_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const slot = await mspSetup.connection.getSlot('finalized');
    const nowTs = (await mspSetup.connection.getBlockTime(slot)) as number;
    const nowBn = new anchor.BN(nowTs);
    console.log(`now: ${nowBn.toNumber()}`);

    const beneficiary = Keypair.generate().publicKey;

    await connection.confirmTransaction(await connection.requestAirdrop(beneficiary, 1_000_000_000), 'confirmed');
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

    await node_assert.rejects(
      async () => {
        await mspSetup.createStream({
          name: 'test_stream',
          startTs: streamStartTs.toNumber(),
          rateAmountUnits: 100_000_000,
          rateIntervalInSeconds: 1,
          allocationAssignedUnits: 100_000_000,
          cliffVestAmountUnits: 0,
          cliffVestPercent: 0,
          payerKeypair: treasurerKeypair,
          beneficiary: beneficiary,
          streamKeypair,
          feePayedByTreasurer: true
        });
      },
      (error: any) => {
        expect(error.code === 6021, 'Invalid requested stream allocation');
        return true;
      }
    );
  });

  it('create lock treasury -> add funds -> create stream (does not fail if the reserved allocation IS NOT EQUAL to the assigned allocation because reserved is deprecated and thus ignored)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_LOCKED,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const slot = await mspSetup.connection.getSlot('finalized');
    const nowTs = (await mspSetup.connection.getBlockTime(slot)) as number;
    // const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    const beneficiaryKeypair = Keypair.generate();
    const streamKeypair = Keypair.generate();
    const streamStartTs = nowBn.addn(1);

    const txId = await mspSetup.createStream({
      name: 'test_stream',
      startTs: streamStartTs.toNumber(),
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 1000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      payerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });
    console.log(txId);
  });

  it('create treasury -> add funds -> create stream (treasurer = "2ScK..w8w4")', async () => {
    const treasurerKeypair = Keypair.fromSecretKey(
      bs58.decode('FyPg7NCnGzNQfPXnd9eEB35ifVmKCd95DvyM4CnFgvawjVTnA3PtdpEvuyxLkAM2BrSimgKMQhyDxXU3i3p91op')
    );

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    const beneficiaryKeypair = Keypair.fromSecretKey(
      bs58.decode('8PhHB3rWEJbMXtsn6gJSfhv2M9CCFeEdtQV9xcoZL9S4gNrrurtKcwNEwV1YRBapvPHa8h3ce5oZvTwM4cedheu')
    );
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );
    const streamKeypair = Keypair.generate();

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: nowBn.addn(10).toNumber(),
      rateAmountUnits: 2_875_000,
      rateIntervalInSeconds: 2_629_750, // one month
      allocationAssignedUnits: 50_000_000, // 50 UI tokens
      cliffVestAmountUnits: 0,
      cliffVestPercent: 100_000, // 10%
      payerKeypair: beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });
  });

  it('create treasury with categories -> add funds -> create stream (fee payer = treasurer)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });
    const category = Category.vesting;
    const subCategory = SubCategory.seed;
    await mspSetup.createTreasury({
      category,
      subCategory
    });

    await mspSetup.addFunds({ amount: 100_000_000 });

    const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    const streamKeypair = Keypair.generate();

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: nowBn.toNumber(),
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 1000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      payerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair,
      feePayedByTreasurer: true
    });

    await mspSetup.filterStreamByCategory(category, streamKeypair.publicKey);
    await mspSetup.filterStreamBySubCateogry(subCategory, streamKeypair.publicKey);
  });

  it('create treasury -> add funds -> create teamplate -> create stream (initializer = beneficiary)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 100_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({
      category: Category.vesting
    });

    await mspSetup.addFunds({ amount: 100_000_000 });

    const slot = await mspSetup.connection.getSlot('finalized');
    const nowTs = (await mspSetup.connection.getBlockTime(slot)) as number;

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    const [template, templateBump] = PublicKey.findProgramAddressSync(
      [anchor.utils.bytes.utf8.encode('template'), mspSetup.treasury.toBuffer()],
      mspSetup.program.programId
    );

    await mspSetup.createTemplate({
      initializerKeypair: treasurerKeypair,
      template,
      templateBump,
      startTs: nowTs,
      rateIntervalInSeconds: 3600,
      cliffVestPercent: 0,
      durationNumberOfUnits: 200
    });

    const streamKeypair = Keypair.generate();
    await mspSetup.createStreamWithTemplate({
      name: 'test_stream',
      template,
      allocationAssignedUnits: 50_000_000,
      payerKeypair: beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });
  });

  it('create treasury and template -> add funds -> create stream (initializer = beneficiary)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 100_000_000,
      treasurerLamports: 1_000_000_000
    });

    const [template, templateBump] = PublicKey.findProgramAddressSync(
      [anchor.utils.bytes.utf8.encode('template'), mspSetup.treasury.toBuffer()],
      mspSetup.program.programId
    );

    const slot = await mspSetup.connection.getSlot('finalized');
    const nowTs = (await mspSetup.connection.getBlockTime(slot)) as number;

    await mspSetup.createTreasuryAndTemplate({
      initializerKeypair: treasurerKeypair,
      template,
      templateBump,
      startTs: nowTs,
      rateIntervalInSeconds: 3600,
      cliffVestPercent: 0,
      durationNumberOfUnits: 200,
      category: Category.vesting
    });

    await mspSetup.addFunds({ amount: 100_000_000 });
    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    const streamKeypair = Keypair.generate();
    await mspSetup.createStreamWithTemplate({
      name: 'test_stream',
      template,
      allocationAssignedUnits: 50_000_000,
      payerKeypair: beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });
  });

  it('create treasury with category ->  add funds -> create template -> create stream with template (fee payer = treasurer)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({
      category: Category.vesting
    });
    await mspSetup.addFunds({ amount: 100_000_000 });

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    const [template, templateBump] = PublicKey.findProgramAddressSync(
      [anchor.utils.bytes.utf8.encode('template'), mspSetup.treasury.toBuffer()],
      mspSetup.program.programId
    );

    const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    await mspSetup.createTemplate({
      startTs: nowBn.toNumber(),
      rateIntervalInSeconds: 60 * 60 * 24 * 7,
      cliffVestPercent: 0,
      durationNumberOfUnits: 24,
      template,
      templateBump,
      initializerKeypair: treasurerKeypair
    });

    const streamKeypair = Keypair.generate();

    await mspSetup.createStreamWithTemplate({
      name: 'test_stream',
      allocationAssignedUnits: 1000,
      payerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair,
      template,
      feePayedByTreasurer: true
    });
  });

  it('create treasury and template with category ->  add funds -> create stream with template (fee payer = treasurer)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    const [template, templateBump] = PublicKey.findProgramAddressSync(
      [anchor.utils.bytes.utf8.encode('template'), mspSetup.treasury.toBuffer()],
      mspSetup.program.programId
    );

    const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    await mspSetup.createTreasuryAndTemplate({
      startTs: nowBn.toNumber(),
      rateIntervalInSeconds: 60 * 60 * 24 * 7,
      cliffVestPercent: 0,
      durationNumberOfUnits: 24,
      template,
      templateBump,
      initializerKeypair: treasurerKeypair,
      category: Category.vesting
    });
    await mspSetup.addFunds({ amount: 100_000_000 });

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    const streamKeypair = Keypair.generate();
    await mspSetup.createStreamWithTemplate({
      name: 'test_stream',
      allocationAssignedUnits: 1000,
      payerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair,
      template,
      feePayedByTreasurer: true
    });
  });

  it('create treasury -> add funds -> create template -> create stream (treasurer = "2ScK..w8w4")', async () => {
    const treasurerKeypair = Keypair.fromSecretKey(
      bs58.decode('FyPg7NCnGzNQfPXnd9eEB35ifVmKCd95DvyM4CnFgvawjVTnA3PtdpEvuyxLkAM2BrSimgKMQhyDxXU3i3p91op')
    );

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({
      category: Category.vesting
    });
    await mspSetup.addFunds({ amount: 100_000_000 });

    const beneficiaryKeypair = Keypair.fromSecretKey(
      bs58.decode('8PhHB3rWEJbMXtsn6gJSfhv2M9CCFeEdtQV9xcoZL9S4gNrrurtKcwNEwV1YRBapvPHa8h3ce5oZvTwM4cedheu')
    );
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    const [template, templateBump] = PublicKey.findProgramAddressSync(
      [anchor.utils.bytes.utf8.encode('template'), mspSetup.treasury.toBuffer()],
      mspSetup.program.programId
    );

    const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    await mspSetup.createTemplate({
      startTs: nowBn.toNumber(),
      rateIntervalInSeconds: 2_629_750,
      durationNumberOfUnits: 100,
      cliffVestPercent: 100_000, // 10%
      template,
      templateBump,
      initializerKeypair: treasurerKeypair
    });

    const streamKeypair = Keypair.generate();

    await mspSetup.createStreamWithTemplate({
      name: 'test_stream',
      allocationAssignedUnits: 50_000_000, //5 0 UI tokens
      payerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair,
      template,
      feePayedByTreasurer: true
    });
  });

  it('create treasury and template -> add funds -> create stream (treasurer = "2ScK..w8w4")', async () => {
    const treasurerKeypair = Keypair.fromSecretKey(
      bs58.decode('FyPg7NCnGzNQfPXnd9eEB35ifVmKCd95DvyM4CnFgvawjVTnA3PtdpEvuyxLkAM2BrSimgKMQhyDxXU3i3p91op')
    );

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    const [template, templateBump] = PublicKey.findProgramAddressSync(
      [anchor.utils.bytes.utf8.encode('template'), mspSetup.treasury.toBuffer()],
      mspSetup.program.programId
    );

    const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    await mspSetup.createTreasuryAndTemplate({
      startTs: nowBn.toNumber(),
      rateIntervalInSeconds: 2_629_750,
      durationNumberOfUnits: 100,
      cliffVestPercent: 100_000, // 10%
      template,
      templateBump,
      initializerKeypair: treasurerKeypair,
      category: Category.vesting
    });
    await mspSetup.addFunds({ amount: 100_000_000 });

    const beneficiaryKeypair = Keypair.fromSecretKey(
      bs58.decode('8PhHB3rWEJbMXtsn6gJSfhv2M9CCFeEdtQV9xcoZL9S4gNrrurtKcwNEwV1YRBapvPHa8h3ce5oZvTwM4cedheu')
    );
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    const streamKeypair = Keypair.generate();
    await mspSetup.createStreamWithTemplate({
      name: 'test_stream',
      allocationAssignedUnits: 50_000_000, //5 0 UI tokens
      payerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair,
      template,
      feePayedByTreasurer: true
    });
  });

  it('create lock treasury -> add funds -> create template -> create stream with template (does not fail if the reserved allocation IS NOT EQUAL to the assigned allocation because reserved is deprecated and thus ignored)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_LOCKED,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({
      category: Category.vesting
    });

    await mspSetup.addFunds({ amount: 100_000_000 });

    const [template, templateBump] = PublicKey.findProgramAddressSync(
      [anchor.utils.bytes.utf8.encode('template'), mspSetup.treasury.toBuffer()],
      mspSetup.program.programId
    );

    const slot = await mspSetup.connection.getSlot('finalized');
    const nowTs = (await mspSetup.connection.getBlockTime(slot)) as number;

    await mspSetup.createTemplate({
      startTs: nowTs,
      rateIntervalInSeconds: 3600,
      durationNumberOfUnits: 12,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      template,
      templateBump
    });

    const beneficiaryKeypair = Keypair.generate();
    const streamKeypair = Keypair.generate();

    await mspSetup.createStreamWithTemplate({
      allocationAssignedUnits: 1000,
      beneficiary: beneficiaryKeypair.publicKey,
      payerKeypair: treasurerKeypair,
      name: 'test_stream',
      streamKeypair,
      template
    });
  });

  it('create lock treasury with template -> add funds -> create stream with template (does not fail if the reserved allocation IS NOT EQUAL to the assigned allocation because reserved is deprecated and thus ignored)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_LOCKED,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    const [template, templateBump] = PublicKey.findProgramAddressSync(
      [anchor.utils.bytes.utf8.encode('template'), mspSetup.treasury.toBuffer()],
      mspSetup.program.programId
    );

    const slot = await mspSetup.connection.getSlot('finalized');
    const nowTs = (await mspSetup.connection.getBlockTime(slot)) as number;

    await mspSetup.createTreasuryAndTemplate({
      startTs: nowTs,
      rateIntervalInSeconds: 3600,
      durationNumberOfUnits: 12,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      template,
      templateBump,
      category: Category.vesting
    });

    await mspSetup.addFunds({ amount: 100_000_000 });

    const beneficiaryKeypair = Keypair.generate();
    const streamKeypair = Keypair.generate();

    await mspSetup.createStreamWithTemplate({
      allocationAssignedUnits: 1000,
      beneficiary: beneficiaryKeypair.publicKey,
      payerKeypair: treasurerKeypair,
      name: 'test_stream',
      streamKeypair,
      template
    });
  });

  it('create lock treasury with template -> add funds -> create stream with template with start date in future -> Close stream 55555', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_LOCKED,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    const [template, templateBump] = PublicKey.findProgramAddressSync(
      [anchor.utils.bytes.utf8.encode('template'), mspSetup.treasury.toBuffer()],
      mspSetup.program.programId
    );

    const slot = await mspSetup.connection.getSlot('finalized');
    const nowTs = (await mspSetup.connection.getBlockTime(slot)) as number;
    const startTs = new Date(nowTs + 3600).getTime();

    await mspSetup.createTreasuryAndTemplate({
      startTs: startTs,
      rateIntervalInSeconds: 3600,
      durationNumberOfUnits: 12,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      template,
      templateBump,
      category: Category.vesting
    });

    await mspSetup.addFunds({ amount: 100_000_000 });

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    const streamKeypair = Keypair.generate();

    await mspSetup.createStreamWithTemplate({
      allocationAssignedUnits: 1000,
      beneficiary: beneficiaryKeypair.publicKey,
      payerKeypair: treasurerKeypair,
      name: 'test_stream',
      streamKeypair,
      template
    });

    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiaryKeypair.publicKey,
      true
    );

    await mspSetup.closeStream({
      stream: streamKeypair.publicKey,
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryFrom
    });
  });

  it('create treasury -> add funds -> create teamplate -> modify template -> create stream (initializer = beneficiary)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 100_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({
      category: Category.vesting
    });

    await mspSetup.addFunds({ amount: 100_000_000 });

    const slot = await mspSetup.connection.getSlot('finalized');
    const nowTs = (await mspSetup.connection.getBlockTime(slot)) as number;

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    const [template, templateBump] = PublicKey.findProgramAddressSync(
      [anchor.utils.bytes.utf8.encode('template'), mspSetup.treasury.toBuffer()],
      mspSetup.program.programId
    );

    await mspSetup.createTemplate({
      initializerKeypair: treasurerKeypair,
      template,
      templateBump,
      startTs: nowTs,
      rateIntervalInSeconds: 3600,
      cliffVestPercent: 0,
      durationNumberOfUnits: 200
    });

    await sleep(6000);

    await mspSetup.modifyTemplate({
      initializerKeypair: treasurerKeypair,
      template,
      startTs: nowTs + 3600,
      rateIntervalInSeconds: 3600,
      cliffVestPercent: 10,
      durationNumberOfUnits: 200
    });

    const streamKeypair = Keypair.generate();
    await mspSetup.createStreamWithTemplate({
      name: 'test_stream',
      template,
      allocationAssignedUnits: 50_000_000,
      payerKeypair: beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });
  });

  it('create treasury -> add funds -> create teamplate -> create stream -> modify template (should fail)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 100_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({
      category: Category.vesting
    });

    await mspSetup.addFunds({ amount: 100_000_000 });

    const slot = await mspSetup.connection.getSlot('finalized');
    const nowTs = (await mspSetup.connection.getBlockTime(slot)) as number;

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    const [template, templateBump] = PublicKey.findProgramAddressSync(
      [anchor.utils.bytes.utf8.encode('template'), mspSetup.treasury.toBuffer()],
      mspSetup.program.programId
    );

    await mspSetup.createTemplate({
      initializerKeypair: treasurerKeypair,
      template,
      templateBump,
      startTs: nowTs + 3600,
      rateIntervalInSeconds: 3600,
      cliffVestPercent: 0,
      durationNumberOfUnits: 200
    });

    const streamKeypair = Keypair.generate();
    await mspSetup.createStreamWithTemplate({
      name: 'test_stream',
      template,
      allocationAssignedUnits: 50_000_000,
      payerKeypair: beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await sleep(6000);

    await node_assert.rejects(
      async () => {
        await mspSetup.modifyTemplate({
          initializerKeypair: treasurerKeypair,
          template,
          startTs: nowTs + 7200,
          rateIntervalInSeconds: 3600,
          cliffVestPercent: 10,
          durationNumberOfUnits: 200
        });
      },
      (error: AnchorError) => {
        expectAnchorError(error, 6047, undefined, 'Template cannot be modified after streams have been created');
        return true;
      }
    );
  });
});
