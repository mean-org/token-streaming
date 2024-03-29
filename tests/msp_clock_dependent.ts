// anchor test --provider.cluster localnet --provider.wallet ~/.config/solana/id.json --detach -- --features test
import { PublicKey, Keypair } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, Token } from '@solana/spl-token';
import * as anchor from '@project-serum/anchor';
import { Program, BN, AnchorError } from '@project-serum/anchor';
import { Msp } from '../target/types/msp';
import { assert, expect } from 'chai';
import node_assert from 'assert';
import {
  connection,
  payer,
  createMspSetup,
  TREASURY_TYPE_OPEN,
  TREASURY_TYPE_LOCKED,
  TREASURY_ASSOCIATED_MINT_DECIMALS,
  sleep,
  expectAnchorError
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

  it('create treasury -> add funds -> create stream (low rate) -> get stream (after 1 sec) -> get stream (after 4 sec)', async () => {
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

    const slot = await mspSetup.connection.getSlot('finalized');
    const currentBlockTime = (await mspSetup.connection.getBlockTime(slot)) as number;

    // const nowTs = Date.now() / 1000;
    const nowTs = currentBlockTime;
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
      rateAmountUnits: 1000000, // (ie: 1_000_000 Token units === 1 USDC)
      rateIntervalInSeconds: 2629750, // (1 month)
      allocationAssignedUnits: 1000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      payerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await sleep(1000);
    console.log('stream started blocktime', new Date(nowTs * 1000).toString());

    // @yansel: Not sure about why we need try-catch here.
    // Please explain with some comments or remove if unneeded
    // try {
    const streamEvent1 = await mspSetup.getStream({
      feePayerKeypair: treasurerKeypair,
      stream: streamKeypair.publicKey
    });
    assert.isNotNull(streamEvent1, 'Stream was not found');
    // console.log(streamEvent1);
    console.log('current blocktime', streamEvent1!.currentBlockTime.toNumber());
    console.log(
      'stream units per second',
      streamEvent1!.rateAmountUnits.toNumber() / streamEvent1!.rateIntervalInSeconds.toNumber()
    );
    console.log('withdrawable amount', streamEvent1!.beneficiaryWithdrawableAmount.toNumber());

    expect(
      streamEvent1!.beneficiaryWithdrawableAmount.eq(new BN(0)),
      'Incorrect withdrawal amount 1 second after create stream'
    );
    // } catch (error: any) {
    //   expect(error.code === 6003, "Unknown error");
    // }

    await sleep(3_000);
    const streamEvent2 = await mspSetup.getStream({
      feePayerKeypair: treasurerKeypair,
      stream: streamKeypair.publicKey
    });
    // console.log(streamEvent2);
    console.log('current blocktime', streamEvent2!.currentBlockTime.toNumber());
    console.log(
      'stream units per second',
      streamEvent2!.rateAmountUnits.toNumber() / streamEvent2!.rateIntervalInSeconds.toNumber()
    );
    console.log('withdrawable amount', streamEvent2!.beneficiaryWithdrawableAmount.toNumber());

    console.log('estimated depletion time', new Date(streamEvent2!.estDepletionTime.toNumber() * 1000).toString());

    expect(
      streamEvent2!.beneficiaryWithdrawableAmount.eq(
        streamEvent2!.currentBlockTime
          .sub(new BN(nowTs))
          .mul(new BN(1314875))
          .div(new BN(2629750))
          .mul(new BN(streamEvent2!.currentBlockTime.sub(new BN(nowTs))))
      ),
      'Incorrect withdrawal amount 4 second after create stream'
    );
  });

  it('create treasury (open) -> add funds -> create stream -> wait for 50% vested -> withdraw -> close stream', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 300_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 300_000_000 });

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );
    const streamKeypair = Keypair.generate();

    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiaryKeypair.publicKey,
      true
    );

    const nowBn = new anchor.BN(Date.now() / 1000);

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: nowBn.toNumber(),
      rateAmountUnits: 50_000_000,
      rateIntervalInSeconds: 3,
      allocationAssignedUnits: 100_000_000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      payerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await sleep(3000);
    await mspSetup.withdraw({
      amount: 50_000_000,
      beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });

    const preTreasurerFromAmount = new BN(
      (await connection.getTokenAccountBalance(mspSetup.treasurerFrom)).value.amount
    ).toNumber();
    expect(preTreasurerFromAmount).eq(0);

    const preTreasuryFromAmount = new BN(
      (await connection.getTokenAccountBalance(mspSetup.treasuryFrom)).value.amount
    ).toNumber();

    // with an integration test it is not possible to control time so even
    // after sleeping for 3 seconds the amount withdrew by the beneficieary
    // might be the available amount streamed after 2 seconds (33_250_000) or
    // after 3 seconds (49_875_000). Thus we consider both possibilities
    expect(preTreasuryFromAmount).oneOf([250_000_000, 266_666_667], 'incorrect preTreasuryFromAmount');

    const beneficiaryFromAmount = new BN(
      (await connection.getTokenAccountBalance(beneficiaryFrom)).value.amount
    ).toNumber();
    expect(beneficiaryFromAmount).oneOf([33_250_000, 49_875_000]);

    await mspSetup.closeStream({
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });

    const postTreasurerFromAmount = new BN(
      (await connection.getTokenAccountBalance(mspSetup.treasurerFrom)).value.amount
    ).toNumber();
    expect(postTreasurerFromAmount).eq(0, 'incorrect amount retured to treasurer after closing a stream'); // it might vest one more second before the close

    const postTreasuryFromAmount = new BN(
      (await connection.getTokenAccountBalance(mspSetup.treasuryFrom)).value.amount
    ).toNumber();
    expect(postTreasuryFromAmount).oneOf(
      [250_000_000, 233_333_334],
      'incorrect amount left in treasury after closing a stream'
    ); // unused funds stay in the treasury

    const postBeneficiaryFromAmount = new BN(
      (await connection.getTokenAccountBalance(beneficiaryFrom)).value.amount
    ).toNumber();
    expect(postBeneficiaryFromAmount).oneOf(
      [49_875_000, 66_500_000],
      'incorrect amount retured to beneficiary after closing a stream'
    ); // it might vest one more second before the close
  });

  // it('create treasury (open) -> add funds -> create stream (80% reserved) -> wait for 50% vested -> withdraw -> close stream', async () => {
  //   const treasurerKeypair = Keypair.generate();

  //   const mspSetup = await createMspSetup(
  //     fromTokenClient,
  //     treasurerKeypair,
  //     "test_treasury",
  //     TREASURY_TYPE_OPEN,
  //     false,
  //     30,
  //     1_000_000_000,
  //   );

  //   await mspSetup.createTreasury({});

  //   await mspSetup.addFunds(30, StreamAllocationType.LeaveUnallocated);

  //   const beneficiaryKeypair = Keypair.generate();
  //   await mspSetup.connection.confirmTransaction(
  //     await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
  //     "confirmed"
  //   );
  //   const streamKeypair = Keypair.generate();

  //   const beneficiaryFrom = await Token.getAssociatedTokenAddress(
  //     ASSOCIATED_TOKEN_PROGRAM_ID,
  //     TOKEN_PROGRAM_ID,
  //     mspSetup.fromMint,
  //     beneficiaryKeypair.publicKey,
  //     true
  //   );

  //   const nowBn = new anchor.BN(Date.now() / 1000);

  //   await mspSetup.createStream(
  //     "test_stream",
  //     nowBn.toNumber(), // startUtc
  //     1,    // rateAmountUnits
  //     2,     // rateIntervalInSeconds
  //     10,  // allocationAssignedUnits
  //     8,     // allocationReservedUnits
  //     0,     // cliffVestAmountUnits
  //     0,     // cliffVestPercent

  //     treasurerKeypair, // initializerKeypair
  //     beneficiaryKeypair.publicKey, // beneficiary
  //     streamKeypair,
  //   );

  //   await sleep(10500);
  //   await mspSetup.withdraw(5, beneficiaryKeypair, beneficiaryKeypair.publicKey, beneficiaryFrom, streamKeypair.publicKey);

  //   const preTreasurerFromAmount = new BN((await connection.getTokenAccountBalance(mspSetup.treasurerFrom)).value.amount).toNumber();
  //   expect(preTreasurerFromAmount).eq(0);

  //   const preTreasuryFromAmount = new BN((await connection.getTokenAccountBalance(mspSetup.treasuryFrom)).value.amount).toNumber();
  //   expect(preTreasuryFromAmount).eq(25);

  //   const beneficiaryFromAmount = new BN((await connection.getTokenAccountBalance(beneficiaryFrom)).value.amount).toNumber();
  //   expect(beneficiaryFromAmount).eq(5);

  //   await mspSetup.closeStream(beneficiaryKeypair.publicKey, beneficiaryFrom, streamKeypair.publicKey, false);

  //   const postTreasurerFromAmount = new BN((await connection.getTokenAccountBalance(mspSetup.treasurerFrom)).value.amount).toNumber();
  //   expect(postTreasurerFromAmount)
  //     .eq(0, "incorrect amount retured to treasurer after closing a stream");

  //   const postTreasuryFromAmount = new BN((await connection.getTokenAccountBalance(mspSetup.treasuryFrom)).value.amount).toNumber();
  //   expect(postTreasuryFromAmount)
  //     .eq(22, "incorrect amount left in treasury after closing a stream");

  //   const postBeneficiaryFromAmount = new BN((await connection.getTokenAccountBalance(beneficiaryFrom)).value.amount).toNumber();
  //   expect(postBeneficiaryFromAmount)
  //     .eq(8, "incorrect amount retured to beneficiary after closing a stream"); // +30_000_000 - 75_000 = 29_925_000 (i.e. reserved_vested_or_unvested + non-reserved_vested - 0.25% fee)

  // });

  // TODO: Re-implement as a pure Rust-Solana Unit Test
  it('create treasury (open) -> add funds -> create stream -> wait for 50% streamed -> withdraw -> close stream', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 300_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 300_000_000 });

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );
    const streamKeypair = Keypair.generate();

    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiaryKeypair.publicKey,
      true
    );

    const nowBn = new anchor.BN(Date.now() / 1000);

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: nowBn.toNumber(),
      rateAmountUnits: 50_000_000,
      rateIntervalInSeconds: 3,
      allocationAssignedUnits: 100_000_000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      payerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await sleep(3250);
    await mspSetup.withdraw({
      amount: 50_000_000,
      beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });

    const preTreasurerFromAmount = new BN(
      (await connection.getTokenAccountBalance(mspSetup.treasurerFrom)).value.amount
    ).toNumber();
    expect(preTreasurerFromAmount).eq(0);

    const preTreasuryFromAmount = new BN(
      (await connection.getTokenAccountBalance(mspSetup.treasuryFrom)).value.amount
    ).toNumber();
    expect(preTreasuryFromAmount).eq(250_000_000);

    const beneficiaryFromAmount = new BN(
      (await connection.getTokenAccountBalance(beneficiaryFrom)).value.amount
    ).toNumber();
    expect(beneficiaryFromAmount).eq(49_875_000);

    await mspSetup.closeStream({
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });

    const postTreasurerFromAmount = new BN(
      (await connection.getTokenAccountBalance(mspSetup.treasurerFrom)).value.amount
    ).toNumber();
    expect(postTreasurerFromAmount).eq(0, 'incorrect amount retured to treasurer after closing a stream');

    const postTreasuryFromAmount = new BN(
      (await connection.getTokenAccountBalance(mspSetup.treasuryFrom)).value.amount
    ).toNumber();

    // At this point is really difficult to know whether 3 or 4 full seconds have elapsed so let's check for two values
    // 250000000 (expected if 3 secs elapsed)
    // 233333334 (expected if 4 secs elapsed)
    expect(postTreasuryFromAmount).oneOf(
      [233_333_334, 250_000_000],
      'incorrect amount left in treasury after closing a stream'
    );

    const postBeneficiaryFromAmount = new BN(
      (await connection.getTokenAccountBalance(beneficiaryFrom)).value.amount
    ).toNumber();

    // At this point is really difficult to know whether 3 or 4 full seconds have elapsed so let's check for two values
    // 49875000 (expected if 3 secs elapsed)
    // 66500000 (expected if 4 secs elapsed)
    expect(postBeneficiaryFromAmount).oneOf(
      [49_875_000, 66_500_000],
      'incorrect amount retured to beneficiary after closing a stream'
    );
  });

  it('create treasury -> add funds -> create stream -> pause stream (after 3 seconds running)', async () => {
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

    const slot = await mspSetup.connection.getSlot('finalized');
    const nowTs = (await mspSetup.connection.getBlockTime(slot)) as number;
    // const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    const beneficiaryKeypair = Keypair.generate();
    const streamKeypair = Keypair.generate();
    const streamStartTs = nowBn.addn(1);

    await mspSetup.createStream({
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

    await sleep(3_000);

    const txId = await mspSetup.pauseStream({
      stream: streamKeypair.publicKey,
      initializer: treasurerKeypair.publicKey,
      initializerKeypair: treasurerKeypair
    });
    console.log(txId);
  });

  it('todo: reveiw: create treasury -> add funds -> create stream (with 10% cliff) -> withdraw cliff -> allocate -> withdraw cliff', async () => {
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

    const nowBn = new anchor.BN(Date.now() / 1000);

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    const streamKeypair = Keypair.generate();

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: nowBn.toNumber(),
      rateAmountUnits: 1,
      rateIntervalInSeconds: 3600,
      allocationAssignedUnits: 100_000_000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 100_000, // 10 % (need to mult 1-100% times 10_000)
      payerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair: streamKeypair
    });

    const beneficiaryFrom = await mspSetup.findTreasuryFromAssociatedTokenAddress(beneficiaryKeypair.publicKey);

    sleep(1000);
    await mspSetup.withdraw({
      amount: 10_000_000,
      beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });

    const postBeneficiaryFrom = await mspSetup.getTokenAccountBalance(beneficiaryFrom);
    const postBeneficiaryFromAtaAmount = new BN(postBeneficiaryFrom!.amount);
    expect(postBeneficiaryFromAtaAmount.toNumber()).eq(
      9_975_000, // amount received by beneficiary after deducting withdraw fees
      'incorrect beneficiary token amount after withdraw'
    );

    await mspSetup.addFunds({ amount: 100_000_000 });

    await mspSetup.allocate({ amount: 100_000_000, stream: streamKeypair.publicKey });

    // at this point, it shouldn't be any funds to withdraw
    await node_assert.rejects(
      async () => {
        await mspSetup.withdraw({
          amount: 10_000_000,
          beneficiaryKeypair,
          beneficiary: beneficiaryKeypair.publicKey,
          beneficiaryFrom,
          stream: streamKeypair.publicKey
        });
      },
      (error: AnchorError) => {
        expectAnchorError(error, 6028, undefined, 'Withdrawal amount is zero');
        return true;
      }
    );
  });

  it('create lock treasury -> add funds -> create stream (wait until lack of funds) -> resume stream (error trying to resume a lock stream)', async () => {
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

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: streamStartTs.toNumber(),
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 20,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      payerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await sleep(3_000);

    await node_assert.rejects(
      async () => {
        const txId = await mspSetup.pauseStream({
          stream: streamKeypair.publicKey,
          initializer: treasurerKeypair.publicKey,
          initializerKeypair: treasurerKeypair
        });
        console.log(txId);
      },
      (error: any) => {
        assert.isNotNull(error, 'Unknown error');
        assert.isNotNull(error.code, 'Unknown error');
        expect(error.code === 6031, 'Streams in a Lock treasury can not be resumed after finished');
        return true;
      }
    );
  });

  it('create treasury -> add funds -> create stream -> wait for auto-pause 111111', async () => {
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

    // create stream
    await mspSetup.createTreasury({});

    // add funds
    await mspSetup.addFunds({ amount: 100_000_000 });
    let treasury = await mspSetup.program.account.treasury.fetch(mspSetup.treasury);
    expect(treasury.lastKnownBalanceUnits.toNumber()).eq(100000000, 'invalid treasury balance');
    expect(treasury.allocationAssignedUnits.toNumber()).eq(0, 'invalid treasury balance');
    let treasuryFromAmount = (await connection.getTokenAccountBalance(mspSetup.treasuryFrom)).value.amount;
    expect(treasuryFromAmount).eq('100000000', 'invalid treasuryFromAmount after close stream');

    // create stream
    const beneficiaryKeypair = Keypair.generate();
    const beneficiary = beneficiaryKeypair.publicKey;
    await connection.confirmTransaction(await connection.requestAirdrop(beneficiary, 1_000_000_000), 'confirmed');
    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiary,
      true
    );

    const nowBn = new anchor.BN(Date.now() / 1000);
    const streamKeypair = Keypair.generate();
    const stream = streamKeypair.publicKey;
    await mspSetup.createStream({
      name: 'test_stream',
      startTs: nowBn.toNumber(),
      rateAmountUnits: 2,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 5,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      payerKeypair: treasurerKeypair,
      beneficiary: beneficiary,
      streamKeypair: streamKeypair,
      feePayedByTreasurer: true
    });
    await sleep(1000);
    treasury = await mspSetup.program.account.treasury.fetch(mspSetup.treasury);
    expect(treasury.lastKnownBalanceUnits.toNumber()).eq(100000000, 'invalid treasury balance');
    expect(treasury.allocationAssignedUnits.toNumber()).eq(5, 'invalid treasury balance');
    treasuryFromAmount = (await connection.getTokenAccountBalance(mspSetup.treasuryFrom)).value.amount;
    expect(treasuryFromAmount).eq('100000000', 'invalid treasuryFromAmount after close stream');
    let postStream = await mspSetup.getStream({ feePayerKeypair: treasurerKeypair, stream, logRawLogs: true });
    expect(postStream?.status).eq('Running');
    expect(postStream?.allocationAssignedUnits.toNumber()).eq(5);
    expect(postStream?.totalWithdrawalsUnits.toNumber()).eq(0);

    // withdraw
    await sleep(3000);
    await mspSetup.withdraw({
      amount: 5,
      beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });

    treasury = await mspSetup.program.account.treasury.fetch(mspSetup.treasury);
    expect(treasury.lastKnownBalanceUnits.toNumber()).eq(99999995, 'invalid treasury balance');
    expect(treasury.allocationAssignedUnits.toNumber()).eq(0, 'invalid treasury balance');
    treasuryFromAmount = (await connection.getTokenAccountBalance(mspSetup.treasuryFrom)).value.amount;
    expect(treasuryFromAmount).eq('99999995', 'invalid treasuryFromAmount after close stream');
    let beneficiaryFromAmount = (await connection.getTokenAccountBalance(beneficiaryFrom)).value.amount;
    expect(beneficiaryFromAmount).eq('5', 'invalid beneficiaryFromAmount after close stream');
    postStream = await mspSetup.getStream({ feePayerKeypair: treasurerKeypair, stream, logRawLogs: true });
    expect(postStream?.status).eq('Paused');
    expect(postStream?.allocationAssignedUnits.toNumber()).eq(5);
    expect(postStream?.totalWithdrawalsUnits.toNumber()).eq(5);

    // allocate
    await sleep(1000);
    await mspSetup.allocate({ amount: 5, stream });
    treasury = await mspSetup.program.account.treasury.fetch(mspSetup.treasury);
    expect(treasury.lastKnownBalanceUnits.toNumber()).eq(99999995, 'invalid treasury balance');
    expect(treasury.allocationAssignedUnits.toNumber()).eq(5, 'invalid treasury balance');
    treasuryFromAmount = (await connection.getTokenAccountBalance(mspSetup.treasuryFrom)).value.amount;
    expect(treasuryFromAmount).eq('99999995', 'invalid treasuryFromAmount after close stream');
    postStream = await mspSetup.getStream({ feePayerKeypair: treasurerKeypair, stream, logRawLogs: true });
    expect(postStream?.status).eq('Running');
    expect(postStream?.allocationAssignedUnits.toNumber()).eq(10);
    expect(postStream?.totalWithdrawalsUnits.toNumber()).eq(5);
    expect(postStream?.beneficiaryWithdrawableAmount.toNumber()).eq(0);

    // elapsed
    await sleep(5000);
    postStream = await mspSetup.getStream({ feePayerKeypair: treasurerKeypair, stream, logRawLogs: true });
    expect(postStream?.status).eq('Paused');
    expect(postStream?.allocationAssignedUnits.toNumber()).eq(10);
    expect(postStream?.totalWithdrawalsUnits.toNumber()).eq(5);
    expect(postStream?.beneficiaryWithdrawableAmount.toNumber()).eq(5);
    const treasurerFromAmount = (await connection.getTokenAccountBalance(mspSetup.treasurerFrom)).value.amount;
    expect(treasurerFromAmount).eq('0', 'invalid treasurerFromAmount after close stream');
    beneficiaryFromAmount = (await connection.getTokenAccountBalance(beneficiaryFrom)).value.amount;
    expect(beneficiaryFromAmount).eq('5', 'invalid beneficiaryFromAmount after close stream');

    // withdraw
    await mspSetup.withdraw({
      amount: 5,
      beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });
    treasury = await mspSetup.program.account.treasury.fetch(mspSetup.treasury);
    expect(treasury.lastKnownBalanceUnits.toNumber()).eq(99999990, 'invalid treasury balance');
    expect(treasury.allocationAssignedUnits.toNumber()).eq(0, 'invalid treasury balance');
    treasuryFromAmount = (await connection.getTokenAccountBalance(mspSetup.treasuryFrom)).value.amount;
    expect(treasuryFromAmount).eq('99999990', 'invalid treasuryFromAmount after close stream');
    beneficiaryFromAmount = (await connection.getTokenAccountBalance(beneficiaryFrom)).value.amount;
    expect(beneficiaryFromAmount).eq('10', 'invalid beneficiaryFromAmount after close stream');
    postStream = await mspSetup.getStream({ feePayerKeypair: treasurerKeypair, stream, logRawLogs: true });
    expect(postStream?.status).eq('Paused');
    expect(postStream?.allocationAssignedUnits.toNumber()).eq(10);
    expect(postStream?.totalWithdrawalsUnits.toNumber()).eq(10);
    expect(postStream?.beneficiaryWithdrawableAmount.toNumber()).eq(0);

    // allocate
    await sleep(1000);
    await mspSetup.allocate({ amount: 50, stream });
    treasury = await mspSetup.program.account.treasury.fetch(mspSetup.treasury);
    expect(treasury.lastKnownBalanceUnits.toNumber()).eq(99999990, 'invalid treasury balance');
    expect(treasury.allocationAssignedUnits.toNumber()).eq(50, 'invalid treasury balance');
    treasuryFromAmount = (await connection.getTokenAccountBalance(mspSetup.treasuryFrom)).value.amount;
    expect(treasuryFromAmount).eq('99999990', 'invalid treasuryFromAmount after close stream');
    postStream = await mspSetup.getStream({ feePayerKeypair: treasurerKeypair, stream, logRawLogs: true });
    expect(postStream?.status).eq('Running');
    expect(postStream?.allocationAssignedUnits.toNumber()).eq(60);
    expect(postStream?.totalWithdrawalsUnits.toNumber()).eq(10);
    expect(postStream?.beneficiaryWithdrawableAmount.toNumber()).eq(0);

    // allocate
    await sleep(1000);
    await mspSetup.allocate({ amount: 500, stream });
    treasury = await mspSetup.program.account.treasury.fetch(mspSetup.treasury);
    expect(treasury.lastKnownBalanceUnits.toNumber()).eq(99999989, 'invalid treasury balance'); // -1 (0.25% withdraw fees deduction)
    expect(treasury.allocationAssignedUnits.toNumber()).eq(550, 'invalid treasury balance');
    treasuryFromAmount = (await connection.getTokenAccountBalance(mspSetup.treasuryFrom)).value.amount;
    expect(treasuryFromAmount).eq('99999989', 'invalid treasuryFromAmount after close stream');
    postStream = await mspSetup.getStream({ feePayerKeypair: treasurerKeypair, stream, logRawLogs: true });
    expect(postStream?.status).eq('Running');
    expect(postStream?.allocationAssignedUnits.toNumber()).eq(560);
    expect(postStream?.totalWithdrawalsUnits.toNumber()).eq(10);
    expect(postStream?.beneficiaryWithdrawableAmount.toNumber()).oneOf([2, 4]); // +2 or +4 units streamed depending on whether 1 or 2 seconds elapsed
  });
});
