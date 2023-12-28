import { Program, utils } from '@project-serum/anchor';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import {
  PublicKey,
  Keypair,
  TransactionInstruction,
  Connection,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  FEE_ACCOUNT,
  LATEST_IDL_FILE_VERSION,
  SYSTEM_PROGRAM_ID,
  SYSVAR_RENT_PUBKEY,
  TOKEN_PROGRAM_ID,
} from './constants';
import BN from 'bn.js'

import { Msp as Ps } from './msp_idl_005';
import { Category, AccountType, SubCategory } from './types';

export type CreateAccountInstructionAccounts = {
  /**
   * Owner of the new account
   */
  owner: PublicKey;

  /**
   * Account paying for rent and protocol SOL fees
   */
  feePayer: PublicKey;

  /**
   * Mint that will be streamed out of this account
   */
  mint: PublicKey;
};

export type CreateAccountInstructionResult = {
  readonly instruction: TransactionInstruction;
  readonly psAccount: PublicKey;
  readonly psAccountToken: PublicKey;
};

/**
 * Constructs a CreateAccount instruction.
 *
 * @param program - Anchor program created from the PS program IDL
 * @param accounts - Instruction accounts
 * @param name - Name for the new account
 * @param type - Either Open or Lock. Under locked accounts, once a stream
 * starts it cannot be paused or closed, they will run until out of funds
 * @param autoClose - If true, this account will be closed after the last
 * stream in it is closed
 * @param solFeePayedFromAccount - If true, protocol SOL fees will be payed
 * from the newly created account, otherwise from the {@link feePayer} account
 * @param category - Category of the new account
 * @param subCategory - Subcategory of the new account
 */
export async function buildCreateAccountInstruction(
  program: Program<Ps>,
  { owner, mint, feePayer }: CreateAccountInstructionAccounts,
  name: string | undefined,
  type: AccountType,
  autoClose: boolean,
  solFeePayedFromAccount: boolean,
  category: Category = Category.default,
  subCategory: SubCategory = SubCategory.default,
): Promise<CreateAccountInstructionResult> {
  const [slotBn, psAccountSeeds] = await getAccountSeeds(
    program.provider.connection,
    owner,
  );

  const [psAccount] = await PublicKey.findProgramAddress(
    psAccountSeeds,
    program.programId,
  );

  const psAccountToken = await getAssociatedTokenAddress(
    mint,
    psAccount,
    true,
  );

  const instruction = await program.methods
    .createTreasury(
      LATEST_IDL_FILE_VERSION,
      slotBn,
      name || '',
      type,
      autoClose,
      solFeePayedFromAccount,
      { [Category[category]]: {} },
      { [SubCategory[subCategory]]: {} },
    )
    .accounts({
      payer: feePayer,
      treasurer: owner,
      treasury: psAccount,
      treasuryToken: psAccountToken,
      associatedToken: mint,
      feeTreasury: FEE_ACCOUNT,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SYSTEM_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();

  return {
    instruction: instruction,
    psAccount: psAccount,
    psAccountToken: psAccountToken,
  };
}

export type CreateAddFundsInstructionAccounts = {
  /**
   * The PS account to add funds to
   */
  psAccount: PublicKey;

  /**
   * The PS account ATA where funds will be deposited
   */
  psAccountToken?: PublicKey;

  /**
   * Mint of the PS account
   */
  psAccountMint: PublicKey;

  /**
   * The account providing the funds
   */
  contributor: PublicKey;

  /**
   * The contributor ATA
   */
  contributorToken?: PublicKey;

  /**
   * Account paying for rent and protocol SOL fees
   */
  feePayer: PublicKey;

  /**
   * The fee account ATA
   */
  feeAccountToken?: PublicKey;
};

export type CreateAddFundsInstructionResult = {
  readonly instruction: TransactionInstruction;
  readonly psAccountToken: PublicKey;
  readonly contributorToken: PublicKey;
  readonly feeAccountToken: PublicKey;
};

/**
 * Constructs an AddFunds instruction.
 *
 * @param program - Anchor program created from the PS program IDL
 * @param accounts - Instruction accounts
 * @param amount - Token amount to add
 */
export async function buildAddFundsInstruction(
  program: Program<Ps>,
  {
    psAccount,
    psAccountMint,
    psAccountToken,
    contributor,
    contributorToken,
    feePayer,
    feeAccountToken,
  }: CreateAddFundsInstructionAccounts,
  amount: BN,
): Promise<CreateAddFundsInstructionResult> {
  psAccountToken = await ensureAssociatedTokenAddress(
    psAccountToken,
    psAccountMint,
    psAccount,
  );

  contributorToken = await ensureAssociatedTokenAddress(
    contributorToken,
    psAccountMint,
    contributor,
  );

  feeAccountToken = await ensureAssociatedTokenAddress(
    feeAccountToken,
    psAccountMint,
    FEE_ACCOUNT,
  );

  const instruction = await program.methods
    .addFunds(LATEST_IDL_FILE_VERSION, amount)
    .accounts({
      payer: feePayer,
      contributor: contributor,
      contributorToken: contributorToken,
      treasury: psAccount,
      treasuryToken: psAccountToken,
      associatedToken: psAccountMint,
      feeTreasury: FEE_ACCOUNT,
      feeTreasuryToken: feeAccountToken,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SYSTEM_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();

  return {
    instruction,
    psAccountToken,
    contributorToken,
    feeAccountToken,
  };
}

export type CreateStreamInstructionAccounts = {
  /**
   * The PS account under the new stream will be created
   */
  psAccount: PublicKey;

  /**
   * Mint of the PS account
   */
  psAccountMint: PublicKey;

  /**
   * Owner of the PS account
   */
  owner: PublicKey;

  /**
   * Account paying for rent and protocol SOL fees
   */
  feePayer: PublicKey;

  /**
   * Destination account authorized to withdraw streamed tokens
   */
  beneficiary: PublicKey;

  /**
   * The PS account ATA where funds will be deposited
   */
  psAccountToken?: PublicKey;

  /**
   *  The fee account ATA
   */
  feeAccountToken?: PublicKey;
};

export type CreateStreamInstructionResult = {
  readonly instruction: TransactionInstruction;
  readonly stream: PublicKey;
  readonly streamKey?: Keypair;
  readonly isPda: boolean;
  readonly psAccountToken: PublicKey;
  readonly feeAccountToken: PublicKey;
};

/**
 * Constructs a crate stream instruction.
 *
 * @param program - Anchor program created from the PS program IDL
 * @param accounts - Instruction accounts
 * @param name - A name for the new stream
 * @param rateAmount - Token amount that will be streamed in every
 * {@link rateIntervalInSeconds} period
 * @param rateIntervalInSeconds - Period of time in seconds in which the
 * {@link rateAmount} will be streamed progressively second by second
 * @param allocationAssigned - Total token amount allocated to the new stream
 * out of the containing PS account's unallocated balance
 * @param startTs - Unix timestamp when the stream will start
 * @param cliffVestAmount - Token amount that is immediatelly withdrawable
 *  by the beneficiary as soon as the stream starts. When
 * {@link cliffVestPercent} is greater than zero, this value will be ignored
 * @param cliffVestPercent - Percentage of {@link allocationAssigned} that is
 * immediatelly withdrawable by the {@link beneficiary} as soon as the
 * stream starts. It takes precedence over {@link cliffVestAmount}, i.e. when
 * this value is greater than zero, {@link cliffVestAmount} will be ignored.
 * This value will be provided in a range from 0 (0%) to 1_000_000 (100%)
 * @param tokenFeePayedFromAccount - If true, the protocol token fees will be
 * paid from {@link psAccountToken} and deposited upfront during stream
 * creation or allocation. If false, the beneficiary will pay for token fees
 * at withdraw time
 * @param usePda - If true, the new stream will be created at an address
 * derived from the program
 */
export async function buildCreateStreamInstruction(
  program: Program<Ps>,
  {
    psAccount,
    psAccountMint,
    psAccountToken,
    owner,
    beneficiary,
    feePayer,
    feeAccountToken,
  }: CreateStreamInstructionAccounts,
  name: string,
  rateAmount: BN,
  rateIntervalInSeconds: BN,
  allocationAssigned: BN,
  startTs: BN,
  cliffVestAmount: BN,
  cliffVestPercent: BN,
  tokenFeePayedFromAccount: boolean,
  usePda: boolean,
): Promise<CreateStreamInstructionResult> {
  psAccountToken = await ensureAssociatedTokenAddress(
    psAccountToken,
    psAccountMint,
    psAccount,
  );

  feeAccountToken = await ensureAssociatedTokenAddress(
    feeAccountToken,
    psAccountMint,
    FEE_ACCOUNT,
  );

  if (usePda) {
    const streamPdaSeed = Keypair.generate().publicKey;
    const [streamPda] = await PublicKey.findProgramAddress(
      [Buffer.from('stream'), psAccount.toBuffer(), streamPdaSeed.toBuffer()],
      program.programId,
    );

    const instruction = await program.methods
      .createStreamPda(
        LATEST_IDL_FILE_VERSION,
        name,
        startTs,
        rateAmount,
        rateIntervalInSeconds,
        allocationAssigned,
        cliffVestAmount,
        cliffVestPercent,
        tokenFeePayedFromAccount,
        streamPdaSeed,
      )
      .accounts({
        payer: feePayer,
        treasurer: owner,
        treasury: psAccount,
        treasuryToken: psAccountToken,
        associatedToken: psAccountMint,
        beneficiary: beneficiary,
        stream: streamPda,
        feeTreasury: FEE_ACCOUNT,
        feeTreasuryToken: feeAccountToken,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SYSTEM_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    return {
      instruction,
      stream: streamPda,
      isPda: false,
      psAccountToken,
      feeAccountToken,
    };
  }

  const streamKey = Keypair.generate();

  const instruction = await program.methods
    .createStream(
      LATEST_IDL_FILE_VERSION,
      name,
      startTs,
      rateAmount,
      rateIntervalInSeconds,
      allocationAssigned,
      cliffVestAmount,
      cliffVestPercent,
      tokenFeePayedFromAccount,
    )
    .accounts({
      payer: feePayer,
      treasurer: owner,
      treasury: psAccount,
      treasuryToken: psAccountToken,
      associatedToken: psAccountMint,
      beneficiary: beneficiary,
      stream: streamKey.publicKey,
      feeTreasury: FEE_ACCOUNT,
      feeTreasuryToken: feeAccountToken,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SYSTEM_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([streamKey])
    .instruction();

  return {
    instruction,
    stream: streamKey.publicKey,
    streamKey,
    isPda: true,
    psAccountToken,
    feeAccountToken,
  };
}

export type CreateAccountAndTemplateInstructionAccounts = {
  /**
   * Owner of the new account
   */
  owner: PublicKey;

  /**
   * Mint that will be streamed out of this account
   */
  mint: PublicKey;

  /**
   * Account paying for rent and protocol SOL fees
   */
  feePayer: PublicKey;
};

export type StreamTemplateOptions = {
  /** Period of time in seconds in which the rate amount will be streamed
   * progressively second by second. When a stream is created using this
   * template, the allocation asigned to the stream will be provided. Then the
   * rate amount will be calculated as
   * `(allocationAssigned - cliff) / numberOfIntervals`
   */
  rateIntervalInSeconds: BN;

  /**
   * Number of intervals of duration {@link rateIntervalInSeconds} in which
   * the allocation assigned will be streamed
   */
  numberOfIntervals: BN;

  /** Unix timestamp when the stream will start */
  startTs: BN;

  /**
   * Percentage of allocation assigned that is immediatelly withdrawable by
   * the beneficiary as soon as a stream created with this template starts.
   * This value will be provided in a range from 0 (0%) to 1_000_000 (100%)
   */
  cliffVestPercent: BN;

  /**
   * If true, the protocol token fees will be paid from PS account ATA and
   * deposited upfront during stream creation or allocation. If false,
   * the beneficiary will pay for token fees at withdraw time
   */
  tokenFeePayedFromAccount: boolean;
};

export type CreateAccountAndTemplateInstructionResult = {
  readonly instruction: TransactionInstruction;
  readonly psAccount: PublicKey;
  readonly psAccountToken: PublicKey;
  readonly template: PublicKey;
};

/**
 * Constructs an instruction to create a PS account together with a
 * configuration account (template) for creating streams.
 *
 * @param program - Anchor program created from the PS program IDL
 * @param accounts - Instruction accounts
 * @param accountName - Name for the new account
 * @param accountType - Either Open or Lock. Under locked accounts, once a stream
 * starts it cannot be paused or closed, they will run until out of funds
 * @param solFeePayedFromAccount - If true, protocol SOL fees will be payed
 * from the newly created account, otherwise from the {@link feePayer} account
 * @param streamTemplateOptions - Parameters for the stream template account
 * @param category - Category of the new account
 * @param subCategory  - Subcategory of the new account
 */
export async function buildCreateAccountAndTemplateInstruction(
  program: Program<Ps>,
  { owner, mint, feePayer }: CreateAccountAndTemplateInstructionAccounts,
  accountName: string | undefined,
  accountType: AccountType,
  solFeePayedFromAccount: boolean,
  {
    rateIntervalInSeconds,
    numberOfIntervals,
    startTs,
    cliffVestPercent,
    tokenFeePayedFromAccount,
  }: StreamTemplateOptions,
  category: Category = Category.default,
  subCategory: SubCategory = SubCategory.default,
): Promise<CreateAccountAndTemplateInstructionResult> {
  const [slotBn, psAccountSeeds] = await getAccountSeeds(
    program.provider.connection,
    owner,
  );

  const [psAccount] = await PublicKey.findProgramAddress(
    psAccountSeeds,
    program.programId,
  );

  const psAccountToken = await getAssociatedTokenAddress(
    mint,
    psAccount,
    true,
  );

  // Template address
  const [template] = await PublicKey.findProgramAddress(
    [utils.bytes.utf8.encode('template'), psAccount.toBuffer()],
    program.programId,
  );

  const instruction = await program.methods
    .createTreasuryAndTemplate(
      LATEST_IDL_FILE_VERSION,
      accountName || '',
      accountType,
      false,
      solFeePayedFromAccount,
      { [Category[category]]: {} },
      { [SubCategory[subCategory]]: {} },
      startTs,
      rateIntervalInSeconds,
      numberOfIntervals,
      cliffVestPercent,
      tokenFeePayedFromAccount,
      slotBn,
    )
    .accounts({
      payer: feePayer,
      treasurer: owner,
      treasury: psAccount,
      treasuryToken: psAccountToken,
      template,
      associatedToken: mint,
      feeTreasury: FEE_ACCOUNT,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SYSTEM_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();

  return {
    instruction: instruction,
    psAccount: psAccount,
    psAccountToken: psAccountToken,
    template: template,
  };
}

export type UpdateStreamTemplateInstructionAccounts = {
  /**
   * The PS account to add funds to
   */
  psAccount: PublicKey;

  /**
   * The stream template to be updated
   */
  template: PublicKey;

  /**
   * Owner of the new account
   */
  owner: PublicKey;

  /**
   * Account paying for rent and protocol SOL fees
   */
  feePayer: PublicKey;
};

export type UpdateStreamTemplateInstructionResult = {
  readonly instruction: TransactionInstruction;
};

/**
 * Constructs an instruction to update a stream template.
 *
 * @param program - Anchor program created from the PS program IDL
 * @param accounts - Instruction accounts
 * @param newRateIntervalInSeconds
 * @param newNumberOfIntervals
 * @param newStartTs
 * @param newCliffVestPercent
 * @param newTokenFeePayedFromAccount
 */
export async function buildUpdateStreamTemplateInstruction(
  program: Program<Ps>,
  {
    psAccount,
    template,
    owner,
    feePayer,
  }: UpdateStreamTemplateInstructionAccounts,
  newRateIntervalInSeconds: BN,
  newNumberOfIntervals: BN,
  newStartTs: BN,
  newCliffVestPercent: BN,
  newTokenFeePayedFromAccount: boolean,
): Promise<UpdateStreamTemplateInstructionResult> {
  const instruction = await program.methods
    .modifyStreamTemplate(
      LATEST_IDL_FILE_VERSION,
      newStartTs,
      newRateIntervalInSeconds,
      newNumberOfIntervals,
      newCliffVestPercent,
      newTokenFeePayedFromAccount,
    )
    .accounts({
      payer: feePayer,
      template: template,
      treasurer: owner,
      treasury: psAccount,
    })
    .instruction();

  return {
    instruction: instruction,
  };
}

export type CreateStreamWithTemplateInstructionAccounts = {
  /**
   * Template account with the configuration for new streams
   */
  template: PublicKey;
} & CreateStreamInstructionAccounts;

/**
 * Constructs a crate stream instruction using the configuration
 * from a template account. This is similar to
 * {@link buildCreateStreamInstruction} but only  {@link beneficiary},
 * {@link allocationAssigned} and {@link name} are provided, the rest
 * is taken from the template.
 *
 * @param program - Anchor program created from the PS program IDL
 * @param accounts - Instruction accounts
 * @param allocationAssigned - Total token amount allocated to the new stream
 * out of the containing PS account's unallocated balance
 * @param name - A name for the new stream
 * @param usePda - If true, the new stream will be created at an address
 * derived from the program
 */
export async function buildCreateStreamWithTemplateInstruction(
  program: Program<Ps>,
  {
    psAccount,
    psAccountMint,
    psAccountToken,
    template,
    owner,
    feePayer,
    beneficiary,
    feeAccountToken,
  }: CreateStreamWithTemplateInstructionAccounts,
  allocationAssigned: BN,
  name: string,
  usePda: boolean,
): Promise<CreateStreamInstructionResult> {
  psAccountToken = await ensureAssociatedTokenAddress(
    psAccountToken,
    psAccountMint,
    psAccount,
  );

  feeAccountToken = await ensureAssociatedTokenAddress(
    feeAccountToken,
    psAccountMint,
    FEE_ACCOUNT,
  );

  if (usePda) {
    const streamPdaSeed = Keypair.generate().publicKey;
    const [streamPda] = await PublicKey.findProgramAddress(
      [Buffer.from('stream'), psAccount.toBuffer(), streamPdaSeed.toBuffer()],
      program.programId,
    );

    const instruction = await program.methods
      .createStreamPdaWithTemplate(
        LATEST_IDL_FILE_VERSION,
        name,
        new BN(allocationAssigned),
        streamPdaSeed,
      )
      .accounts({
        payer: feePayer,
        treasurer: owner,
        treasury: psAccount,
        treasuryToken: psAccountToken,
        associatedToken: psAccountMint,
        beneficiary: beneficiary,
        template: template,
        stream: streamPda,
        feeTreasury: FEE_ACCOUNT,
        feeTreasuryToken: feeAccountToken,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SYSTEM_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    return {
      instruction,
      stream: streamPda,
      isPda: false,
      psAccountToken,
      feeAccountToken,
    };
  }

  const streamKey = Keypair.generate();

  const instruction = await program.methods
    .createStreamWithTemplate(
      LATEST_IDL_FILE_VERSION,
      name,
      new BN(allocationAssigned),
    )
    .accounts({
      payer: feePayer,
      treasurer: owner,
      treasury: psAccount,
      treasuryToken: psAccountToken,
      associatedToken: psAccountMint,
      beneficiary: beneficiary,
      template: template,
      stream: streamKey.publicKey,
      feeTreasury: FEE_ACCOUNT,
      feeTreasuryToken: feeAccountToken,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SYSTEM_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();

  return {
    instruction,
    stream: streamKey.publicKey,
    streamKey,
    isPda: true,
    psAccountToken,
    feeAccountToken,
  };
}

export type AllocateFundsToStreamInstructionAccounts = {
  psAccount: PublicKey;
  psAccountMint: PublicKey;
  owner: PublicKey;
  feePayer: PublicKey;
  stream: PublicKey;
  psAccountToken?: PublicKey;
  feeAccountToken?: PublicKey;
};

export type AllocateFundsToStreamInstructionResult = {
  instruction: TransactionInstruction;
};

/**
 * Constructs an Allocate instruction.
 *
 * @param program - Anchor program created from the PS program IDL
 * @param accounts - Instruction accounts
 * @param amount - Token amount to allocate out of the containing PS account
 * unallocated balance.
 */
export async function buildAllocateFundsToStreamInstruction(
  program: Program<Ps>,
  {
    psAccount,
    psAccountMint,
    owner,
    feePayer,
    stream,
    psAccountToken,
    feeAccountToken,
  }: AllocateFundsToStreamInstructionAccounts,
  amount: BN,
): Promise<AllocateFundsToStreamInstructionResult> {
  psAccountToken = await ensureAssociatedTokenAddress(
    psAccountToken,
    psAccountMint,
    psAccount,
  );

  feeAccountToken = await ensureAssociatedTokenAddress(
    feeAccountToken,
    psAccountMint,
    FEE_ACCOUNT,
  );

  const instruction = await program.methods
    .allocate(LATEST_IDL_FILE_VERSION, amount)
    .accounts({
      payer: feePayer,
      treasurer: owner,
      treasury: psAccount,
      treasuryToken: psAccountToken,
      associatedToken: psAccountMint,
      stream: stream,
      feeTreasury: FEE_ACCOUNT,
      feeTreasuryToken: feeAccountToken,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SYSTEM_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();

  return {
    instruction,
  };
}

export type WithdrawFromAccountInstructionAccounts = {
  psAccount: PublicKey;
  psAccountMint: PublicKey;
  owner: PublicKey;
  feePayer: PublicKey;
  destination: PublicKey;
  destinationToken?: PublicKey;
  psAccountToken?: PublicKey;
  feeAccountToken?: PublicKey;
};

export type WithdrawFromAccountInstructionResult = {
  instruction: TransactionInstruction;
  destinationToken: PublicKey;
  psAccountToken: PublicKey;
  feeAccountToken: PublicKey;
};

/**
 * Constructs an instruction to withdraw funs from a Payment Streaing account.
 *
 * @param program - Anchor program created from the PS program IDL
 * @param accounts - Instruction accounts
 * @param amount - Token amount to withdraw
 */
export async function buildWithdrawFromAccountInstruction(
  program: Program<Ps>,
  {
    psAccount,
    psAccountMint,
    owner,
    feePayer,
    destination,
    destinationToken,
    psAccountToken,
    feeAccountToken,
  }: WithdrawFromAccountInstructionAccounts,
  amount: BN,
): Promise<WithdrawFromAccountInstructionResult> {
  destinationToken = await ensureAssociatedTokenAddress(
    destinationToken,
    psAccountMint,
    destination,
  );

  psAccountToken = await ensureAssociatedTokenAddress(
    psAccountToken,
    psAccountMint,
    psAccount,
  );

  feeAccountToken = await ensureAssociatedTokenAddress(
    feeAccountToken,
    psAccountMint,
    FEE_ACCOUNT,
  );

  const instruction = await program.methods
    .treasuryWithdraw(LATEST_IDL_FILE_VERSION, amount)
    .accounts({
      payer: feePayer,
      treasurer: owner,
      destinationAuthority: destination,
      destinationTokenAccount: destinationToken,
      associatedToken: psAccountMint,
      treasury: psAccount,
      treasuryToken: psAccountToken,
      feeTreasury: FEE_ACCOUNT,
      feeTreasuryToken: feeAccountToken,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SYSTEM_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();

  return {
    instruction,
    destinationToken,
    psAccountToken,
    feeAccountToken,
  };
}

export type RefreshAccountDataInstructionAccounts = {
  psAccount: PublicKey;
  psAccountMint: PublicKey;
  psAccountToken?: PublicKey;
};

export type RefreshAccountDataInstructionResult = {
  instruction: TransactionInstruction;
  psAccountToken: PublicKey;
};

/**
 * Constructs an instruction to refresh a Payment Streaming account after
 * funds are sent to it from outside of the program, i.e. using the
 * Token program directly.
 *
 * @param program - Anchor program created from the PS program IDL
 * @param accounts - Instruction accounts
 */
export async function buildRefreshAccountDataInstruction(
  program: Program<Ps>,
  {
    psAccount,
    psAccountMint,
    psAccountToken,
  }: RefreshAccountDataInstructionAccounts,
): Promise<RefreshAccountDataInstructionResult> {
  psAccountToken = await ensureAssociatedTokenAddress(
    psAccountToken,
    psAccountMint,
    psAccount,
  );

  const instruction = await program.methods
    .refreshTreasuryData(LATEST_IDL_FILE_VERSION)
    .accounts({
      associatedToken: psAccountMint,
      treasury: psAccount,
      treasuryToken: psAccountToken,
    })
    .instruction();

  return {
    instruction,
    psAccountToken,
  };
}

export type CloseAccountInstructionAccounts = {
  psAccount: PublicKey;
  psAccountMint: PublicKey;
  owner: PublicKey;
  feePayer: PublicKey;
  destination: PublicKey;
  destinationToken?: PublicKey;
  psAccountToken?: PublicKey;
  feeAccountToken?: PublicKey;
};

export type CloseAccountInstructionResult = {
  instruction: TransactionInstruction;
  destinationToken: PublicKey;
  psAccountToken: PublicKey;
  feeAccountToken: PublicKey;
};

/**
 * Constructs an instruction to close a Payment Streaming account.
 *
 * @param program - Anchor program created from the PS program IDL
 * @param accounts - Instruction accounts
 */
export async function buildCloseAccountInstruction(
  program: Program<Ps>,
  {
    psAccount,
    psAccountMint,
    owner,
    feePayer,
    destination,
    destinationToken,
    psAccountToken,
    feeAccountToken,
  }: CloseAccountInstructionAccounts,
): Promise<CloseAccountInstructionResult> {
  destinationToken = await ensureAssociatedTokenAddress(
    destinationToken,
    psAccountMint,
    destination,
  );

  psAccountToken = await ensureAssociatedTokenAddress(
    psAccountToken,
    psAccountMint,
    psAccount,
  );

  feeAccountToken = await ensureAssociatedTokenAddress(
    feeAccountToken,
    psAccountMint,
    FEE_ACCOUNT,
  );

  const instruction = await program.methods
    .closeTreasury(LATEST_IDL_FILE_VERSION)
    .accounts({
      payer: feePayer,
      treasurer: owner,
      destinationAuthority: destination,
      destinationTokenAccount: destinationToken,
      associatedToken: psAccountMint,
      treasury: psAccount,
      treasuryToken: psAccountToken,
      feeTreasury: FEE_ACCOUNT,
      feeTreasuryToken: feeAccountToken,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SYSTEM_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();

  return {
    instruction,
    destinationToken,
    psAccountToken,
    feeAccountToken,
  };
}

export type WithdrawFromStreamInstructionAccounts = {
  psAccount: PublicKey;
  psAccountMint: PublicKey;
  stream: PublicKey;
  beneficiary: PublicKey;
  feePayer: PublicKey;
  beneficiaryToken?: PublicKey;
  psAccountToken?: PublicKey;
  feeAccountToken?: PublicKey;
};

export type WithdrawFromStreamInstructionResult = {
  instruction: TransactionInstruction;
  beneficiaryToken: PublicKey;
  psAccountToken: PublicKey;
  feeAccountToken: PublicKey;
};

/**
 * Constructs an instruction to withdraw funs from a stream.
 *
 * @param program - Anchor program created from the PS program IDL
 * @param accounts - Instruction accounts
 * @param amount
 */
export async function buildWithdrawFromStreamInstruction(
  program: Program<Ps>,
  {
    psAccount,
    psAccountMint,
    stream,
    beneficiary,
    feePayer,
    beneficiaryToken,
    psAccountToken,
    feeAccountToken,
  }: WithdrawFromStreamInstructionAccounts,
  amount: BN,
): Promise<WithdrawFromStreamInstructionResult> {
  beneficiaryToken = await ensureAssociatedTokenAddress(
    beneficiaryToken,
    psAccountMint,
    beneficiary,
  );

  psAccountToken = await ensureAssociatedTokenAddress(
    psAccountToken,
    psAccountMint,
    psAccount,
  );

  feeAccountToken = await ensureAssociatedTokenAddress(
    feeAccountToken,
    psAccountMint,
    FEE_ACCOUNT,
  );

  const instruction = await program.methods
    .withdraw(LATEST_IDL_FILE_VERSION, amount)
    .accounts({
      payer: feePayer,
      beneficiary: beneficiary,
      beneficiaryToken: beneficiaryToken,
      associatedToken: psAccountMint,
      treasury: psAccount,
      treasuryToken: psAccountToken,
      stream: stream,
      feeTreasury: FEE_ACCOUNT,
      feeTreasuryToken: feeAccountToken,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SYSTEM_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();

  return {
    instruction,
    beneficiaryToken,
    psAccountToken,
    feeAccountToken,
  };
}

export type PauseOrResumeStreamInstructionAccounts = {
  psAccount: PublicKey;
  owner: PublicKey;
  stream: PublicKey;
};

export type PauseStreamInstructionResult = {
  instruction: TransactionInstruction;
};

/**
 * Constructs an instruction to pause a running stream.
 *
 * @param program - Anchor program created from the PS program IDL
 * @param accounts - Instruction accounts
 */
export async function buildPauseStreamInstruction(
  program: Program<Ps>,
  { psAccount, owner, stream }: PauseOrResumeStreamInstructionAccounts,
): Promise<PauseStreamInstructionResult> {
  const instruction = await program.methods
    .pauseStream(LATEST_IDL_FILE_VERSION)
    .accounts({
      initializer: owner,
      treasury: psAccount,
      stream: stream,
    })
    .instruction();

  return {
    instruction,
  };
}

export type ResumeStreamInstructionResult = {
  instruction: TransactionInstruction;
};

/**
 * Constructs an instruction to resume a paused stream.
 *
 * @param program - Anchor program created from the PS program IDL
 * @param accounts - Instruction accounts
 */
export async function buildResumeStreamInstruction(
  program: Program<Ps>,
  { psAccount, owner, stream }: PauseOrResumeStreamInstructionAccounts,
): Promise<ResumeStreamInstructionResult> {
  const instruction = await program.methods
    .resumeStream(LATEST_IDL_FILE_VERSION)
    .accounts({
      initializer: owner,
      treasury: psAccount,
      stream: stream,
    })
    .instruction();

  return {
    instruction,
  };
}

export type TansferStreamInstructionAccounts = {
  stream: PublicKey;
  beneficiary: PublicKey;
  newBeneficiary: PublicKey;
};

export type TansferStreamInstructionResult = {
  instruction: TransactionInstruction;
};

/**
 * Constructs an instruction to transfer a stream to a new beneficiary.
 *
 * @param program - Anchor program created from the PS program IDL
 * @param accounts - Instruction accounts
 */
export async function buildTransferStreamInstruction(
  program: Program<Ps>,
  { stream, beneficiary, newBeneficiary }: TansferStreamInstructionAccounts,
): Promise<ResumeStreamInstructionResult> {
  const instruction = await program.methods
    .transferStream(LATEST_IDL_FILE_VERSION, newBeneficiary)
    .accounts({
      beneficiary: beneficiary,
      stream: stream,
      feeTreasury: FEE_ACCOUNT,
      systemProgram: SYSTEM_PROGRAM_ID,
    })
    .instruction();

  return {
    instruction,
  };
}

export type CloseStreamInstructionAccounts = {
  psAccount: PublicKey;
  psAccountMint: PublicKey;
  owner: PublicKey;
  stream: PublicKey;
  beneficiary: PublicKey;
  feePayer: PublicKey;
  beneficiaryToken?: PublicKey;
  psAccountToken?: PublicKey;
  feeAccountToken?: PublicKey;
};

export type CloseStreamInstructionResult = {
  instruction: TransactionInstruction;
  beneficiaryToken: PublicKey;
  psAccountToken: PublicKey;
  feeAccountToken: PublicKey;
};

/**
 * Constructs an instruction to close a stream.
 *
 * @param program - Anchor program created from the PS program IDL
 * @param accounts - Instruction accounts
 */
export async function buildCloseStreamInstruction(
  program: Program<Ps>,
  {
    psAccount,
    psAccountMint,
    owner,
    stream,
    beneficiary,
    feePayer,
    beneficiaryToken,
    psAccountToken,
    feeAccountToken,
  }: CloseStreamInstructionAccounts,
): Promise<CloseStreamInstructionResult> {
  beneficiaryToken = await ensureAssociatedTokenAddress(
    beneficiaryToken,
    psAccountMint,
    beneficiary,
  );

  psAccountToken = await ensureAssociatedTokenAddress(
    psAccountToken,
    psAccountMint,
    psAccount,
  );

  feeAccountToken = await ensureAssociatedTokenAddress(
    feeAccountToken,
    psAccountMint,
    FEE_ACCOUNT,
  );

  const instruction = await program.methods
    .closeStream(LATEST_IDL_FILE_VERSION)
    .accounts({
      payer: feePayer,
      treasurer: owner,
      beneficiary: beneficiary,
      beneficiaryToken: beneficiaryToken,
      associatedToken: psAccountMint,
      treasury: psAccount,
      treasuryToken: psAccountToken,
      stream: stream,
      feeTreasury: FEE_ACCOUNT,
      feeTreasuryToken: feeAccountToken,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SYSTEM_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();

  return {
    instruction,
    beneficiaryToken,
    psAccountToken,
    feeAccountToken,
  };
}

//#region UTILS

async function getAccountSeeds(
  connection: Connection,
  owner: PublicKey,
): Promise<[BN, Buffer[]]> {
  const slot = await connection.getSlot();
  const slotBn = new BN(slot);
  const slotBuffer = slotBn.toArrayLike(Buffer, 'le', 8);
  const psAccountSeeds = [owner.toBuffer(), slotBuffer];
  return [slotBn, psAccountSeeds];
}

async function ensureAssociatedTokenAddress(
  associatedToken: PublicKey | undefined,
  mint: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> {
  if (associatedToken) {
    return associatedToken;
  }
  return getAssociatedTokenAddress(
    mint,
    owner,
    true,
  );
}

//#endregion
