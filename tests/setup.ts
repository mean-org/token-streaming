import { PublicKey, Keypair, Connection, Transaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, Token, AccountInfo } from '@solana/spl-token';
import Wallet from '@project-serum/anchor/dist/cjs/nodewallet';
import * as anchor from '@project-serum/anchor';
import { Program, BN, IdlAccounts, AnchorError } from '@project-serum/anchor';
import { Msp } from '../target/types/msp';
import { getWorkspace } from './workspace';
import { assert, expect } from 'chai';
import { bs58 } from '@project-serum/anchor/dist/cjs/utils/bytes';
import fetch from 'node-fetch';

// type TreasuryEnum = IdlTypes<Msp>["TreasuryType"]; // TODO
import process from 'process';

type TreasuryAccount = IdlAccounts<Msp>['treasury'];
type StreamAccount = IdlAccounts<Msp>['stream'];

export const TREASURY_TYPE_OPEN = 0;
export const TREASURY_TYPE_LOCKED = 1;

export const TREASURY_POOL_MINT_DECIMALS = 6;
export const MSP_FEES_PUBKEY = new PublicKey('3TD6SWY9M1mLY2kZWJNavPLhwXvcRsWdnZLRaMzERJBw');
export const MSP_TREASURY_ACCOUNT_SIZE_IN_BYTES = 300;
export const MSP_CREATE_TREASURY_FEE_IN_LAMPORTS = 10_000;
export const MSP_CREATE_TREASURY_INITIAL_BALANCE_FOR_FEES = 100_000;
export const MSP_ADD_FUNDS_FEE_IN_LAMPORTS = 25_000;
export const MSP_WITHDRAW_FEE_PCT_NUMERATOR = 2500;
export const MSP_FEE_PCT_DENOMINATOR = 1_000_000;
export const SOLANA_MINT_ACCOUNT_SIZE_IN_BYTES = 82;
export const SOLANA_TOKEN_ACCOUNT_SIZE_IN_BYTES = 165;
export const SYSTEM_PROGRAM_ID = anchor.web3.SystemProgram.programId;
export const SYSVAR_RENT_PUBKEY = anchor.web3.SYSVAR_RENT_PUBKEY;
export const SYSVAR_CLOCK_PUBKEY = anchor.web3.SYSVAR_CLOCK_PUBKEY;
export const ONE_SOL = 1_000_000_000;

export const LATEST_IDL_FILE_VERSION = 1;
export const url = process.env.ANCHOR_PROVIDER_URL;
if (url === undefined) {
  throw new Error('ANCHOR_PROVIDER_URL is not defined');
}
export const options = anchor.AnchorProvider.defaultOptions();
export const connection = new Connection(url, options.commitment);
export const payer = Keypair.generate();

export async function createMspSetup({
  fromTokenClient,
  treasurerKeypair,
  name,
  treasuryType,
  autoClose,
  treasurerFromInitialBalance,
  treasurerLamports
}: {
  fromTokenClient: Token;
  treasurerKeypair: Keypair;
  name: string;
  treasuryType: number;
  autoClose: boolean;
  treasurerFromInitialBalance: number;
  treasurerLamports: number;
}): Promise<MspSetup> {
  const payerWallet = new Wallet(payer);
  const payerProvider = new anchor.AnchorProvider(connection, payerWallet, options);
  anchor.setProvider(payerProvider);
  // this is a work around bug https://github.com/project-serum/anchor/issues/1159
  // TODO: go back to using 'anchor.workspace.Ddca' once 1159 is fixed
  const payerProgram = getWorkspace().Msp as Program<Msp>;

  await payerProvider.connection.confirmTransaction(
    await connection.requestAirdrop(treasurerKeypair.publicKey, treasurerLamports),
    'confirmed'
  );

  const slot = await payerProgram.provider.connection.getSlot('confirmed');
  const [treasury, treasuryBump] = await anchor.web3.PublicKey.findProgramAddress(
    [treasurerKeypair.publicKey.toBuffer(), new BN(slot).toBuffer('le', 8)],
    payerProgram.programId
  );

  const [treasuryMint, treasuryMintBump] = await anchor.web3.PublicKey.findProgramAddress(
    [treasurerKeypair.publicKey.toBuffer(), treasury.toBuffer(), new BN(slot).toBuffer('le', 8)],
    payerProgram.programId
  );

  const treasurerFromAccountInfo = await fromTokenClient.getOrCreateAssociatedAccountInfo(treasurerKeypair.publicKey);
  const treasurerFrom = treasurerFromAccountInfo.address;

  const treasuryFrom = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID, // associatedProgramId
    TOKEN_PROGRAM_ID, // programId
    fromTokenClient.publicKey, // mint
    treasury, // owner
    true // allowOwnerOffCurve
  );

  const mspFeesFrom = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    fromTokenClient.publicKey,
    MSP_FEES_PUBKEY,
    true
  );

  const treasuryFeePayer = Keypair.generate();

  console.log();
  console.log(`payer:                       ${payer.publicKey}`);
  console.log(`program:                     ${payerProgram.programId}`);
  console.log(`fromMint:                    ${fromTokenClient.publicKey}`);
  console.log(`treasurer:                   ${treasurerKeypair.publicKey}`);
  console.log(`treasurer key:               ${bs58.encode(treasurerKeypair.secretKey)}`);
  console.log(`treasurerFrom:               ${treasurerFrom}`);
  console.log(`treasuryFeePayer:            ${treasuryFeePayer.publicKey}`);
  console.log(`treasury:                    ${treasury}`);
  console.log(`treasuryFrom:                ${treasuryFrom}`);
  console.log(`treasuryMint:                ${treasuryMint}`);
  console.log(`feesFrom:                    ${mspFeesFrom}`);
  console.log(`slot:                        ${slot}`);
  console.log(`name:                        ${name}`);
  console.log(`treasuryType:                ${treasuryType}`);
  console.log(`autoClose:                   ${autoClose}`);
  console.log(`treasurerFromInitialBalance: ${treasurerFromInitialBalance}`);

  await fromTokenClient.mintTo(treasurerFrom, payer, [], treasurerFromInitialBalance);

  return new MspSetup(
    payer,
    payerProgram,
    fromTokenClient,
    treasurerKeypair,
    treasurerFrom,
    treasuryFeePayer,
    new BN(slot),
    treasury,
    treasuryBump,
    treasuryFrom,
    treasuryMint,
    treasuryMintBump,
    mspFeesFrom,
    name,
    treasuryType,
    autoClose
  );
}

export class MspSetup {
  public payer: Keypair;
  public program: Program<Msp>;
  public fromTokenClient: Token;
  public treasurerKeypair: Keypair;
  public treasurerFrom: PublicKey;
  public treasuryInitializer: Keypair;
  public slot: BN;
  public slotBuffer: Buffer;
  public treasury: PublicKey;
  public treasuryBump: number;
  public treasuryFrom: PublicKey;
  public treasuryLpMint: PublicKey;
  public treasuryMintBump: number;
  public feesFrom: PublicKey;
  // public feesTo: PublicKey;

  public name: string;
  public treasuryType: number;
  public autoClose: boolean;

  private tempoApiUrl = 'http://localhost:5010';
  /**
   *
   */
  constructor(
    payer: Keypair,
    program: Program<Msp>,
    fromTokenClient: Token,
    treasurerKeypair: Keypair,
    treasurerFrom: PublicKey,
    treasuryInitializer: Keypair,
    slot: BN,
    treasury: PublicKey,
    treasuryBump: number,
    treasuryFrom: PublicKey,
    treasuryLpMint: PublicKey,
    treasuryMintBump: number,
    feesFrom: PublicKey,

    name: string,
    treasuryType: number,
    autoClose: boolean
  ) {
    this.payer = payer;
    this.program = program;
    this.fromTokenClient = fromTokenClient;
    this.treasurerKeypair = treasurerKeypair;
    this.treasurerFrom = treasurerFrom;
    this.slot = slot;
    this.slotBuffer = slot.toBuffer('le', 8);
    this.treasury = treasury;
    this.treasuryBump = treasuryBump;
    this.treasuryFrom = treasuryFrom;
    this.treasuryInitializer = treasuryInitializer;
    this.treasuryLpMint = treasuryLpMint;
    this.treasuryMintBump = treasuryMintBump;
    this.feesFrom = feesFrom;
    this.name = name;
    this.treasuryType = treasuryType;
    this.autoClose = autoClose;
  }

  public get fromMint(): PublicKey {
    return this.fromTokenClient.publicKey;
  }

  public get connection(): Connection {
    return this.program.provider.connection;
  }

  public async createProgram(keypair: Keypair): Promise<Program<Msp>> {
    const wallet = new Wallet(keypair);
    const provider = new anchor.AnchorProvider(this.connection, wallet, options);

    anchor.setProvider(provider);
    // this is a work around bug https://github.com/project-serum/anchor/issues/1159
    // TODO: go back to using 'anchor.workspace.Ddca' once 1159 is fixed
    const program = getWorkspace().Msp as Program<Msp>;
    console.log(`program: ${program}`);

    return program;
  }

  public async createTreasury({
    treasurer,
    signers,
    tokenProgram,
    systemProgram,
    rent,
    treasuryLpMint,
    treasury,
    treasuryBump,
    solFeePayedByTreasury
  }: {
    treasurer?: PublicKey;
    signers?: Keypair[];
    tokenProgram?: PublicKey;
    systemProgram?: PublicKey;
    rent?: PublicKey;
    treasuryLpMint?: PublicKey;
    treasury?: PublicKey;
    treasuryBump?: number;
    solFeePayedByTreasury?: boolean;
  }) {
    console.log('\n\n********** CREATE TREASURY STARTED! **********');

    treasurer = treasurer ?? this.treasurerKeypair.publicKey;
    signers = signers ?? [this.treasurerKeypair];
    tokenProgram = tokenProgram ?? TOKEN_PROGRAM_ID;
    systemProgram = systemProgram ?? SYSTEM_PROGRAM_ID;
    rent = rent ?? SYSVAR_RENT_PUBKEY;
    treasuryLpMint = treasuryLpMint ?? this.treasuryLpMint;
    treasury = treasury ?? this.treasury;
    treasuryBump = treasuryBump ?? this.treasuryBump;
    solFeePayedByTreasury = solFeePayedByTreasury ?? false;

    const clusterNowTs = await this.program.provider.connection.getBlockTime(this.slot.toNumber());
    const preTreasurerAccountInfo = await this.connection.getAccountInfo(this.treasurerKeypair.publicKey);
    const preTreasurerLamports = preTreasurerAccountInfo!.lamports;

    const txId = await this.program.methods
      .createTreasury(
        LATEST_IDL_FILE_VERSION,
        this.slot,
        this.name,
        this.treasuryType,
        this.autoClose,
        solFeePayedByTreasury
      )
      .accounts({
        payer: treasurer,
        treasurer: treasurer,
        treasury: treasury,
        treasuryMint: treasuryLpMint,
        treasuryToken: this.treasuryFrom,
        associatedToken: this.fromMint,
        feeTreasury: MSP_FEES_PUBKEY,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: tokenProgram,
        systemProgram: systemProgram,
        rent: rent
      })
      .signers(signers)
      .rpc();
    console.log(`\nCREATE TREASURY TX URL: https://explorer.solana.com/tx/${txId}/?cluster=custom&customUrl=${url}`);

    // await connection.confirmTransaction(
    //   await connection.requestAirdrop(treasury, 1_000_000_000),
    //   "confirmed"
    // );

    const postState = await this.getMspWorldState();
    assert.isNotNull(postState.treasuryAccount, 'treasury was not created');
    assert.isNotNull(postState.treasurerAccountInfo, 'treasury was not created');
    // assert.isNotNull(postState.treasuryFromAccountInfo, "treasury 'from' was not created");
    assert.isNotNull(postState.treasurerAccountInfo, 'treasurer was not created');
    assert.isNotNull(postState.treasurerFromAccountInfo, "treasurer 'from' was not created");

    const actualName = String.fromCharCode(...postState.treasuryAccount!.name);
    const minNameLength = Math.min(actualName.length, this.name.length);
    expect(actualName.substring(0, minNameLength)).eq(this.name.substring(0, minNameLength));
    expect(postState.treasuryAccount!.bump).eq(treasuryBump);
    expect(postState.treasuryAccount!.mintAddress.toBase58()).eq(treasuryLpMint.toBase58());
    expect(postState.treasuryAccount!.slot.toNumber()).eq(this.slot.toNumber());
    expect(postState.treasuryAccount!.lastKnownBalanceBlockTime.toNumber()).eq(0);
    expect(postState.treasuryAccount!.lastKnownBalanceSlot.toNumber()).eq(0);
    expect(postState.treasuryAccount!.lastKnownBalanceUnits.toNumber()).eq(0);
    expect(postState.treasuryAccount!.totalStreams.toNumber()).eq(0);
    expect(postState.treasuryAccount!.totalWithdrawalsUnits.toNumber()).eq(0);
    expect(postState.treasuryAccount!.treasurerAddress.toBase58()).eq(this.treasurerKeypair.publicKey.toBase58());
    expect(postState.treasuryAccount!.treasuryType).eq(this.treasuryType);
    expect(postState.treasuryAccount!.version).eq(2);
    expect(postState.treasuryAccount!.allocationAssignedUnits.toNumber()).eq(0);
    expect(postState.treasuryAccount!.allocationReservedUnits.toNumber()).eq(0);
    expect(postState.treasuryAccount!.associatedTokenAddress.toBase58()).eq(this.fromMint.toBase58()); // not set yet
    expect(postState.treasuryAccount!.autoClose).eq(this.autoClose);

    const treasuryRentExemptLamports = new BN(
      await this.connection.getMinimumBalanceForRentExemption(MSP_TREASURY_ACCOUNT_SIZE_IN_BYTES)
    );
    const treasuryMintRentExemptLamports = new BN(
      await this.connection.getMinimumBalanceForRentExemption(SOLANA_MINT_ACCOUNT_SIZE_IN_BYTES)
    );

    let expectedPostTreasurerLamport = new BN(preTreasurerLamports)
      .sub(treasuryRentExemptLamports)
      .sub(treasuryMintRentExemptLamports)
      .sub(new BN(MSP_CREATE_TREASURY_FEE_IN_LAMPORTS))
      .sub(new BN(2_039_280)); // rent payed for the treasury associated token account
    if (solFeePayedByTreasury) {
      expectedPostTreasurerLamport = expectedPostTreasurerLamport.sub(
        new BN(MSP_CREATE_TREASURY_INITIAL_BALANCE_FOR_FEES)
      );
    }

    // console.log();
    // console.log(`preTreasurerLamports:                ${preTreasurerLamports}`);
    // console.log(`treasuryRentExemptLamports:          ${treasuryRentExemptLamports.toNumber()}`);
    // console.log(`treasuryMintRentExemptLamports:      ${treasuryMintRentExemptLamports.toNumber()}`);
    // console.log(`MSP_CREATE_TREASURY_FEE_IN_LAMPORTS: ${MSP_CREATE_TREASURY_FEE_IN_LAMPORTS}`);
    // console.log(`lamportsPerSignature:                ${lamportsPerSignature.toNumber()}`);
    // console.log(`expectedPostTreasurerLamport:        ${expectedPostTreasurerLamport.toNumber()}`);
    // console.log(`postState.treasurerLamports:         ${postState.treasurerLamports}`);

    expect(postState.treasurerLamports).eq(
      expectedPostTreasurerLamport.toNumber(),
      'incorrect treasurer lamports after create treasury'
    );

    console.log('\n********** CREATE TREASURY ENDED! **********');
  }

  // public async closeTreasury(
  //   treasurerSigner?: Keypair,
  //   treasurer?: PublicKey,
  //   treasurerFrom?: PublicKey,
  //   treasurerTreasuryLp?: PublicKey,
  //   treasury?: PublicKey,
  //   treasuryFrom?: PublicKey,
  //   // signers?: Keypair[],
  // ) {
  //   const ixName = "CREATE TREASURY";
  //   logStart(ixName);

  //   treasurerSigner = treasurerSigner ?? this.treasurerKeypair;
  //   treasurer = treasurer ?? this.treasurerKeypair.publicKey;
  //   treasurerFrom = treasurerFrom ?? this.treasurerFrom;
  //   treasurerTreasuryLp = treasurerTreasuryLp ?? await this.findTreasuryLpTokenAccountAddress(treasurer);
  //   treasury = treasury ?? this.treasury;
  //   treasuryFrom = treasuryFrom ?? this.treasuryFrom;
  //   // signers ?? [treasurerSigner];

  //   const clusterNowTs = await this.program.provider.connection.getBlockTime(this.slot.toNumber());
  //   const treasurerSignerProgram = await this.createProgram(treasurerSigner);

  //   // const preState = await this.getMspWorldState();
  //   // assert.isNotNull(preState.treasuryAccount, "pre-treasuryAccount was not found");
  //   // assert.isNotNull(preState.treasuryAccountInfo, "pre-treasuryAccountInfo was not found");
  //   // assert.isNotNull(preState.treasurerAccountInfo, "pre-treasurerAccountInfo was not found");

  //   const preTreasurerAccountInfo = await this.connection.getAccountInfo(this.treasurerKeypair.publicKey);
  //   const preTreasurerLamports = preTreasurerAccountInfo!.lamports;

  //   const txId = await treasurerSignerProgram.rpc.closeTreasury(
  //     {
  //       accounts: {
  //         payer: treasurer,
  //         treasurer: treasurer,
  //         treasurerToken: treasurerFrom,
  //         treasurerTreasuryToken: treasurerTreasuryLp,
  //         associatedToken: this.fromMint,
  //         treasury: treasury,
  //         treasuryToken: treasuryFrom,
  //         treasuryMint: this.treasuryLpMint,
  //         feeTreasury: MSP_FEES_PUBKEY,
  //         feeTreasuryToken: this.feesFrom,
  //         associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  //         tokenProgram: TOKEN_PROGRAM_ID,
  //         systemProgram: SYSTEM_PROGRAM_ID,
  //         rent: SYSVAR_RENT_PUBKEY,
  //       },
  //     }
  //   );
  //   logTxUrl(ixName, txId);

  //   // const postState = await this.getMspWorldState();

  //   const treasuryAccountInfo = await this.connection.getAccountInfo(treasury);
  //   const treasuryFromAccountInfo = await this.connection.getAccountInfo(treasuryFrom);
  //   // const treasuryLpMintAccountInfo = await this.connection.getAccountInfo(this.treasuryLpMint); // not needed as mints cannot be close

  //   console.log("treasuryFromAccountInfo", treasuryFromAccountInfo);
  //   assert.isNull(treasuryAccountInfo, "treasury still exists after 'close tresury'");
  //   assert.isNull(treasuryFromAccountInfo, "treasuryFrom still exists after 'close tresury'");

  //   logEnd(ixName);
  // }

  // public async addFunds(
  //   amount: number,
  //   allocationType: StreamAllocationType,
  //   contributorKeypair?: Keypair,
  //   contributorTokenAccount?: PublicKey,
  //   contributorLpTokenAccount?: PublicKey,
  //   stream?: PublicKey,
  //   signers?: Keypair[],
  //   associatedTokenProgram?: PublicKey,
  //   tokenProgram?: PublicKey,
  //   systemProgram?: PublicKey,
  //   rent?: PublicKey,
  //   treasuryAssociatedMint?: PublicKey,
  //   treasuryFrom?: PublicKey,
  // ) {

  //   const ixName = "ADD FUNDS";
  //   logStart(ixName);

  //   contributorKeypair = contributorKeypair ?? this.treasurerKeypair;
  //   contributorTokenAccount = contributorTokenAccount ?? this.treasurerFrom;
  //   if (!contributorLpTokenAccount) {
  //     contributorLpTokenAccount = await this.findTreasuryLpTokenAccountAddress(contributorKeypair.publicKey);
  //   }
  //   signers = signers ?? [contributorKeypair];
  //   associatedTokenProgram = associatedTokenProgram ?? ASSOCIATED_TOKEN_PROGRAM_ID;
  //   tokenProgram = tokenProgram ?? TOKEN_PROGRAM_ID;
  //   systemProgram = systemProgram ?? SYSTEM_PROGRAM_ID;
  //   rent = rent ?? SYSVAR_RENT_PUBKEY;
  //   treasuryAssociatedMint = treasuryAssociatedMint ?? this.fromMint;
  //   treasuryFrom = treasuryFrom ?? this.treasuryFrom;

  //   const preState = await this.getMspWorldState();

  //   const preContributorAccountInfo = await this.connection.getAccountInfo(contributorKeypair.publicKey);
  //   expect(preContributorAccountInfo).to.exist;
  //   const preContributorLamports = preContributorAccountInfo!.lamports;

  //   const shouldCreateTreasuryFromAta = !preState.treasuryFromAccountInfo;
  //   const treasuryFromAtaBalanceResult = await this.getTokenAccountBalance(treasuryFrom);
  //   const preTreasuryFromAtaAmount = new BN(treasuryFromAtaBalanceResult?.amount ?? 0);
  //   const contributorTreasuryMintAtaBalanceResult = await this.getTokenAccountBalance(contributorLpTokenAccount);
  //   // const shouldCreateContributorTreasuryMintAta =  !(await this.connection.getAccountInfo(contributorTreasuryMintTokenAccount));
  //   const shouldCreateContributorTreasuryMintAta = !contributorTreasuryMintAtaBalanceResult;
  //   const preContributorTreasuryMintAtaAmount = new BN(contributorTreasuryMintAtaBalanceResult?.amount ?? 0);

  //   const shouldCreateFeesATA = !preState.feesFromAccountInfo;
  //   const feesFromAtaBalanceResult = await this.getTokenAccountBalance(this.feesFrom);
  //   const preFeesFromAtaAmount = new BN(feesFromAtaBalanceResult?.amount ?? 0);

  //   assert.isNotNull(preState.treasuryAccount, "pre-treasuryAccount was not found");
  //   assert.isNotNull(preState.treasuryAccountInfo, "pre-treasuryAccountInfo was not found");
  //   assert.isNotNull(preState.treasurerAccountInfo, "pre-treasurerAccountInfo was not found");

  //   const amountBn = new BN(amount);
  //   let feeAmount = new BN(0);
  //   let preStream = !stream ? undefined : await this.getStream(contributorKeypair, stream as PublicKey);

  //   if (allocationType === StreamAllocationType.AssignToSpecificStream && preStream) {
  //     feeAmount = new BN(MSP_WITHDRAW_FEE_PCT_NUMERATOR)
  //       .mul(amountBn)
  //       .div(new BN(100))
  //       .div(new BN(MSP_FEE_PCT_DENOMINATOR));
  //   }

  //   const clusterNowTs = await this.program.provider.connection.getBlockTime(this.slot.toNumber());
  //   const clusterNowSlot = await this.connection.getSlot();
  //   const streamAccountArgument = stream ?? PublicKey.default;

  //   stream = stream ?? Keypair.generate().publicKey; // this is a workaround for optional account

  //   console.log();
  //   console.log(`contributor:            ${contributorKeypair.publicKey}`);
  //   console.log(`contributorToken:       ${contributorTokenAccount}`);
  //   console.log(`treasury:               ${this.treasury}`);
  //   console.log(`treasuryAssociatedMint: ${treasuryAssociatedMint}`);
  //   console.log(`allocationStreamParam:  ${streamAccountArgument}`);
  //   console.log(`stream:                 ${stream}`);

  //   const txId = await this.program.rpc.addFunds(
  //     amountBn,
  //     allocationType,
  //     streamAccountArgument, // this is a workaround for optional account
  //     {
  //       accounts: {
  //         payer: contributorKeypair.publicKey,
  //         contributor: contributorKeypair.publicKey,
  //         contributorToken: contributorTokenAccount,
  //         contributorTreasuryToken: contributorLpTokenAccount,
  //         treasury: this.treasury,
  //         treasuryToken: treasuryFrom,
  //         associatedToken: treasuryAssociatedMint,
  //         treasuryMint: this.treasuryLpMint,
  //         stream: stream,
  //         feeTreasury: MSP_FEES_PUBKEY,
  //         feeTreasuryToken: this.feesFrom,
  //         associatedTokenProgram: associatedTokenProgram,
  //         tokenProgram: tokenProgram,
  //         systemProgram: systemProgram,
  //         rent: rent,
  //       },
  //       signers: signers,
  //     }
  //   );
  //   logTxUrl(ixName, txId);

  //   const statusResult = (
  //     await connection.confirmTransaction(
  //       txId,
  //       "confirmed",
  //     )
  //   );
  //   const txSlot = statusResult.context.slot;
  //   const txTs = await this.connection.getBlockTime(txSlot);
  //   expect(txTs).to.exist;

  //   const postState = await this.getMspWorldState();

  //   const postContributorAccountInfo = await this.connection.getAccountInfo(contributorKeypair.publicKey);
  //   expect(postContributorAccountInfo).to.exist;
  //   const postContributorLamports = postContributorAccountInfo!.lamports;

  //   assert.isNotNull(postState.treasuryAccount, "treasury was not found");
  //   assert.isNotNull(postState.treasurerAccountInfo, "treasury was not found");
  //   assert.isNotNull(postState.treasuryFromAccountInfo, "treasury 'from' was not created");
  //   assert.isNotNull(postState.treasurerAccountInfo, "treasurer was not found");
  //   assert.isNotNull(postState.treasurerFromAccountInfo, "treasurer 'from' was not found");

  //   // expect(postState.treasuryAccount.mintAddress.toBase58()).eq(this.treasuryMint.toBase58());
  //   expect(postState.treasuryAccount!.lastKnownBalanceBlockTime.toNumber()).gte(txTs! - 1);
  //   expect(postState.treasuryAccount!.lastKnownBalanceBlockTime.toNumber()).lte(txTs!);
  //   expect(postState.treasuryAccount!.lastKnownBalanceSlot.toNumber()).gte(txSlot - 1);
  //   expect(postState.treasuryAccount!.lastKnownBalanceSlot.toNumber()).lte(txSlot);
  //   expect(postState.treasuryAccount!.lastKnownBalanceUnits.toNumber()).eq(
  //     preState.treasuryAccount!.lastKnownBalanceUnits
  //       .add(amountBn)
  //       .toNumber()
  //   );

  //   if (streamAccountArgument.equals(PublicKey.default)) {
  //     // expect(postState.treasuryAccount!.allocationAssignedUnits.toNumber()).eq(preState.treasuryAccount!.allocationAssignedUnits.toNumber());
  //     // expect(postState.treasuryAccount!.allocationReservedUnits.toNumber()).eq(preState.treasuryAccount!.allocationReservedUnits.toNumber());
  //   } else {
  //     expect(postState.treasuryAccount!.allocationAssignedUnits.toNumber())
  //       .eq(
  //         preState.treasuryAccount!.allocationAssignedUnits
  //           .add(amountBn)
  //           .toNumber()
  //       );
  //     // expect(postState.treasuryAccount.allocationReservedUnits.toNumber()).eq(preState.treasuryAccount.allocationReservedUnits.toNumber());
  //   }

  //   expect(postState.treasuryAccount!.associatedTokenAddress.toBase58()).eq(this.fromTokenClient.publicKey.toBase58()); // it should be set by now

  //   const tokenAccountRentExemptLamports = new BN(await this.connection.getMinimumBalanceForRentExemption(SOLANA_TOKEN_ACCOUNT_SIZE_IN_BYTES));
  //   const lamportsPerSignature = new BN(await this.getLamportsPerSignature());

  //   const expectedPostContributorLamport = new BN(preContributorLamports)
  //     .sub(shouldCreateTreasuryFromAta ? tokenAccountRentExemptLamports : new BN(0))
  //     .sub(shouldCreateContributorTreasuryMintAta ? tokenAccountRentExemptLamports : new BN(0))
  //     .sub(shouldCreateFeesATA ? tokenAccountRentExemptLamports : new BN(0))
  //     // .sub(new BN(MSP_ADD_FUNDS_FEE_IN_LAMPORTS)) TODO: commented out until we decide if we go ahead with sol_fee_payed_by_treasury
  //     // .sub(lamportsPerSignature)
  //     ;

  //   // console.log();
  //   // console.log(`preContributorLamports:                 ${preContributorLamports}`);
  //   // console.log(`treasuryTokenAccountRentExemptLamports: ${tokenAccountRentExemptLamports.toNumber()}`);
  //   // console.log(`MSP_ADD_FUNDS_FEE_IN_LAMPORTS:          ${MSP_ADD_FUNDS_FEE_IN_LAMPORTS}`,);
  //   // console.log(`lamportsPerSignature:                   ${lamportsPerSignature.toNumber()}`);
  //   // console.log(`expectedPostContributorLamport:         ${expectedPostContributorLamport.toNumber()}`);
  //   // console.log(`postContributorLamports:                ${postContributorLamports}`);

  //   expect(postContributorLamports).eq(
  //     expectedPostContributorLamport.toNumber(),
  //     "incorrect contributor lamports after add funds"
  //   );

  //   // balances
  //   const postTreasuryFromBalance = await this.getTokenAccountBalance(this.treasuryFrom);
  //   expect(postTreasuryFromBalance).to.exist;
  //   const postTreasuryFromAtaAmount = new BN(postTreasuryFromBalance!.amount);

  //   const postContributorTreasuryMintAta = await this.getTokenAccountBalance(contributorLpTokenAccount);
  //   expect(postContributorTreasuryMintAta).to.exist;
  //   const postContributorTreasuryMintAtaAmount = new BN(postContributorTreasuryMintAta!.amount);

  //   expect(postTreasuryFromAtaAmount.toNumber()).eq(
  //     preTreasuryFromAtaAmount
  //       .add(amountBn)
  //       .toNumber()
  //   );

  //   expect(postContributorTreasuryMintAtaAmount.toNumber()).eq(
  //     preContributorTreasuryMintAtaAmount
  //       .add(amountBn)
  //       .toNumber()
  //   );

  //   if (allocationType === StreamAllocationType.AssignToSpecificStream && preStream) {
  //     const postFeeFromBalance = await this.getTokenAccountBalance(this.feesFrom);
  //     expect(postFeeFromBalance).to.exist;
  //     const postFeeFromAtaAmount = new BN(postFeeFromBalance!.amount);
  //     expect(
  //       postFeeFromAtaAmount.eq(preFeesFromAtaAmount.add(feeAmount)),
  //       "incorrect fee treasury amount after allocate funds to s stream"
  //     );
  //   }

  //   logEnd(ixName);
  // }

  // public async createTreasury(treasurer?: PublicKey, signers?: Keypair[]) {

  //   treasurer = treasurer ?? this.treasurerKeypair.publicKey;
  //   signers = signers ?? [this.treasurerKeypair];

  public async createStream({
    name,
    startTs,
    rateAmountUnits,
    rateIntervalInSeconds,
    allocationAssignedUnits,
    cliffVestAmountUnits,
    cliffVestPercent,
    initializerKeypair,
    beneficiary,
    streamKeypair,
    treasury,
    treasuryFrom,
    feePayedByTreasurer,
    signers
  }: {
    name: string;
    startTs: number;
    rateAmountUnits: number;
    rateIntervalInSeconds: number;
    allocationAssignedUnits: number;
    cliffVestAmountUnits: number;
    cliffVestPercent: number;
    initializerKeypair: Keypair;
    beneficiary: PublicKey;
    streamKeypair: Keypair;
    treasury?: PublicKey;
    treasuryFrom?: PublicKey;
    feePayedByTreasurer?: boolean;
    signers?: Keypair[];
  }) {
    const ixName = 'CREATE STREAM';
    logStart(ixName);

    treasury = treasury ?? this.treasury;
    treasuryFrom = treasuryFrom ?? this.treasuryFrom;
    signers = signers ?? [initializerKeypair, this.treasurerKeypair, streamKeypair];

    const preTreasury = await this.program.account.treasury.fetchNullable(treasury);
    assert.isNotNull(preTreasury);

    console.log();
    console.log(`name:                    ${name}`);
    console.log(`startTs:                 ${startTs}`);
    console.log(`rateAmountUnits:         ${rateAmountUnits}`);
    console.log(`rateIntervalInSeconds:   ${rateIntervalInSeconds}`);
    console.log(`allocationAssignedUnits: ${allocationAssignedUnits}`);
    console.log(`cliffVestAmountUnits:    ${cliffVestAmountUnits}`);
    console.log(`cliffVestPercent:        ${cliffVestPercent}`);
    console.log(`initializer:             ${initializerKeypair.publicKey}`);
    console.log(`initializer key:         ${bs58.encode(initializerKeypair.secretKey)}`);
    console.log(`beneficiary:             ${beneficiary}`);
    console.log(`stream:                  ${streamKeypair.publicKey}`);

    // let createStreamTx = this.program.transaction.createStream(
    //   name,
    //   new BN(startTs),
    //   new BN(rateAmountUnits),
    //   new BN(rateIntervalInSeconds),
    //   new BN(allocationAssignedUnits),
    //   new BN(allocationReservedUnits),
    //   new BN(cliffVestAmountUnits),
    //   new BN(cliffVestPercent),
    //   {
    //     accounts: {
    //       initializer: initializerKeypair.publicKey,
    //       treasurer: this.treasurerKeypair.publicKey,
    //       treasury: treasury,
    //       associatedToken: this.fromTokenClient.publicKey,
    //       beneficiary: beneficiary,
    //       stream: streamKeypair.publicKey,
    //       feeTreasury: MSP_FEES_PUBKEY,
    //       msp: this.program.programId,
    //       systemProgram: SYSTEM_PROGRAM_ID,
    //       rent: SYSVAR_RENT_PUBKEY,
    //     },
    //     // signers: [initializerKeypair, streamKeypair]
    //   }
    // );
    // createStreamTx.feePayer = initializerKeypair.publicKey;
    // createStreamTx.recentBlockhash = (await this.connection.getRecentBlockhash()).blockhash;
    // createStreamTx.partialSign(initializerKeypair);
    // createStreamTx.partialSign(streamKeypair);
    // const createStreamTxBase64 = createStreamTx.serialize({ verifySignatures: true, requireAllSignatures: false }).toString("base64");
    // console.log();
    // console.log("createStreamTxBase64");
    // console.log(createStreamTxBase64);

    const treasurerTokenPreBalanceBn = new BN(
      parseInt((await this.getTokenAccountBalance(this.treasurerFrom))?.amount || '0')
    );

    const txId = await this.program.methods
      .createStream(
        LATEST_IDL_FILE_VERSION,
        name,
        new BN(startTs),
        new BN(rateAmountUnits),
        new BN(rateIntervalInSeconds),
        new BN(allocationAssignedUnits),
        new BN(cliffVestAmountUnits),
        new BN(cliffVestPercent),
        feePayedByTreasurer ?? false
      )
      .accounts({
        payer: initializerKeypair.publicKey,
        initializer: initializerKeypair.publicKey,
        treasurer: this.treasurerKeypair.publicKey,
        treasury: treasury,
        treasuryToken: treasuryFrom,
        associatedToken: this.fromTokenClient.publicKey,
        beneficiary: beneficiary,
        stream: streamKeypair.publicKey,
        feeTreasury: MSP_FEES_PUBKEY,
        feeTreasuryToken: this.feesFrom,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SYSTEM_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY
      })
      .signers(signers)
      .rpc();
    logTxUrl(ixName, txId);

    // assert stream
    const postStream = await this.program.account.stream.fetchNullable(streamKeypair.publicKey);
    assert.isNotNull(postStream);

    expect(postStream!.version).eq(2);
    expect(postStream!.initialized).eq(true);
    expect(postStream!.treasurerAddress.toBase58()).eq(this.treasurerKeypair.publicKey.toBase58());
    expect(postStream!.rateAmountUnits.toNumber()).eq(rateAmountUnits);
    expect(postStream!.rateIntervalInSeconds.toNumber()).eq(rateIntervalInSeconds);
    expect(postStream!.startUtc.toNumber()).gte(startTs);
    expect(postStream!.startUtcInSeconds.toNumber()).gte(startTs);
    const expectedEffectiveCliffUnits =
      cliffVestPercent > 0
        ? new BN(cliffVestPercent).mul(new BN(allocationAssignedUnits)).divn(1_000_000).toNumber()
        : cliffVestAmountUnits;
    expect(postStream!.cliffVestAmountUnits.toNumber()).eq(expectedEffectiveCliffUnits);
    expect(postStream!.cliffVestPercent.toNumber()).eq(0);
    expect(postStream!.beneficiaryAddress.toBase58()).eq(beneficiary.toBase58());
    expect(postStream!.beneficiaryAssociatedToken.toBase58()).eq(this.fromTokenClient.publicKey.toBase58());
    expect(postStream!.treasuryAddress.toBase58()).eq(treasury.toBase58());
    expect(postStream!.allocationAssignedUnits.toNumber()).eq(allocationAssignedUnits);
    expect(postStream!.allocationReservedUnits.toNumber()).eq(0); // deprecated
    expect(postStream!.totalWithdrawalsUnits.toNumber()).eq(0);
    expect(postStream!.lastWithdrawalUnits.toNumber()).eq(0);
    expect(postStream!.lastWithdrawalSlot.toNumber()).eq(0);
    expect(postStream!.lastWithdrawalBlockTime.toNumber()).eq(0);
    expect(postStream!.lastManualStopWithdrawableUnitsSnap.toNumber()).eq(0);
    expect(postStream!.lastManualStopSlot.toNumber()).eq(0);
    expect(postStream!.lastManualStopBlockTime.toNumber()).eq(0);
    expect(postStream!.lastManualResumeRemainingAllocationUnitsSnap.toNumber()).eq(0);
    expect(postStream!.lastManualResumeSlot.toNumber()).eq(0);
    expect(postStream!.lastManualResumeBlockTime.toNumber()).eq(0);
    expect(postStream!.lastKnownTotalSecondsInPausedStatus.toNumber()).eq(0);

    const now_ts = Math.round(Date.now() / 1000);
    // no more than 5 seconds offset between now and the created_on_utc of the
    // stream that was just created
    expect(Math.abs(postStream!.createdOnUtc.toNumber() - now_ts)).lte(5);

    if (feePayedByTreasurer === true) {
      expect(postStream!.feePayedByTreasurer).eq(true);
      console.log('pre treasurer token amount', treasurerTokenPreBalanceBn.toNumber());
      const treasurerTokenPostBalanceBn = new BN(
        parseInt((await this.getTokenAccountBalance(this.treasurerFrom))?.amount || '0')
      );
      const treasurerFeeBn = new BN(allocationAssignedUnits)
        .mul(new BN(MSP_WITHDRAW_FEE_PCT_NUMERATOR))
        .div(new BN(MSP_FEE_PCT_DENOMINATOR));

      console.log('stream fee payed by the treasurer', treasurerFeeBn.toNumber());
      console.log('pre treasurer token amount', treasurerTokenPostBalanceBn.toNumber());
      expect(
        treasurerTokenPostBalanceBn.toNumber() === treasurerTokenPreBalanceBn.sub(treasurerFeeBn).toNumber(),
        'incorrect treasurer balance after create a stream as a fee payer'
      );
    } else {
      expect(postStream!.feePayedByTreasurer).eq(false);
    }

    // assert treasury
    const postTreasury = await this.program.account.treasury.fetchNullable(treasury);
    assert.isNotNull(postTreasury);
    // console.log(postTreasury);
    expect(postTreasury!.totalStreams.toNumber()).eq(preTreasury!.totalStreams.addn(1).toNumber());

    logEnd(ixName);
  }

  public async getCreateStreamTx(
    name: string,
    startTs: number,
    rateAmountUnits: number,
    rateIntervalInSeconds: number,
    allocationAssignedUnits: number,
    allocationReservedUnits: number,
    cliffVestAmountUnits: number,
    cliffVestPercent: number,

    initializerKeypair: Keypair,
    beneficiary: PublicKey,
    streamKeypair: Keypair
  ): Promise<Transaction> {
    console.log();
    console.log(`name:                    ${name}`);
    console.log(`startTs:                 ${startTs}`);
    console.log(`rateAmountUnits:         ${rateAmountUnits}`);
    console.log(`rateIntervalInSeconds:   ${rateIntervalInSeconds}`);
    console.log(`allocationAssignedUnits: ${allocationAssignedUnits}`);
    console.log(`allocationReservedUnits: ${allocationReservedUnits}`);
    console.log(`cliffVestAmountUnits:    ${cliffVestAmountUnits}`);
    console.log(`cliffVestPercent:        ${cliffVestPercent}`);
    console.log(`initializer:             ${initializerKeypair.publicKey}`);
    console.log(`initializer key:         ${bs58.encode(initializerKeypair.secretKey)}`);
    console.log(`beneficiary:             ${beneficiary}`);
    console.log(`stream:                  ${streamKeypair.publicKey}`);

    const createStreamTx = this.program.transaction.createStream(
      name,
      new BN(startTs),
      new BN(rateAmountUnits),
      new BN(rateIntervalInSeconds),
      new BN(allocationAssignedUnits),
      new BN(allocationReservedUnits),
      new BN(cliffVestAmountUnits),
      new BN(cliffVestPercent),
      false,
      {
        accounts: {
          payer: initializerKeypair.publicKey,
          initializer: initializerKeypair.publicKey,
          treasurer: this.treasurerKeypair.publicKey,
          treasury: this.treasury,
          treasuryToken: this.treasuryFrom,
          associatedToken: this.fromTokenClient.publicKey,
          beneficiary: beneficiary,
          stream: streamKeypair.publicKey,
          feeTreasury: MSP_FEES_PUBKEY,
          feeTreasuryToken: this.feesFrom,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SYSTEM_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY
        }
        // signers: [initializerKeypair, streamKeypair]
      }
    );
    createStreamTx.feePayer = initializerKeypair.publicKey;
    createStreamTx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    createStreamTx.partialSign(initializerKeypair);
    createStreamTx.partialSign(streamKeypair);

    return createStreamTx;
  }

  public async withdraw({
    amount,
    beneficiaryKeypair,
    beneficiary,
    beneficiaryFrom,
    stream,
    treasury,
    treasuryFrom,
    payer
  }: {
    amount: number;
    beneficiaryKeypair: Keypair;
    beneficiary: PublicKey;
    beneficiaryFrom: PublicKey;
    stream: PublicKey;
    treasury?: PublicKey;
    treasuryFrom?: PublicKey;
    payer?: Keypair;
  }) {
    const ixName = 'WITHDRAW';
    logStart(ixName);

    const program = payer ? await this.createProgram(payer) : this.program;

    treasury = treasury ?? this.treasury;
    treasuryFrom = treasuryFrom ?? this.treasuryFrom;

    const preState = await this.getMspWorldState(treasury, treasuryFrom);
    console.log();
    console.log(`treasury.allocationAssignedUnits: ${preState.treasuryAccount?.allocationAssignedUnits.toNumber()}`);
    console.log(`treasury.allocationReservedUnits: ${preState.treasuryAccount?.allocationReservedUnits.toNumber()}`);

    const preBeneficiaryAccountInfo = await this.connection.getAccountInfo(beneficiary);
    expect(preBeneficiaryAccountInfo).exist;
    const preBeneficiaryLamports = preBeneficiaryAccountInfo!.lamports;
    const beneficiaryFromAtaBalanceResult = await this.getTokenAccountBalance(beneficiaryFrom);
    const shouldCreateBeneficiaryFromAta = !beneficiaryFromAtaBalanceResult;

    const treasuryFromAtaBalanceResult = await this.getTokenAccountBalance(treasuryFrom);
    const preTreasuryFromAtaAmount = new BN(treasuryFromAtaBalanceResult?.amount ?? 0);
    const feesFromAtaBalanceResult = await this.getTokenAccountBalance(this.feesFrom);
    const shouldCreateFeesFromAta = !feesFromAtaBalanceResult;

    assert.isNotNull(preState.treasuryAccount, 'pre-treasuryAccount was not found');
    assert.isNotNull(preState.treasuryAccountInfo, 'pre-treasuryAccountInfo was not found');
    assert.isNotNull(preState.treasurerAccountInfo, 'pre-treasurerAccountInfo was not found');

    const amountBn = new BN(amount);

    const txId = await program.methods
      .withdraw(LATEST_IDL_FILE_VERSION, amountBn)
      .accounts({
        payer: beneficiary,
        beneficiary: beneficiary,
        beneficiaryToken: beneficiaryFrom,
        associatedToken: this.fromMint,
        treasury: treasury,
        treasuryToken: treasuryFrom,
        stream: stream,
        feeTreasury: MSP_FEES_PUBKEY,
        feeTreasuryToken: this.feesFrom,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SYSTEM_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY
      })
      .signers([beneficiaryKeypair])
      .rpc();
    logTxUrl(ixName, txId);

    const statusResult = await connection.confirmTransaction(txId, 'confirmed');
    const txSlot = statusResult.context.slot;
    const txTs = await this.connection.getBlockTime(txSlot);
    assert.isNotNull(txTs);

    const postState = await this.getMspWorldState(treasury, treasuryFrom);
    console.log();
    console.log(`treasury.allocationAssignedUnits: ${postState.treasuryAccount?.allocationAssignedUnits.toNumber()}`);
    console.log(`treasury.allocationReservedUnits: ${postState.treasuryAccount?.allocationReservedUnits.toNumber()}`);

    const postBeneficiaryLamports = (await this.connection.getAccountInfo(beneficiary))?.lamports;
    assert.isNotNull(postState.treasuryAccount, 'treasury was not found');
    assert.isNotNull(postState.treasurerAccountInfo, 'treasury was not found');
    assert.isNotNull(postState.treasuryFromAccountInfo, "treasury 'from' was not created");
    assert.isNotNull(postState.treasurerAccountInfo, 'treasurer was not found');
    assert.isNotNull(postState.treasurerFromAccountInfo, "treasurer 'from' was not found");

    expect(postState.treasuryAccount!.lastKnownBalanceBlockTime.toNumber()).gte(txTs! - 1);
    expect(postState.treasuryAccount!.lastKnownBalanceBlockTime.toNumber()).lte(txTs!);
    expect(postState.treasuryAccount!.lastKnownBalanceSlot.toNumber()).gte(txSlot - 1);
    expect(postState.treasuryAccount!.lastKnownBalanceSlot.toNumber()).lte(txSlot);

    // if(stream.equals(PublicKey.default)){
    //   expect(postState.treasuryAccount.allocationAssignedUnits.toNumber()).eq(preState.treasuryAccount.allocationAssignedUnits.toNumber());
    //   expect(postState.treasuryAccount.allocationReservedUnits.toNumber()).eq(preState.treasuryAccount.allocationReservedUnits.toNumber());
    // } else {
    //   expect(postState.treasuryAccount.allocationAssignedUnits.toNumber())
    //   .eq(
    //     preState.treasuryAccount.allocationAssignedUnits
    //     .add(amountBn)
    //     .toNumber()
    //     );
    // }

    expect(postState.treasuryAccount!.associatedTokenAddress.toBase58()).eq(this.fromTokenClient.publicKey.toBase58()); // it should not change

    const tokenAccountRentExemptLamports = new BN(
      await this.connection.getMinimumBalanceForRentExemption(SOLANA_TOKEN_ACCOUNT_SIZE_IN_BYTES)
    );

    const expectedPostBeneficiaryLamports = new BN(preBeneficiaryLamports)
      .sub(shouldCreateBeneficiaryFromAta ? tokenAccountRentExemptLamports : new BN(0))
      .sub(shouldCreateFeesFromAta ? tokenAccountRentExemptLamports : new BN(0));

    // console.log();
    // console.log(`preBeneficiaryLamports:                    ${preBeneficiaryLamports}`);
    // console.log(`beneficiaryTokenAccountRentExemptLamports: ${tokenAccountRentExemptLamports.toNumber()}`);
    // console.log(`MSP_WITHDRAW_FEE_PCT_NUMERATOR:            ${MSP_WITHDRAW_FEE_PCT_NUMERATOR}`);
    // console.log(`lamportsPerSignature:                      ${lamportsPerSignature.toNumber()}`);
    // console.log(`expectedPostBeneficiaryLamports:           ${expectedPostBeneficiaryLamports.toNumber()}`);
    // console.log(`postBeneficiaryLamports:                   ${postBeneficiaryLamports}`);

    expect(postBeneficiaryLamports).eq(
      expectedPostBeneficiaryLamports.toNumber(),
      'incorrect beneficiary lamports after withdraw'
    );

    // balances
    const postBeneficiaryFrom = await this.getTokenAccountBalance(beneficiaryFrom);
    expect(postBeneficiaryFrom).to.exist;

    const postTreasuryFrom = await this.getTokenAccountBalance(treasuryFrom);
    expect(postTreasuryFrom).to.exist;

    const postFeesFrom = await this.getTokenAccountBalance(this.feesFrom);
    expect(postFeesFrom).to.exist;

    // const postTreasuryFromAtaAmount = new BN(postTreasuryFrom!.amount);
    // expect(postTreasuryFromAtaAmount.toNumber()).eq(
    //   preTreasuryFromAtaAmount
    //     .sub(amountBn)
    //     .toNumber()
    // );

    logEnd(ixName);

    return txId;
  }

  // public async closeStream(
  //   beneficiary: PublicKey,
  //   beneficiaryFrom: PublicKey,
  //   stream: PublicKey,
  //   autoCloseTreasury: boolean,
  //   treasurer?: PublicKey,
  //   treasurerFrom?: PublicKey,
  //   treasury?: PublicKey,
  //   treasuryFrom?: PublicKey,
  //   fees?: PublicKey,
  //   feesFrom?: PublicKey,
  //   signers?: Keypair[],
  // ) {

  //   const ixName = "CLOSE STREAM";
  //   logStart(ixName);

  //   const preState = await this.getMspWorldState();
  //   const preStateStream = await this.program.account.stream.fetch(stream);
  //   assert.isNotNull(preStateStream, 'pre-state stream was not found');

  //   treasurer = treasurer ?? this.treasurerKeypair.publicKey;
  //   treasurerFrom = treasurerFrom ?? this.treasurerFrom;

  //   treasury = treasury ?? this.treasury;
  //   treasuryFrom = treasuryFrom ?? this.treasuryFrom;

  //   fees = fees ?? MSP_FEES_PUBKEY;
  //   feesFrom = feesFrom ?? this.feesFrom;

  //   signers = signers ?? [this.treasurerKeypair];

  //   const preBeneficiaryAccountInfo = await this.connection.getAccountInfo(beneficiary);
  //   expect(preBeneficiaryAccountInfo).to.exist;
  //   const preBeneficiaryLamports = preBeneficiaryAccountInfo!.lamports;

  //   const preTreasurerAccountInfo = await this.connection.getAccountInfo(treasurer);
  //   expect(preTreasurerAccountInfo).to.exist;
  //   const preTreasurerLamports = preTreasurerAccountInfo!.lamports;

  //   const beneficiaryFromAtaBalanceResult = await this.getTokenAccountBalance(beneficiaryFrom);
  //   const shouldCreateBeneficiaryFromAta = !beneficiaryFromAtaBalanceResult;
  //   const preBeneficiaryFromAtaAmount = new BN(beneficiaryFromAtaBalanceResult?.amount ?? 0);

  //   const preStreamAccountInfo = await this.program.account.stream.getAccountInfo(stream);
  //   expect(preStreamAccountInfo).to.exist;
  //   const preStreamAccountLamports = preStreamAccountInfo!.lamports;

  //   const feesFromAtaBalanceResult = await this.getTokenAccountBalance(feesFrom);
  //   const shouldCreateFeesFromAta = !feesFromAtaBalanceResult;
  //   const preFeesFromAtaAmount = new BN(feesFromAtaBalanceResult?.amount ?? 0);

  //   assert.isNotNull(preState.treasuryAccount, "pre-treasuryAccount was not found");
  //   assert.isNotNull(preState.treasuryAccountInfo, "pre-treasuryAccountInfo was not found");
  //   assert.isNotNull(preState.treasurerAccountInfo, "pre-treasurerAccountInfo was not found");

  //   const clusterNowTs = await this.connection.getBlockTime(this.slot.toNumber());
  //   const clusterNowSlot = await this.connection.getSlot();

  //   const treasurerTreasuryMintTokenAccount = await this.findTreasuryLpTokenAccountAddress(treasurer);

  //   const txId = await this.program.rpc.closeStream(
  //     autoCloseTreasury,
  //     {
  //       accounts: {
  //         payer: treasurer,
  //         treasurer: treasurer,
  //         treasurerToken: treasurerFrom,
  //         treasurerTreasuryToken: treasurerTreasuryMintTokenAccount,
  //         beneficiary: beneficiary,
  //         beneficiaryToken: beneficiaryFrom,
  //         associatedToken: this.fromMint,
  //         treasury: treasury,
  //         treasuryToken: treasuryFrom,
  //         treasuryMint: this.treasuryLpMint,
  //         stream: stream,
  //         feeTreasury: fees,
  //         feeTreasuryToken: feesFrom,
  //         associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  //         tokenProgram: TOKEN_PROGRAM_ID,
  //         systemProgram: SYSTEM_PROGRAM_ID,
  //         rent: SYSVAR_RENT_PUBKEY,
  //       },
  //       signers: signers,
  //     }
  //   );
  //   logTxUrl(ixName, txId);

  //   const statusResult = (
  //     await connection.confirmTransaction(
  //       txId,
  //       "confirmed",
  //     )
  //   );

  //   const txSlot = statusResult.context.slot;
  //   const txTs = await this.connection.getBlockTime(txSlot);
  //   expect(txTs).to.exist;

  //   const postState = await this.getMspWorldState();
  //   const postStateStream = await this.program.account.stream.fetchNullable(stream);
  //   assert.isNull(postStateStream, 'stream was not closed');

  //   if (autoCloseTreasury) {
  //     assert.isNull(postState.treasuryAccountInfo, "treasury was not closed");
  //     assert.isNull(postState.treasuryFromAccountInfo, "treasury token was not closed");
  //   } else {
  //     assert.isNotNull(postState.treasuryAccountInfo, "treasury was not found");
  //     assert.isNotNull(postState.treasuryFromAccountInfo, "treasury token was not found");
  //     expect(postState.treasuryAccount!.lastKnownBalanceBlockTime.toNumber()).gte(txTs! - 1);
  //     expect(postState.treasuryAccount!.lastKnownBalanceBlockTime.toNumber()).lte(txTs!);
  //     expect(postState.treasuryAccount!.lastKnownBalanceSlot.toNumber()).gte(txSlot - 1);
  //     expect(postState.treasuryAccount!.lastKnownBalanceSlot.toNumber()).lte(txSlot);

  //     expect(postState.treasuryAccount!.totalStreams.toNumber()).eq(
  //       preState.treasuryAccount!.totalStreams.subn(1).toNumber(),
  //       "incorrect treasuryAccount.totalStreams after close stream"
  //     );

  //     // expect(postState.treasuryAccount!.lastKnownBalanceBlockTime.toNumber()).gt(
  //     //   preState.treasuryAccount!.lastKnownBalanceBlockTime.toNumber(),
  //     //   "incorrect lastKnownBalanceBlockTime after close stream"
  //     // );

  //     expect(postState.treasuryAccount!.lastKnownBalanceSlot.toNumber()).gt(
  //       preState.treasuryAccount!.lastKnownBalanceSlot.toNumber(),
  //       "incorrect lastKnownBalanceSlot after close stream"
  //     );

  //     // only applies on specific use cases
  //     // expect(postState.treasuryAccount!.allocationAssignedUnits.toNumber()).eq(
  //     //   preState.treasuryAccount!.allocationAssignedUnits
  //     //     .sub(preStateStream.allocationAssignedUnits)
  //     //     .toNumber(),
  //     //   "incorrent tresury allocation assigned after close stream"
  //     // );

  //     // only applies on specific use cases
  //     // expect(postState.treasuryAccount!.allocationReservedUnits.toNumber()).eq(
  //     //   preState.treasuryAccount!.allocationReservedUnits
  //     //     .sub(preStateStream.allocationReservedUnits)
  //     //     .toNumber(),
  //     //   "incorrent treasury allocation reserved after close stream"
  //     // );

  //     // TODO: get beneficiary withdrawable amount
  //     // expect(postState.treasuryAccount.lastKnownBalanceUnits.toNumber()).gt(
  //     //   preState.treasuryAccount.lastKnownBalanceUnits
  //     //     .sub(preStateStream.allocationReservedUnits)
  //     //     .toNumber(),
  //     //   "incorrect lastKnownBalanceSlot after close stream"
  //     // );

  //     // expect(postState.treasuryAccount!.associatedTokenAddress.toBase58()).eq(
  //     //   this.fromTokenClient.publicKey.toBase58(),
  //     //   "incorrent treasury associated token address after close stream"
  //     // ); // it should not change
  //   }

  //   if(!autoCloseTreasury) // TODO: Move out to a new test
  //     assert.isNotNull(postState.treasuryFromAccountInfo, "treasury 'from' was not created");

  //   assert.isNotNull(postState.treasurerAccountInfo, "treasurer was not found");
  //   assert.isNotNull(postState.treasurerFromAccountInfo, "treasurer 'from' was not found");

  //   const postBeneficiaryAccountInfo = await this.connection.getAccountInfo(beneficiary);
  //   expect(postBeneficiaryAccountInfo).to.exist;
  //   const postBeneficiaryLamports = postBeneficiaryAccountInfo!.lamports;

  //   const postTreasurerAccountInfo = await this.connection.getAccountInfo(treasurer);
  //   expect(postTreasurerAccountInfo).to.exist;
  //   const postTreasurerLamports = postTreasurerAccountInfo!.lamports;

  //   const tokenAccountRentExemptLamports = new BN(await this.connection.getMinimumBalanceForRentExemption(SOLANA_TOKEN_ACCOUNT_SIZE_IN_BYTES));
  //   const lamportsPerSignature = new BN(await this.getLamportsPerSignature());
  //   const closeTxFlatFeeLamports = new BN(10_000);

  //   let expectedPostBeneficiaryLamports = new BN(0);

  //   expectedPostBeneficiaryLamports = new BN(preBeneficiaryLamports);

  //   let expectedPostTreasurerLamports = new BN(preTreasurerLamports)
  //     .add(new BN(postStateStream ? 0 : preStreamAccountLamports)) // Treasurer receive Stream rent excempt lamports
  //     .sub(shouldCreateBeneficiaryFromAta ? tokenAccountRentExemptLamports : new BN(0))
  //     .sub(shouldCreateFeesFromAta ? tokenAccountRentExemptLamports : new BN(0))
  //     // .sub(closeTxFlatFeeLamports) TODO: commented out until we decide if we go ahead with sol_fee_payed_by_treasury
  //     ;

  //   console.log();
  //   console.log(`preBeneficiaryLamports:                    ${preBeneficiaryLamports}`);
  //   console.log(`beneficiaryTokenAccountRentExemptLamports: ${tokenAccountRentExemptLamports.toNumber()}`);
  //   console.log(`MSP_CLOSE_FEE_PCT_NUMERATOR:               ${MSP_WITHDRAW_FEE_PCT_NUMERATOR}`);
  //   console.log(`lamportsPerSignature:                      ${lamportsPerSignature.toNumber()}`);
  //   console.log(`expectedPostBeneficiaryLamports:           ${expectedPostBeneficiaryLamports.toNumber()}`);
  //   console.log(`postBeneficiaryLamports:                   ${postBeneficiaryLamports}`);
  //   console.log(`closeTxFlatFeeLamports:                    ${closeTxFlatFeeLamports}`);
  //   console.log(`expectedPostTreasurerLamports:             ${expectedPostTreasurerLamports}`);
  //   console.log(`postTreasurerLamports:                     ${postTreasurerLamports}`);
  //   console.log(`preStreamAccountLamports:                  ${preTreasurerLamports}`);
  //   expect(postBeneficiaryLamports).eq(
  //     expectedPostBeneficiaryLamports.toNumber(),
  //     "incorrect beneficiary lamports after close stream"
  //   );

  //   if (!autoCloseTreasury) // TODO: Move out to a new test
  //   {
  //     expect(postTreasurerLamports).eq(
  //       expectedPostTreasurerLamports.toNumber(),
  //       "incorrect treasurer lamports after close stream"
  //     );
  //   }

  //   // balances
  //   const postBeneficiaryFromBalance = await this.getTokenAccountBalance(beneficiaryFrom);
  //   expect(postBeneficiaryFromBalance).to.exist;
  //   const postBeneficiaryFromAtaAmount = new BN(postBeneficiaryFromBalance!.amount);

  //   if (!autoCloseTreasury) // TODO: Move out to a new test
  //   {
  //     const postTreasuryFromBalance = await this.getTokenAccountBalance(treasuryFrom);
  //     expect(postTreasuryFromBalance).to.exist;
  //     const postTreasuryFromAtaAmount = new BN(postTreasuryFromBalance!.amount);
  //   }

  //   const postFeesFromBalance = await this.getTokenAccountBalance(feesFrom);
  //   expect(postFeesFromBalance).to.exist;
  //   const postFeesFromAtaAmount = new BN(postFeesFromBalance!.amount);

  //   //   const closeFeeAmountBn = amountBn.mul(new BN(MSP_WITHDRAW_FEE_PCT_NUMERATOR)).div(new BN(MSP_FEE_PCT_DENOMINATOR));

  //   //   expect(postBeneficiaryFromAtaAmount.toNumber()).eq(
  //   //     preBeneficiaryFromAtaAmount
  //   //     .add(amountBn)
  //   //     .sub(withdrawFeeAmountBn)
  //   //     .toNumber()
  //   //   );

  //   //   expect(postTreasuryFromAtaAmount.toNumber()).eq(
  //   //     preTreasuryFromAtaAmount
  //   //     .sub(amountBn)
  //   //     .toNumber()
  //   //   );

  //   //   expect(postFeesFromAtaAmount.toNumber()).eq(
  //   //     preFeesFromAtaAmount
  //   //     .add(withdrawFeeAmountBn)
  //   //     .toNumber()
  //   //   );

  //   logEnd(ixName);

  // }

  public async getStream({
    feePayerKeypair,
    stream,
    logRawLogs
  }: {
    feePayerKeypair: Keypair;
    stream: PublicKey;
    logRawLogs?: boolean;
  }): Promise<StreamEvent | null> {
    const ixName = 'GET STREAM';
    logStart(ixName);

    const program = await this.createProgram(feePayerKeypair);

    await logGetStreamTx(program, stream);

    const streamEventResponse = await program.simulate.getStream(LATEST_IDL_FILE_VERSION, {
      accounts: {
        stream: stream
      }
    });

    if (logRawLogs) {
      console.log(streamEventResponse?.raw);
    }

    if (!streamEventResponse?.events) return null;

    if (streamEventResponse.events.length === 0) return null;

    if (!streamEventResponse.events[0].data) return null;

    const event = streamEventResponse.events[0].data;

    const mappedEvent = {
      version: event.version,
      initialized: event.initialized,
      name: String.fromCharCode(...event.name),
      treasurerAddress: event.treasurerAddress,
      rateAmountUnits: event.rateAmountUnits,
      rateIntervalInSeconds: event.rateIntervalInSeconds,
      startUtc: event.startUtc,
      cliffVestAmountUnits: event.cliffVestAmountUnits,
      cliffVestPercent: event.cliffVestPercent,
      beneficiaryAddress: event.beneficiaryAddress,
      beneficiaryAssociatedToken: event.beneficiaryAssociatedToken,
      treasuryAddress: event.treasuryAddress,
      allocationAssignedUnits: event.allocationAssignedUnits,
      allocationReservedUnits: event.allocationReservedUnits,
      totalWithdrawalsUnits: event.totalWithdrawalsUnits,
      lastWithdrawalUnits: event.lastWithdrawalUnits,
      lastWithdrawalSlot: event.lastWithdrawalSlot,
      lastWithdrawalBlockTime: event.lastWithdrawalBlockTime,
      lastManualStopWithdrawableUnitsSnap: event.lastManualStopWithdrawableUnitsSnap,
      lastManualStopSlot: event.lastManualStopSlot,
      lastManualStopBlockTime: event.lastManualStopBlockTime,
      lastManualResumeRemainingAllocationUnitsSnap: event.lastManualResumeRemainingAllocationUnitsSnap,
      lastManualResumeSlot: event.lastManualResumeSlot,
      lastManualResumeBlockTime: event.lastManualResumeBlockTime,
      lastKnownTotalSecondsInPausedStatus: event.lastKnownTotalSecondsInPausedStatus,
      lastAutoStopBlockTime: event.lastAutoStopBlockTime,
      status: event.status as string,
      isManualPause: event.isManualPause,
      cliffUnits: event.cliffUnits,
      currentBlockTime: event.currentBlockTime,
      secondsSinceStart: event.secondsSinceStart,
      estDepletionTime: event.estDepletionTime,
      streamedUnitsPerSecond: event.rateAmountUnits.toNumber() / event.rateIntervalInSeconds.toNumber(),
      fundsLeftInStream: event.fundsLeftInStream,
      fundsSentToBeneficiary: event.fundsSentToBeneficiary,
      withdrawableUnitsWhilePaused: event.withdrawableUnitsWhilePaused,
      nonStopEarningUnits: event.nonStopEarningUnits,
      missedUnitsWhilePaused: event.missedUnitsWhilePaused,
      entitledEarningsUnits: event.entitledEarningsUnits,
      withdrawableUnitsWhileRunning: event.withdrawableUnitsWhileRunning,
      beneficiaryRemainingAllocation: event.beneficiaryRemainingAllocation,
      beneficiaryWithdrawableAmount: event.beneficiaryWithdrawableAmount,
      lastKnownStopBlockTime: event.lastKnownStopBlockTime,
      rawLogs: streamEventResponse?.raw
    } as StreamEvent;

    logEnd(ixName);

    return mappedEvent;
  }

  public async transferStream({
    stream,
    beneficiary,
    beneficiaryKeypair,
    newBeneficiary
  }: {
    stream: PublicKey;
    beneficiary: PublicKey;
    beneficiaryKeypair: Keypair;
    newBeneficiary: PublicKey;
  }) {
    const ixName = 'TRANSFER STREAM';
    logStart(ixName);

    const preStateStream = await this.program.account.stream.fetch(stream);
    assert.isNotNull(preStateStream, 'pre-state stream was not found');

    const preBeneficiaryAccountInfo = await this.connection.getAccountInfo(beneficiaryKeypair.publicKey);
    expect(preBeneficiaryAccountInfo).to.exist;
    const preBeneficiaryLamports = preBeneficiaryAccountInfo!.lamports;

    console.log();
    console.log(`current beneficiary: ${beneficiary}`);
    console.log(`new beneficiary:     ${newBeneficiary}`);

    const txId = await this.program.methods
      .transferStream(LATEST_IDL_FILE_VERSION, newBeneficiary)
      .accounts({
        beneficiary: beneficiary,
        stream: stream,
        feeTreasury: MSP_FEES_PUBKEY,
        systemProgram: SYSTEM_PROGRAM_ID
      })
      .signers([beneficiaryKeypair])
      .rpc();
    logTxUrl(ixName, txId);

    const statusResult = await connection.confirmTransaction(txId, 'confirmed');

    const postBeneficiaryAccountInfo = await this.connection.getAccountInfo(beneficiaryKeypair.publicKey);
    expect(postBeneficiaryAccountInfo).to.exist;
    const postBeneficiaryLamports = postBeneficiaryAccountInfo!.lamports;
    const lamportsPerSignature = new BN(await this.getLamportsPerSignature());
    const transferTxFlatFeeLamports = new BN(10_000);
    const expectedPostBeneficiaryLamports = new BN(preBeneficiaryLamports).sub(transferTxFlatFeeLamports);

    console.log(`preBeneficiaryLamports:          ${preBeneficiaryLamports}`);
    console.log(`lamportsPerSignature:            ${lamportsPerSignature.toNumber()}`);
    console.log(`expectedPostBeneficiaryLamports: ${expectedPostBeneficiaryLamports.toNumber()}`);
    console.log(`postBeneficiaryLamports:         ${postBeneficiaryLamports}`);
    console.log(`transferTxFlatFeeLamports:       ${transferTxFlatFeeLamports}`);

    expect(postBeneficiaryLamports).eq(
      expectedPostBeneficiaryLamports.toNumber(),
      'incorrect beneficiary lamports after close stream'
    );

    const postStateStream = await this.program.account.stream.fetch(stream);
    assert.isNotNull(postStateStream, 'stream was not found');
    expect(postStateStream.beneficiaryAddress.equals(newBeneficiary), 'incorrect beneficiary after transfer stream');

    logEnd(ixName);
  }

  public async pauseStream({
    stream,
    initializer,
    initializerKeypair
  }: {
    stream: PublicKey;
    initializer: PublicKey;
    initializerKeypair: Keypair;
  }) {
    const ixName = 'PAUSE STREAM';
    logStart(ixName);

    const preStreamEventResponse = await this.program.simulate.getStream(LATEST_IDL_FILE_VERSION, {
      accounts: { stream: stream }
    });

    assert.isNotNull(preStreamEventResponse, 'stream was not found before pause');
    assert.isNotNull(preStreamEventResponse.events, 'stream was not found before pause');
    assert.isNotNull(preStreamEventResponse.events.length, 'stream was not found before pause');
    assert.isNotNull(preStreamEventResponse.events[0].data, 'stream was not found before pause');

    const preStateStream = preStreamEventResponse.events[0].data;
    assert.isNotNull(preStateStream, 'pre-state stream was not found');

    const txId = await this.program.methods
      .pauseStream(LATEST_IDL_FILE_VERSION)
      .accounts({
        initializer: initializer,
        treasury: preStateStream.treasuryAddress,
        associatedToken: preStateStream.beneficiaryAssociatedToken,
        stream: stream
      })
      .signers([initializerKeypair])
      .rpc();
    logTxUrl(ixName, txId);

    const statusResult = await connection.confirmTransaction(txId, 'confirmed');

    const postStreamEventResponse = await this.program.simulate.getStream(LATEST_IDL_FILE_VERSION, {
      accounts: { stream: stream }
    });

    assert.isNotNull(postStreamEventResponse, 'stream was not found after pause');
    assert.isNotNull(postStreamEventResponse.events, 'stream was not found after pause');
    assert.isNotNull(postStreamEventResponse.events.length, 'stream was not found after pause');
    assert.isNotNull(postStreamEventResponse.events[0].data, 'stream was not found after pause');

    const postStateStream = postStreamEventResponse.events[0].data;
    assert.isNotNull(preStateStream, 'post-state stream was not found');

    expect(
      postStateStream.treasurerAddress.equals(preStateStream.treasurerAddress),
      'incorrect treasurer address after pause stream'
    );

    expect(
      postStateStream.beneficiaryAddress.equals(preStateStream.beneficiaryAddress),
      'incorrect beneficiary address after pause stream'
    );

    expect(
      postStateStream.treasuryAddress.equals(preStateStream.treasuryAddress),
      'incorrect treasurer address after pause stream'
    );

    expect(
      postStateStream.beneficiaryAssociatedToken.equals(preStateStream.beneficiaryAssociatedToken),
      'incorrect treasurer address after pause stream'
    );

    // FIX FORMAT FIRST IF YOU NEED TO UNCOMMENT THIS
    // console.log('pre status', preStateStream.status);
    // console.log('post status', postStateStream.status);
    // console.log('pre allocation assigned', preStateStream.allocationAssignedUnits.toNumber());
    // console.log('post allocation assigned', postStateStream.allocationAssignedUnits.toNumber());
    // console.log('pre allocation reserved', preStateStream.allocationAssignedUnits.toNumber());
    // console.log('post allocation reserved', postStateStream.allocationAssignedUnits.toNumber());
    // console.log('pre remaining allocation', preStateStream.beneficiaryRemainingAllocation.toNumber());
    // console.log('post remaining allocation', postStateStream.beneficiaryRemainingAllocation.toNumber());
    // console.log('pre withdrawal amount', preStateStream.beneficiaryWithdrawableAmount.toNumber());
    // console.log('post withdrawal amount', postStateStream.beneficiaryWithdrawableAmount.toNumber());
    // console.log('pre funds left in stream', preStateStream.fundsLeftInStream.toNumber());
    // console.log('post funds left in stream', postStateStream.fundsLeftInStream.toNumber());
    // console.log('pre funds sent to beneficiary', preStateStream.fundsSentToBeneficiary.toNumber());
    // console.log('post funds sent to beneficiary', postStateStream.fundsSentToBeneficiary.toNumber());

    expect(preStateStream.status === 'Running', 'incorrect stream status before pause');
    expect(postStateStream.status === 'Paused', 'incorrect stream status after pause');
    expect(
      preStateStream.allocationAssignedUnits.eq(postStateStream.allocationAssignedUnits),
      'incorrect allocation assigned after pause'
    );

    expect(
      preStateStream.allocationReservedUnits.eq(postStateStream.allocationReservedUnits),
      'incorrect allocation reserved after pause'
    );

    expect(
      preStateStream.beneficiaryRemainingAllocation.eq(postStateStream.beneficiaryRemainingAllocation),
      'incorrect remaining after pause'
    );

    expect(
      preStateStream.fundsLeftInStream.eq(postStateStream.fundsLeftInStream),
      'incorrect fund left in stream after pause'
    );

    expect(
      preStateStream.fundsSentToBeneficiary.eq(postStateStream.fundsSentToBeneficiary),
      'incorrect funds sent to beneficiary after pause'
    );

    expect(postStateStream.lastManualStopSlot.gte(preStateStream.lastManualResumeSlot), 'incorrect manual stop slot');

    expect(
      postStateStream.lastManualStopBlockTime.gt(preStateStream.lastManualResumeBlockTime),
      'incorrect manual stop block time'
    );

    if (postStateStream.isManualPause) {
      expect(
        postStateStream.lastManualStopWithdrawableUnitsSnap.gt(new BN(0)),
        'incorrect manual stop withdrawable units snap'
      );
    } else {
      expect(
        postStateStream.lastManualStopWithdrawableUnitsSnap.gte(new BN(0)),
        'incorrect manual stop withdrawable units snap'
      );
    }

    expect(
      preStateStream.beneficiaryWithdrawableAmount.gte(postStateStream.beneficiaryWithdrawableAmount),
      'incorrect withdrawable amount after pause'
    );

    expect(
      preStateStream.beneficiaryWithdrawableAmount.gt(new BN(0)),
      'incorrect withdrawable amount after pause (zero amount)'
    );

    const secondsSinceStart = postStateStream.secondsSinceStart.toNumber();
    const withdrawableAmountWithoutPause = preStateStream.rateAmountUnits.toNumber() * secondsSinceStart;

    expect(
      postStateStream.beneficiaryWithdrawableAmount.gte(new BN(withdrawableAmountWithoutPause)),
      'incorrect withdrawable amount after running ' + secondsSinceStart + ' seconds and then pause'
    );

    logEnd(ixName);
  }

  public async resumeStream({
    stream,
    initializer,
    initializerKeypair
  }: {
    stream: PublicKey;
    initializer: PublicKey;
    initializerKeypair: Keypair;
  }) {
    const ixName = 'RESUME STREAM';
    logStart(ixName);

    const preStreamEventResponse = await this.program.simulate.getStream(LATEST_IDL_FILE_VERSION, {
      accounts: { stream: stream }
    });

    assert.isNotNull(preStreamEventResponse, 'stream was not found before resume');
    assert.isNotNull(preStreamEventResponse.events, 'stream was not found before resume');
    assert.isNotNull(preStreamEventResponse.events.length, 'stream was not found before resume');
    assert.isNotNull(preStreamEventResponse.events[0].data, 'stream was not found before resume');

    const preStateStream = preStreamEventResponse.events[0].data;
    assert.isNotNull(preStateStream, 'pre-state stream was not found');

    const txId = await this.program.methods
      .resumeStream(LATEST_IDL_FILE_VERSION)
      .accounts({
        initializer: initializer,
        treasury: preStateStream.treasuryAddress,
        associatedToken: preStateStream.beneficiaryAssociatedToken,
        stream: stream
      })
      .signers([initializerKeypair])
      .rpc();
    logTxUrl(ixName, txId);

    const statusResult = await connection.confirmTransaction(txId, 'confirmed');

    const postStreamEventResponse = await this.program.simulate.getStream(LATEST_IDL_FILE_VERSION, {
      accounts: { stream: stream }
    });

    assert.isNotNull(postStreamEventResponse, 'stream was not found after resume');
    assert.isNotNull(postStreamEventResponse.events, 'stream was not found after resume');
    assert.isNotNull(postStreamEventResponse.events.length, 'stream was not found after resume');
    assert.isNotNull(postStreamEventResponse.events[0].data, 'stream was not found after resume');

    const postStateStream = postStreamEventResponse.events[0].data;
    assert.isNotNull(preStateStream, 'post-state stream was not found');

    expect(
      postStateStream.treasurerAddress.equals(preStateStream.treasurerAddress),
      'incorrect treasurer address after resume stream'
    );

    expect(
      postStateStream.beneficiaryAddress.equals(preStateStream.beneficiaryAddress),
      'incorrect beneficiary address after resume stream'
    );

    expect(
      postStateStream.treasuryAddress.equals(preStateStream.treasuryAddress),
      'incorrect treasurer address after resume stream'
    );

    expect(
      postStateStream.beneficiaryAssociatedToken.equals(preStateStream.beneficiaryAssociatedToken),
      'incorrect treasurer address after resume stream'
    );

    expect(preStateStream.status === 'Paused', 'incorrect stream status before resume');
    expect(postStateStream.status === 'Running', 'incorrect stream status after resume');
    expect(
      preStateStream.allocationAssignedUnits.eq(postStateStream.allocationAssignedUnits),
      'incorrect allocation assigned after resume'
    );

    expect(
      preStateStream.allocationReservedUnits.eq(postStateStream.allocationReservedUnits),
      'incorrect allocation reserved after resume'
    );

    expect(
      preStateStream.beneficiaryRemainingAllocation.eq(postStateStream.beneficiaryRemainingAllocation),
      'incorrect remaining after resume'
    );

    expect(
      preStateStream.fundsLeftInStream.eq(postStateStream.fundsLeftInStream),
      'incorrect fund left in stream after resume'
    );

    expect(
      preStateStream.fundsSentToBeneficiary.eq(postStateStream.fundsSentToBeneficiary),
      'incorrect funds sent to beneficiary after resume'
    );

    expect(postStateStream.lastManualResumeSlot.gte(preStateStream.lastManualStopSlot), 'incorrect manual stop slot');

    expect(
      postStateStream.lastManualResumeBlockTime.gt(preStateStream.lastManualStopBlockTime),
      'incorrect manual stop block time'
    );

    expect(
      postStateStream.beneficiaryWithdrawableAmount.gte(preStateStream.beneficiaryWithdrawableAmount),
      'incorrect withdrawable amount after resume'
    );

    expect(
      postStateStream.beneficiaryWithdrawableAmount.gt(new BN(0)),
      'incorrect withdrawable amount after resume (zero amount)'
    );

    expect(
      postStateStream.beneficiaryWithdrawableAmount.lte(postStateStream.beneficiaryRemainingAllocation),
      'incorrect withdrawable amount after resume (greater than remaining allocation)'
    );

    logEnd(ixName);
  }

  public async refreshTreasuryData({
    totalStreams,
    treasury,
    treasuryFrom,
    treasurer,
    treasurerFrom,
    signers
  }: {
    totalStreams: number;
    treasurer?: PublicKey;
    treasurerFrom?: PublicKey;
    treasury?: PublicKey;
    treasuryFrom?: PublicKey;
    signers?: Keypair[];
  }) {
    const ixName = 'REFRESH TREASURY DATA';
    logStart(ixName);

    treasurer = treasurer ?? this.treasurerKeypair.publicKey;
    treasurerFrom = treasurerFrom ?? this.treasurerFrom;
    treasury = treasury ?? this.treasury;
    treasuryFrom = treasuryFrom ?? this.treasuryFrom;
    signers = signers ?? [this.treasurerKeypair];

    const txId = await this.program.methods
      .refreshTreasuryData(LATEST_IDL_FILE_VERSION, new BN(totalStreams))
      .accounts({
        treasurer: treasurer,
        associatedToken: this.fromMint,
        treasury: treasury,
        treasuryToken: treasuryFrom
      })
      .signers(signers)
      .rpc();
    logTxUrl(ixName, txId);

    logEnd(ixName);
  }

  // SPLITTING INSTRUCTIONS

  public async addFunds({
    amount,
    contributorKeypair,
    contributorTokenAccount,
    contributorLpTokenAccount
  }: {
    amount: number;
    contributorKeypair?: Keypair;
    contributorTokenAccount?: PublicKey;
    contributorLpTokenAccount?: PublicKey;
  }) {
    const ixName = 'FUND TREASURY';
    logStart(ixName);

    contributorKeypair = contributorKeypair ?? this.treasurerKeypair;
    contributorTokenAccount = contributorTokenAccount ?? this.treasurerFrom;
    if (!contributorLpTokenAccount) {
      contributorLpTokenAccount = await this.findTreasuryLpTokenAccountAddress(contributorKeypair.publicKey);
    }

    const preState = await this.getMspWorldState();

    const preContributorAccountInfo = await this.connection.getAccountInfo(contributorKeypair.publicKey);
    expect(preContributorAccountInfo).to.exist;

    const treasuryFromAtaBalanceResult = await this.getTokenAccountBalance(this.treasuryFrom);
    const preTreasuryFromAtaAmount = new BN(treasuryFromAtaBalanceResult?.amount ?? 0);

    assert.isNotNull(preState.treasuryAccount, 'pre-treasuryAccount was not found');
    assert.isNotNull(preState.treasuryAccountInfo, 'pre-treasuryAccountInfo was not found');
    assert.isNotNull(preState.treasurerAccountInfo, 'pre-treasurerAccountInfo was not found');

    const amountBn = new BN(amount);

    console.log();
    console.log(`contributor:            ${contributorKeypair.publicKey}`);
    console.log(`contributorToken:       ${contributorTokenAccount}`);
    console.log(`treasury:               ${this.treasury}`);
    console.log(`treasuryAssociatedMint: ${this.fromMint}`);

    const txId = await this.program.methods
      .addFunds(LATEST_IDL_FILE_VERSION, amountBn)
      .accounts({
        payer: contributorKeypair.publicKey,
        contributor: contributorKeypair.publicKey,
        contributorToken: contributorTokenAccount,
        contributorTreasuryToken: contributorLpTokenAccount,
        treasury: this.treasury,
        treasuryToken: this.treasuryFrom,
        associatedToken: this.fromMint,
        treasuryMint: this.treasuryLpMint,
        feeTreasury: MSP_FEES_PUBKEY,
        feeTreasuryToken: this.feesFrom,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SYSTEM_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY
      })
      .signers([contributorKeypair])
      .rpc();
    logTxUrl(ixName, txId);

    const postContributorAccountInfo = await this.connection.getAccountInfo(contributorKeypair.publicKey);
    expect(postContributorAccountInfo).to.exist;

    const postState = await this.getMspWorldState();

    // treasury balance units and assigned units
    expect(postState.treasuryAccount!.lastKnownBalanceUnits.toNumber()).eq(
      preState.treasuryAccount!.lastKnownBalanceUnits.add(amountBn).toNumber()
    );
    expect(postState.treasuryAccount!.allocationAssignedUnits.toNumber()).eq(
      preState.treasuryAccount!.allocationAssignedUnits.toNumber()
    );

    expect(postState.treasuryAccount!.associatedTokenAddress.toBase58()).eq(this.fromTokenClient.publicKey.toBase58()); // it should be set by now

    // treasury ATA blance
    const postTreasuryFromBalance = await this.getTokenAccountBalance(this.treasuryFrom);
    expect(postTreasuryFromBalance).to.exist;
    const postTreasuryFromAtaAmount = new BN(postTreasuryFromBalance!.amount);
    expect(postTreasuryFromAtaAmount.toNumber()).eq(preTreasuryFromAtaAmount.add(amountBn).toNumber());

    // MSP fees ATA balance
    const postFeeFromBalance = await this.getTokenAccountBalance(this.feesFrom);
    expect(postFeeFromBalance).to.exist;

    logEnd(ixName);
  }

  public async allocate({ amount, stream }: { amount: number; stream: PublicKey }) {
    const ixName = 'ALLOCATE';
    logStart(ixName);

    const treasurerLpTokenAccount = await this.findTreasuryLpTokenAccountAddress(this.treasurerKeypair.publicKey);

    const preState = await this.getMspWorldState();

    // const preContributorAccountInfo = await this.connection.getAccountInfo(this.treasurerKeypair.publicKey);
    // expect(preContributorAccountInfo).to.exist;
    // const preContributorLamports = preContributorAccountInfo!.lamports;

    // const shouldCreateTreasuryFromAta = !preState.treasuryFromAccountInfo;
    // const treasuryFromAtaBalanceResult = await this.getTokenAccountBalance(this.treasuryFrom);
    // const preTreasuryFromAtaAmount = new BN(treasuryFromAtaBalanceResult?.amount ?? 0);

    // const contributorTreasuryMintAtaBalanceResult = await this.getTokenAccountBalance(treasurerLpTokenAccount);
    // const shouldCreateContributorTreasuryMintAta = !contributorTreasuryMintAtaBalanceResult;
    // const preContributorTreasuryMintAtaAmount = new BN(contributorTreasuryMintAtaBalanceResult?.amount ?? 0);

    // const shouldCreateFeesATA = !preState.feesFromAccountInfo;
    // const feesFromAtaBalanceResult = await this.getTokenAccountBalance(this.feesFrom);
    // const preFeesFromAtaAmount = new BN(feesFromAtaBalanceResult?.amount ?? 0);

    // assert.isNotNull(preState.treasuryAccount, "pre-treasuryAccount was not found");
    // assert.isNotNull(preState.treasuryAccountInfo, "pre-treasuryAccountInfo was not found");
    // assert.isNotNull(preState.treasurerAccountInfo, "pre-treasurerAccountInfo was not found");

    const amountBn = new BN(amount);
    // let feeAmount = new BN(0);
    // let preStream = !stream ? undefined : await this.getStream(contributorKeypair, stream as PublicKey);

    // if (allocationType === StreamAllocationType.AssignToSpecificStream && preStream) {
    //   feeAmount = new BN(MSP_WITHDRAW_FEE_PCT_NUMERATOR)
    //     .mul(amountBn)
    //     .div(new BN(100))
    //     .div(new BN(MSP_FEE_PCT_DENOMINATOR));
    // }

    console.log();
    console.log(`treasurer:              ${this.treasurerKeypair.publicKey}`);
    console.log(`treasurerFrom:          ${this.treasuryFrom}`);
    console.log(`treasury:               ${this.treasury}`);
    console.log(`treasuryAssociatedMint: ${this.fromMint}`);

    const txId = await this.program.methods
      .allocate(LATEST_IDL_FILE_VERSION, amountBn)
      .accounts({
        payer: this.treasurerKeypair.publicKey,
        treasurer: this.treasurerKeypair.publicKey,
        treasury: this.treasury,
        treasuryToken: this.treasuryFrom,
        associatedToken: this.fromMint,
        stream: stream,
        feeTreasury: MSP_FEES_PUBKEY,
        feeTreasuryToken: this.feesFrom,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SYSTEM_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY
      })
      .signers([this.treasurerKeypair])
      .rpc();
    logTxUrl(ixName, txId);

    // const postContributorAccountInfo = await this.connection.getAccountInfo(this.treasurerKeypair.publicKey);
    // expect(postContributorAccountInfo).to.exist;

    // const postState = await this.getMspWorldState();

    // // treasury balance units and assigned units
    // expect(postState.treasuryAccount!.lastKnownBalanceUnits.toNumber()).eq(
    //   preState.treasuryAccount!.lastKnownBalanceUnits
    //     .add(amountBn)
    //     .toNumber()
    // );
    // expect(postState.treasuryAccount!.allocationAssignedUnits.toNumber())
    //   .eq(preState.treasuryAccount!.allocationAssignedUnits.toNumber());

    // expect(postState.treasuryAccount!.associatedTokenAddress.toBase58()).eq(this.fromTokenClient.publicKey.toBase58()); // it should be set by now

    // // treasury ATA blance
    // const postTreasuryFromBalance = await this.getTokenAccountBalance(this.treasuryFrom);
    // expect(postTreasuryFromBalance).to.exist;
    // const postTreasuryFromAtaAmount = new BN(postTreasuryFromBalance!.amount);
    // expect(postTreasuryFromAtaAmount.toNumber()).eq(
    //   preTreasuryFromAtaAmount
    //     .add(amountBn)
    //     .toNumber()
    // );

    // // contributor treasury pool ATA blance
    // const postContributorTreasuryMintAta = await this.getTokenAccountBalance(treasurerLpTokenAccount);
    // expect(postContributorTreasuryMintAta).to.exist;
    // const postContributorTreasuryMintAtaAmount = new BN(postContributorTreasuryMintAta!.amount);
    // expect(postContributorTreasuryMintAtaAmount.toNumber()).eq(
    //   preContributorTreasuryMintAtaAmount
    //     .add(amountBn)
    //     .toNumber()
    // );

    // // MSP fees ATA balance
    // const postFeeFromBalance = await this.getTokenAccountBalance(this.feesFrom);
    // expect(postFeeFromBalance).to.exist;
    // const postFeeFromAtaAmount = new BN(postFeeFromBalance!.amount);
    // // TODO

    logEnd(ixName);
  }

  public async closeTreasury({
    treasurerSigner,
    treasury,
    treasuryFrom,
    treasurerFrom,
    treasurerTreasuryLp,
    treasurer,
    destinationAuthority,
    destinationTokenAccount
  }: {
    treasurerSigner?: Keypair;
    treasurer?: PublicKey;
    treasurerFrom?: PublicKey;
    treasurerTreasuryLp?: PublicKey;
    treasury?: PublicKey;
    treasuryFrom?: PublicKey;
    destinationAuthority?: PublicKey;
    destinationTokenAccount?: PublicKey;
  }) {
    const ixName = 'CLOSE TREASURY';
    logStart(ixName);

    treasurerSigner = treasurerSigner ?? this.treasurerKeypair;
    treasurer = treasurer ?? this.treasurerKeypair.publicKey;
    treasurerFrom = treasurerFrom ?? this.treasurerFrom;
    treasurerTreasuryLp = treasurerTreasuryLp ?? (await this.findTreasuryLpTokenAccountAddress(treasurer));
    treasury = treasury ?? this.treasury;
    treasuryFrom = treasuryFrom ?? this.treasuryFrom;
    // signers ?? [treasurerSigner];
    destinationAuthority = destinationAuthority ?? treasurer;
    destinationTokenAccount = destinationTokenAccount ?? treasurerFrom;

    const clusterNowTs = await this.program.provider.connection.getBlockTime(this.slot.toNumber());
    const treasurerSignerProgram = await this.createProgram(treasurerSigner);

    // const preState = await this.getMspWorldState();
    // assert.isNotNull(preState.treasuryAccount, "pre-treasuryAccount was not found");
    // assert.isNotNull(preState.treasuryAccountInfo, "pre-treasuryAccountInfo was not found");
    // assert.isNotNull(preState.treasurerAccountInfo, "pre-treasurerAccountInfo was not found");

    const preTreasurerAccountInfo = await this.connection.getAccountInfo(this.treasurerKeypair.publicKey);
    const preTreasurerLamports = preTreasurerAccountInfo!.lamports;

    const txId = await treasurerSignerProgram.methods
      .closeTreasury(LATEST_IDL_FILE_VERSION)
      .accounts({
        payer: treasurer,
        treasurer: treasurer,
        treasurerTreasuryToken: treasurerTreasuryLp,
        destinationAuthority: destinationAuthority,
        destinationTokenAccount: destinationTokenAccount,
        associatedToken: this.fromMint,
        treasury: treasury,
        treasuryToken: treasuryFrom,
        treasuryMint: this.treasuryLpMint,
        feeTreasury: MSP_FEES_PUBKEY,
        feeTreasuryToken: this.feesFrom,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SYSTEM_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY
      })
      .rpc();
    logTxUrl(ixName, txId);

    // const postState = await this.getMspWorldState();

    const treasuryAccountInfo = await this.connection.getAccountInfo(treasury);
    const treasuryFromAccountInfo = await this.connection.getAccountInfo(treasuryFrom);
    // const treasuryLpMintAccountInfo = await this.connection.getAccountInfo(this.treasuryLpMint); // not needed as mints cannot be close

    console.log('treasuryFromAccountInfo', treasuryFromAccountInfo);
    assert.isNull(treasuryAccountInfo, "treasury still exists after 'close tresury'");
    assert.isNull(treasuryFromAccountInfo, "treasuryFrom still exists after 'close tresury'");

    logEnd(ixName);
  }

  public async closeStream({
    beneficiary,
    beneficiaryFrom,
    stream,
    treasurer,
    treasurerFrom,
    treasury,
    treasuryFrom,
    fees,
    feesFrom,
    signers
  }: {
    beneficiary: PublicKey;
    beneficiaryFrom: PublicKey;
    stream: PublicKey;
    treasurer?: PublicKey;
    treasurerFrom?: PublicKey;
    treasury?: PublicKey;
    treasuryFrom?: PublicKey;
    fees?: PublicKey;
    feesFrom?: PublicKey;
    signers?: Keypair[];
  }) {
    const ixName = 'CLOSE STREAM';
    logStart(ixName);

    const preState = await this.getMspWorldState();
    const preStateStream = await this.program.account.stream.fetch(stream);
    assert.isNotNull(preStateStream, 'pre-state stream was not found');

    treasurer = treasurer ?? this.treasurerKeypair.publicKey;
    treasurerFrom = treasurerFrom ?? this.treasurerFrom;

    treasury = treasury ?? this.treasury;
    treasuryFrom = treasuryFrom ?? this.treasuryFrom;

    fees = fees ?? MSP_FEES_PUBKEY;
    feesFrom = feesFrom ?? this.feesFrom;

    signers = signers ?? [this.treasurerKeypair];

    const preBeneficiaryAccountInfo = await this.connection.getAccountInfo(beneficiary);
    expect(preBeneficiaryAccountInfo).to.exist;
    const preBeneficiaryLamports = preBeneficiaryAccountInfo!.lamports;

    const preTreasurerAccountInfo = await this.connection.getAccountInfo(treasurer);
    expect(preTreasurerAccountInfo).to.exist;
    const preTreasurerLamports = preTreasurerAccountInfo!.lamports;

    const beneficiaryFromAtaBalanceResult = await this.getTokenAccountBalance(beneficiaryFrom);
    const shouldCreateBeneficiaryFromAta = !beneficiaryFromAtaBalanceResult;
    const preBeneficiaryFromAtaAmount = new BN(beneficiaryFromAtaBalanceResult?.amount ?? 0);

    const preStreamAccountInfo = await this.program.account.stream.getAccountInfo(stream);
    expect(preStreamAccountInfo).to.exist;
    const preStreamAccountLamports = preStreamAccountInfo!.lamports;

    const feesFromAtaBalanceResult = await this.getTokenAccountBalance(feesFrom);
    const shouldCreateFeesFromAta = !feesFromAtaBalanceResult;
    const preFeesFromAtaAmount = new BN(feesFromAtaBalanceResult?.amount ?? 0);

    assert.isNotNull(preState.treasuryAccount, 'pre-treasuryAccount was not found');
    assert.isNotNull(preState.treasuryAccountInfo, 'pre-treasuryAccountInfo was not found');
    assert.isNotNull(preState.treasurerAccountInfo, 'pre-treasurerAccountInfo was not found');

    const treasurerTreasuryMintTokenAccount = await this.findTreasuryLpTokenAccountAddress(treasurer);

    const txId = await this.program.methods
      .closeStream(LATEST_IDL_FILE_VERSION)
      .accounts({
        payer: treasurer,
        treasurer: treasurer,
        beneficiary: beneficiary,
        beneficiaryToken: beneficiaryFrom,
        associatedToken: this.fromMint,
        treasury: treasury,
        treasuryToken: treasuryFrom,
        stream: stream,
        feeTreasury: fees,
        feeTreasuryToken: feesFrom,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SYSTEM_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY
      })
      .signers(signers)
      .rpc();
    logTxUrl(ixName, txId);

    const statusResult = await connection.confirmTransaction(txId, 'confirmed');

    const txSlot = statusResult.context.slot;
    const txTs = await this.connection.getBlockTime(txSlot);
    expect(txTs).to.exist;

    const postState = await this.getMspWorldState();
    const postStateStream = await this.program.account.stream.fetchNullable(stream);
    assert.isNull(postStateStream, 'stream was not closed');

    assert.isNotNull(postState.treasuryAccountInfo, 'treasury was not found');
    assert.isNotNull(postState.treasuryFromAccountInfo, 'treasury token was not found');
    expect(postState.treasuryAccount!.lastKnownBalanceBlockTime.toNumber()).gte(txTs! - 1);
    expect(postState.treasuryAccount!.lastKnownBalanceBlockTime.toNumber()).lte(txTs!);
    expect(postState.treasuryAccount!.lastKnownBalanceSlot.toNumber()).gte(txSlot - 1);
    expect(postState.treasuryAccount!.lastKnownBalanceSlot.toNumber()).lte(txSlot);

    expect(postState.treasuryAccount!.totalStreams.toNumber()).eq(
      preState.treasuryAccount!.totalStreams.subn(1).toNumber(),
      'incorrect treasuryAccount.totalStreams after close stream'
    );

    // expect(postState.treasuryAccount!.lastKnownBalanceBlockTime.toNumber()).gt(
    //   preState.treasuryAccount!.lastKnownBalanceBlockTime.toNumber(),
    //   "incorrect lastKnownBalanceBlockTime after close stream"
    // );

    expect(postState.treasuryAccount!.lastKnownBalanceSlot.toNumber()).gt(
      preState.treasuryAccount!.lastKnownBalanceSlot.toNumber(),
      'incorrect lastKnownBalanceSlot after close stream'
    );

    // only applies on specific use cases
    // expect(postState.treasuryAccount!.allocationAssignedUnits.toNumber()).eq(
    //   preState.treasuryAccount!.allocationAssignedUnits
    //     .sub(preStateStream.allocationAssignedUnits)
    //     .toNumber(),
    //   "incorrent tresury allocation assigned after close stream"
    // );

    // only applies on specific use cases
    // expect(postState.treasuryAccount!.allocationReservedUnits.toNumber()).eq(
    //   preState.treasuryAccount!.allocationReservedUnits
    //     .sub(preStateStream.allocationReservedUnits)
    //     .toNumber(),
    //   "incorrent treasury allocation reserved after close stream"
    // );

    // TODO: get beneficiary withdrawable amount
    // expect(postState.treasuryAccount.lastKnownBalanceUnits.toNumber()).gt(
    //   preState.treasuryAccount.lastKnownBalanceUnits
    //     .sub(preStateStream.allocationReservedUnits)
    //     .toNumber(),
    //   "incorrect lastKnownBalanceSlot after close stream"
    // );

    // expect(postState.treasuryAccount!.associatedTokenAddress.toBase58()).eq(
    //   this.fromTokenClient.publicKey.toBase58(),
    //   "incorrent treasury associated token address after close stream"
    // ); // it should not change

    assert.isNotNull(postState.treasuryFromAccountInfo, "treasury 'from' was not found");

    assert.isNotNull(postState.treasurerAccountInfo, 'treasurer was not found');
    assert.isNotNull(postState.treasurerFromAccountInfo, "treasurer 'from' was not found");

    const postBeneficiaryAccountInfo = await this.connection.getAccountInfo(beneficiary);
    expect(postBeneficiaryAccountInfo).to.exist;
    const postBeneficiaryLamports = postBeneficiaryAccountInfo!.lamports;

    const postTreasurerAccountInfo = await this.connection.getAccountInfo(treasurer);
    expect(postTreasurerAccountInfo).to.exist;
    const postTreasurerLamports = postTreasurerAccountInfo!.lamports;

    const tokenAccountRentExemptLamports = new BN(
      await this.connection.getMinimumBalanceForRentExemption(SOLANA_TOKEN_ACCOUNT_SIZE_IN_BYTES)
    );
    const lamportsPerSignature = new BN(await this.getLamportsPerSignature());
    const closeTxFlatFeeLamports = new BN(10_000);

    let expectedPostBeneficiaryLamports = new BN(0);

    expectedPostBeneficiaryLamports = new BN(preBeneficiaryLamports);

    const expectedPostTreasurerLamports = new BN(preTreasurerLamports)
      .add(new BN(postStateStream ? 0 : preStreamAccountLamports)) // Treasurer receive Stream rent excempt lamports
      .sub(shouldCreateBeneficiaryFromAta ? tokenAccountRentExemptLamports : new BN(0))
      .sub(shouldCreateFeesFromAta ? tokenAccountRentExemptLamports : new BN(0))
      .sub(closeTxFlatFeeLamports);
    console.log();
    console.log(`preBeneficiaryLamports:                    ${preBeneficiaryLamports}`);
    console.log(`beneficiaryTokenAccountRentExemptLamports: ${tokenAccountRentExemptLamports.toNumber()}`);
    console.log(`MSP_CLOSE_FEE_PCT_NUMERATOR:               ${MSP_WITHDRAW_FEE_PCT_NUMERATOR}`);
    console.log(`lamportsPerSignature:                      ${lamportsPerSignature.toNumber()}`);
    console.log(`expectedPostBeneficiaryLamports:           ${expectedPostBeneficiaryLamports.toNumber()}`);
    console.log(`postBeneficiaryLamports:                   ${postBeneficiaryLamports}`);
    console.log(`closeTxFlatFeeLamports:                    ${closeTxFlatFeeLamports}`);
    console.log(`expectedPostTreasurerLamports:             ${expectedPostTreasurerLamports}`);
    console.log(`postTreasurerLamports:                     ${postTreasurerLamports}`);
    console.log(`preStreamAccountLamports:                  ${preTreasurerLamports}`);
    expect(postBeneficiaryLamports).eq(
      expectedPostBeneficiaryLamports.toNumber(),
      'incorrect beneficiary lamports after close stream'
    );

    expect(postTreasurerLamports).eq(
      expectedPostTreasurerLamports.toNumber(),
      'incorrect treasurer lamports after close stream'
    );

    // balances
    const postBeneficiaryFromBalance = await this.getTokenAccountBalance(beneficiaryFrom);
    expect(postBeneficiaryFromBalance).to.exist;
    const postBeneficiaryFromAtaAmount = new BN(postBeneficiaryFromBalance!.amount);

    const postTreasuryFromBalance = await this.getTokenAccountBalance(treasuryFrom);
    expect(postTreasuryFromBalance).to.exist;
    const postTreasuryFromAtaAmount = new BN(postTreasuryFromBalance!.amount);

    const postFeesFromBalance = await this.getTokenAccountBalance(feesFrom);
    expect(postFeesFromBalance).to.exist;
    const postFeesFromAtaAmount = new BN(postFeesFromBalance!.amount);

    //   const closeFeeAmountBn = amountBn.mul(new BN(MSP_WITHDRAW_FEE_PCT_NUMERATOR)).div(new BN(MSP_FEE_PCT_DENOMINATOR));

    //   expect(postBeneficiaryFromAtaAmount.toNumber()).eq(
    //     preBeneficiaryFromAtaAmount
    //     .add(amountBn)
    //     .sub(withdrawFeeAmountBn)
    //     .toNumber()
    //   );

    //   expect(postTreasuryFromAtaAmount.toNumber()).eq(
    //     preTreasuryFromAtaAmount
    //     .sub(amountBn)
    //     .toNumber()
    //   );

    //   expect(postFeesFromAtaAmount.toNumber()).eq(
    //     preFeesFromAtaAmount
    //     .add(withdrawFeeAmountBn)
    //     .toNumber()
    //   );

    logEnd(ixName);
  }

  // UPDATE TREASURY DATA
  public async updateTreasuryData(
    totalAllocationAssigned: number,
    totalWithdrawalsUnits: number,
    numberOfStreams: number,
    payer?: PublicKey,
    treasury?: PublicKey,
    treasuryFrom?: PublicKey,
    signers?: Keypair[]
  ) {
    const ixName = 'REFRESH TREASURY DATA';
    logStart(ixName);

    payer = payer ?? this.payer.publicKey;
    treasury = treasury ?? this.treasury;
    treasuryFrom = treasuryFrom ?? this.treasuryFrom;
    signers = signers ?? [this.payer];

    const txId = await this.program.methods.updateTreasuryData(
      LATEST_IDL_FILE_VERSION,
      new BN(totalAllocationAssigned),
      new BN(totalWithdrawalsUnits),
      new BN(numberOfStreams),
      {
        accounts: {
          authority: payer,
          associatedToken: this.fromMint,
          treasury: treasury,
          treasuryToken: treasuryFrom
        },
        signers: signers
      }
    );
    logTxUrl(ixName, txId);

    logEnd(ixName);
  }

  public async treasuryWithdraw({
    amount,
    destinationAuthority,
    destinationTokenAccount,
    signers,
    treasurer,
    treasuryFrom,
    treasury,
    treasurerFrom
  }: {
    amount: number;
    destinationAuthority: PublicKey;
    destinationTokenAccount: PublicKey;
    signers?: Keypair[];
    treasurer?: PublicKey;
    treasurerFrom?: PublicKey;
    treasury?: PublicKey;
    treasuryFrom?: PublicKey;
  }) {
    const ixName = 'TREASURY WITHDRAW';
    logStart(ixName);

    signers = signers ?? [this.treasurerKeypair];
    treasurer = treasurer ?? this.treasurerKeypair.publicKey;
    treasurerFrom = treasurerFrom ?? this.treasurerFrom;
    treasury = treasury ?? this.treasury;
    treasuryFrom = treasuryFrom ?? this.treasuryFrom;

    const txId = await this.program.methods
      .treasuryWithdraw(LATEST_IDL_FILE_VERSION, new BN(amount))
      .accounts({
        payer: treasurer,
        treasurer: treasurer,
        destinationAuthority: destinationAuthority,
        destinationTokenAccount: destinationTokenAccount,
        associatedToken: this.fromMint,
        treasury: treasury,
        treasuryToken: treasuryFrom,
        feeTreasury: MSP_FEES_PUBKEY,
        feeTreasuryToken: this.feesFrom,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SYSTEM_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY
      })
      .signers(signers)
      .rpc();
    logTxUrl(ixName, txId);

    logEnd(ixName);
  }

  //#region UTILS

  private async getFromTokenAccountInfo(pubkey: PublicKey): Promise<AccountInfo | null> {
    let fetchedAccountInfo = null;
    try {
      fetchedAccountInfo = await this.fromTokenClient.getAccountInfo(pubkey);
    } catch (error) {
      // ignore
    }

    return fetchedAccountInfo;
  }

  private async getLamportsPerSignature(): Promise<number> {
    // const recentBlockhash = await this.connection.getLatestBlockhash();
    // const lamportsPerSignature = recentBlockhash.feeCalculator.lamportsPerSignature;
    // return lamportsPerSignature;

    // TODO: redo lamports per signature
    // https://discord.com/channels/428295358100013066/428295358100013069/948651669477027890
    // https://docs.solana.com/developing/clients/jsonrpc-api#getfees (DEPRECATED)
    // https://docs.solana.com/developing/clients/jsonrpc-api#getfeeformessage

    return 5_000;
  }

  public async findMspProgramAddress(): Promise<[PublicKey, number]> {
    return await anchor.web3.PublicKey.findProgramAddress(
      [this.treasurerKeypair.publicKey.toBuffer(), this.slotBuffer],
      this.program.programId
    );
  }

  public async findTreasuryLpTokenAccountAddress(owner: PublicKey): Promise<PublicKey> {
    return await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID, // associatedProgramId
      TOKEN_PROGRAM_ID, // programId
      this.treasuryLpMint, // mint
      owner, // owner
      false // allowOwnerOffCurve
    );
  }

  public async findTreasuryFromAssociatedTokenAddress(owner: PublicKey): Promise<PublicKey> {
    return await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID, // associatedProgramId
      TOKEN_PROGRAM_ID, // programId
      this.fromMint, // mint
      owner, // owner
      false // allowOwnerOffCurve
    );
  }

  /**
   * getWorldState
   */
  public async getMspWorldState(treasury?: PublicKey, treasuryFrom?: PublicKey): Promise<MspWorldState> {
    treasury = treasury ?? this.treasury;
    treasuryFrom = treasuryFrom ?? this.treasuryFrom;

    const treasuryAccount = await this.program.account.treasury.fetchNullable(treasury);
    const treasuryAccountInfo = await this.connection.getAccountInfo(treasury);
    const treasuryFromAccountInfo = await this.getFromTokenAccountInfo(treasuryFrom);

    // const treasuryFeePayerAccountInfo = await this.connection.getAccountInfo(this.treasuryInitializer.publicKey);

    const treasurerAccountInfo = await this.connection.getAccountInfo(this.treasurerKeypair.publicKey);
    const ownerLamports = await this.connection.getBalance(this.treasurerKeypair.publicKey);
    const treasurerFromAccountInfo = await this.getFromTokenAccountInfo(this.treasurerFrom);

    const feesFromAccountInfo = await this.getFromTokenAccountInfo(this.feesFrom);

    return {
      treasuryAccount: treasuryAccount,
      treasuryAccountInfo: treasuryAccountInfo,
      treasuryFromAccountInfo: treasuryFromAccountInfo,
      // treasuryFeePayerAccountInfo: treasuryFeePayerAccountInfo,
      treasurerAccountInfo: treasurerAccountInfo,
      treasurerLamports: ownerLamports,
      treasurerFromAccountInfo: treasurerFromAccountInfo,
      feesFromAccountInfo: feesFromAccountInfo
    };
  }

  // private async calculateExpectedLamports(): Promise<DdcaLamports> {
  //   const zeroDataAccountRentExepmtLamports = await this.connection.getMinimumBalanceForRentExemption(0);
  //   console.log(`zeroDataAccountRentExepmtLamports:  ${zeroDataAccountRentExepmtLamports}`);
  //   const recentBlockhash = await this.connection.getRecentBlockhash();
  //   const lamportsPerSignature = recentBlockhash.feeCalculator.lamportsPerSignature;
  //   const expectedWakeAccountGasBalanece = new BN(zeroDataAccountRentExepmtLamports).add(new BN(lamportsPerSignature).muln(2)); // rentPlusTwiceTxFeeLamports
  //   console.log(`wakeAccountGasBalanece:  ${expectedWakeAccountGasBalanece.toNumber()}`);

  //   const ddcaRentExepmtLamports = await this.connection.getMinimumBalanceForRentExemption(500);
  //   console.log(`ddcaRentExepmtLamports: ${ddcaRentExepmtLamports}`);
  //   const numberOfSwaps = this.ddcaFromInitialDeposit.div(this.amountPerSwap);
  //   const ddcaGasLamportsPerSwap = new BN(20_000_000);
  //   const ddcaExpectedLamports = new BN(ddcaRentExepmtLamports).add(ddcaGasLamportsPerSwap.mul(numberOfSwaps)).sub(new BN(lamportsPerSignature).muln(2));

  //   return {
  //     zeroDataRentExepmtLamports: new BN(zeroDataAccountRentExepmtLamports),
  //     lamportsPerSignature: new BN(lamportsPerSignature),
  //     wakeAccountExpectedLamports: expectedWakeAccountGasBalanece,
  //     numberOfSwaps: numberOfSwaps,
  //     ddcaGasLamportsPerSwap: ddcaGasLamportsPerSwap,
  //     ddcaRentExepmtLamports: new BN(ddcaRentExepmtLamports),
  //     ddcaAfterCreateExpectedLamports: ddcaExpectedLamports,
  //   }
  // }

  // private getTempoHeaders(): Headers {
  //   // const fetch = require("node-fetch");
  //   // const tempoHeaders = new fetch.Headers();
  //   const tempoHeaders = new Headers();
  //   tempoHeaders.append('content-type', 'application/json;charset=UTF-8');
  //   tempoHeaders.append('X-Api-Version', '1.0');
  //   return tempoHeaders;
  // }

  public async sendGetAllocationRequest(whitelistedAddress: string): Promise<AddressAllocation> {
    // const httpsAgent = new https.Agent({
    //   rejectUnauthorized: false,
    // });

    // const headers = this.getTempoHeaders();
    const options: RequestInit = {
      method: 'GET',
      // headers: headers,
      headers: {
        'content-type': 'application/json;charset=UTF-8',
        'X-Api-Version': '1.0'
      }
    };

    const url = `${this.tempoApiUrl}/whitelists/${whitelistedAddress}?claimType=1`;

    const response = await fetch(url, options);
    if (response.status !== 200) {
      throw new Error(`Error: request response status: ${response.status}`);
    }
    // console.log(response);

    const allocationResponse = (await response.json()) as AddressAllocation;
    return allocationResponse;
  }

  public async sendSignClaimTxRequest(whitelistedAddress: string, base64ClaimTx: string): Promise<string> {
    const options: RequestInit = {
      method: 'POST',
      headers: {
        'content-type': 'application/json;charset=UTF-8',
        'X-Api-Version': '1.0'
      },
      body: JSON.stringify({
        claimType: 1,
        base64ClaimTransaction: base64ClaimTx
      })
    };

    const url = `${this.tempoApiUrl}/whitelists/${whitelistedAddress}`;

    const response = await fetch(url, options);
    if (response.status !== 200) {
      throw new Error(`Error: request response status: ${response.status}`);
    }

    const signedClaimTxResponse = (await response.json()) as SignedClaimTxResponse;
    return signedClaimTxResponse.base64SignedClaimTransaction;
  }

  public async sendRecordClaimTxRequest(whitelistedAddress: string, claimTxId: string): Promise<any> {
    const options: RequestInit = {
      method: 'POST',
      headers: {
        'content-type': 'application/json;charset=UTF-8',
        'X-Api-Version': '1.0'
      }
      // body: JSON.stringify({
      //   claimType: 1,
      //   base64ClaimTransaction: claimTxId,
      // }),
    };

    const url = `${this.tempoApiUrl}/airdrop-claim-tx/${whitelistedAddress}?txId=${claimTxId}`;

    const response = await fetch(url, options);
    if (response.status !== 200) {
      throw new Error(`Error: request response status: ${response.status}`);
    }

    return response;
  }

  public async getTokenAccountBalance(pubkey: PublicKey): Promise<anchor.web3.TokenAmount | null> {
    try {
      const response = await this.connection.getTokenAccountBalance(pubkey);
      return response.value;
    } catch (error) {
      return null;
    }
  }

  public async logTreasury(): Promise<void> {
    const treasury = await this.program.account.treasury.fetchNullable(this.treasury);
    const mapped = {
      treasuryAddress: this.treasury.toBase58(),
      type:
        treasury?.treasuryType == TREASURY_TYPE_OPEN
          ? 'OPEN'
          : treasury?.treasuryType == TREASURY_TYPE_LOCKED
          ? 'LOCKED'
          : 'UNKNOWN!!!',
      treasurer: treasury?.treasurerAddress.toBase58(),
      associatedTokenAccount: treasury?.associatedTokenAddress.toBase58(),
      totalStreams: treasury?.totalStreams.toNumber(),
      lastKnownBalanceUnits: treasury?.lastKnownBalanceUnits.toNumber(),
      allocationAssignedUnits: treasury?.allocationAssignedUnits.toNumber()
    };
    console.log(mapped);
  }

  //#endregion
}

export type MspWorldState = {
  treasuryAccount: TreasuryAccount | null;
  treasuryAccountInfo: anchor.web3.AccountInfo<Buffer> | null;
  treasuryFromAccountInfo: AccountInfo | null;
  treasurerAccountInfo: anchor.web3.AccountInfo<Buffer> | null;
  treasurerLamports: number;
  treasurerFromAccountInfo: AccountInfo | null;
  feesFromAccountInfo: AccountInfo | null;
};

export type WhitelistedAddress = {
  id: number;
  address: string;
  private_key: string;
  token_amount: number;
  is_reserved: boolean;
  signed_utc: number;
  claimed_tx_id: string;
  whitelist_source_id: number;
};

export type SignedClaimTxResponse = {
  whitelistedAddress: string;
  treasurerAddress: string;
  signedByBeneficiary: boolean;
  signedByTreasurer: boolean;
  base64SignedClaimTransaction: string;
  signedClaimTransactionId: string;
  reason: string;
  succeeded: boolean;
};

export function sleep(ms: number) {
  console.log('Sleeping for', ms / 1000, 'seconds');
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logTxUrl(ixName: string, txId: string) {
  console.log(`\n${ixName} TX URL: https://explorer.solana.com/tx/${txId}/?cluster=custom&customUrl=${url}`);
}

export function logStart(title: string) {
  console.log(`\n\n^^^^^^^^^^ ${title} ^^^^^^^^^^\n`);
}

export function logEnd(title: string) {
  console.log(`\n********** ${title} **********\n`);
}

/**
 * Airdrop allocation assigned to a whitelisted address
 */
export type AddressAllocation = {
  totalAllocation: {
    tokenAmount: number;
    cliffPercent: number;
    monthlyRate: number;
  };
};

/**
 * 0 = assign to all treasury streams (not implemented),
 * 1 = assign to a specific stream,
 * 2 = leave unallocated
 */
export enum StreamAllocationType {
  // AssignToAllStreams = 0, // NOT IMPLEMENTED YET
  AssignToSpecificStream = 1,
  LeaveUnallocated = 2
}

// TODO: not sure how to leverage event definition in /target/msp.ts to avoid defining this new type here
export type StreamEvent = {
  version: number;
  initialized: boolean;
  name: string;
  treasurerAddress: PublicKey;
  rateAmountUnits: BN;
  rateIntervalInSeconds: BN;
  startUtc: BN;
  cliffVestAmountUnits: BN;
  cliffVestPercent: BN;
  beneficiaryAddress: PublicKey;
  beneficiaryAssociatedToken: PublicKey;
  treasuryAddress: PublicKey;
  allocationAssignedUnits: BN;
  allocationReservedUnits: BN;
  totalWithdrawalsUnits: BN;
  lastWithdrawalUnits: BN;
  lastWithdrawalSlot: BN;
  lastWithdrawalBlockTime: BN;
  lastManualStopWithdrawableUnitsSnap: BN;
  lastManualStopSlot: BN;
  lastManualStopBlockTime: BN;
  lastManualResumeRemainingAllocationUnitsSnap: BN;
  lastManualResumeSlot: BN;
  lastManualResumeBlockTime: BN;
  lastKnownTotalSecondsInPausedStatus: BN;
  lastAutoStopBlockTime: BN;
  status: string;
  isManualPause: boolean;
  cliffUnits: BN;
  currentBlockTime: BN;
  secondsSinceStart: BN;
  estDepletionTime: BN;
  streamedUnitsPerSecond: number;
  fundsLeftInStream: BN;
  fundsSentToBeneficiary: BN;
  withdrawableUnitsWhilePaused: BN;
  nonStopEarningUnits: BN;
  missedUnitsWhilePaused: BN;
  entitledEarningsUnits: BN;
  withdrawableUnitsWhileRunning: BN;
  beneficiaryRemainingAllocation: BN;
  beneficiaryWithdrawableAmount: BN;
  lastKnownStopBlockTime: BN;
  rawLogs: string[];
};

async function logGetStreamTx(program: Program<Msp>, stream: PublicKey) {
  const tx = program.transaction.getStream(LATEST_IDL_FILE_VERSION, {
    accounts: {
      stream: stream
    }
  });

  console.log(await program.provider.simulate!(tx));

  // tx.feePayer = readDataKeypair.publicKey;
  tx.feePayer = (program.provider as anchor.AnchorProvider).wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  // tx.partialSign(readDataKeypair);
  const txBase64 = tx.serialize({ verifySignatures: false, requireAllSignatures: false }).toString('base64');
  console.log();
  console.log('getStreamTx Base64');
  console.log(txBase64);
}

export function expectAnchorError(
  error: AnchorError,
  errorCodeNumber?: number,
  errorCodeName?: string,
  errorDescription?: string
) {
  console.log('error >>>>>>>>>>>>>>>>');
  console.log(error);
  console.log('error.toString()');
  console.log(error.toString());
  console.log('error <<<<<<<<<<<<<<<<');

  /** Example of AnchorError
  {
    error: {
      errorCode: { code: 'PauseOrResumeLockedStreamNotAllowed', number: 6031 },
      errorMessage: 'Streams in a Locked treasury can not be paused or resumed',
      comparedValues: undefined,
      origin: 'stream'
    }
  }
  */

  if (!errorCodeNumber && !errorCodeName && !errorDescription) {
    throw Error('At least one of errorCodeNumber, errorCodeName or errorDescription is required');
  }

  if (errorCodeNumber) {
    expect(error.error.errorCode.number).eq(errorCodeNumber);
  }

  if (errorCodeName) {
    expect(error.error.errorCode.code).eq(errorCodeName);
  }

  if (errorDescription) {
    expect(error.error.errorMessage).eq(errorDescription);
  }
}
