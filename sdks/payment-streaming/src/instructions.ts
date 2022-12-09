import { BN, Program, utils } from '@project-serum/anchor';
import { program } from '@project-serum/anchor/dist/cjs/spl/token';
import { token } from '@project-serum/anchor/dist/cjs/utils';
import { Token } from '@solana/spl-token';
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

import { Msp as Ps } from './msp_idl_005';
import { Category, AccountType, SubCategory } from './types';

export type CreateAccountInstructionResult = {
  readonly instruction: TransactionInstruction;
  readonly psAccount: PublicKey;
  readonly psAccountToken: PublicKey;
};

/**
 * Constructs a CreateAccount instruction
 *
 * @param program - Anchor program created from the PS program IDL
 * @param owner - Owner of the new account
 * @param feePayer - Account paying rent and protocol SOL fees
 * @param mint - Mint that will be streamed out of this account
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
  owner: PublicKey,
  feePayer: PublicKey,
  mint: PublicKey,
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

  const psAccountToken = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
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

export type CreateAddFundsInstructionResult = {
  readonly instruction: TransactionInstruction;
  readonly psAccountToken: PublicKey;
  readonly contributorToken: PublicKey;
  readonly feeAccountToken: PublicKey;
};

/**
 * Constructs an AddFunds instruction
 *
 * @param program - Anchor program created from the PS program IDL
 * @param psAccount - The PS account to add funds to
 * @param psAccountMint - Mint of the PS account
 * @param contributor - The account providing the funds
 * @param feePayer - Account paying rent and protocol SOL fees
 * @param amount - Token amount to add
 * @param psAccountToken - The PS account ATA where funds will be deposited
 * @param contributorToken - The contributor ATA
 * @param feeAccountToken - The fee account ATA
 */
export async function buildAddFundsInstruction(
  program: Program<Ps>,
  psAccount: PublicKey,
  psAccountMint: PublicKey,
  contributor: PublicKey,
  feePayer: PublicKey,
  amount: BN,
  psAccountToken?: PublicKey,
  contributorToken?: PublicKey,
  feeAccountToken?: PublicKey,
): Promise<CreateAddFundsInstructionResult> {
  if (!psAccountToken) {
    psAccountToken = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      psAccountMint,
      psAccount,
      true,
    );
  }

  if (!contributorToken) {
    contributorToken = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      psAccountMint,
      contributor,
      true,
    );
  }

  feeAccountToken = await getAssociatedToken(
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

export type CreateStreamInstructionResult = {
  readonly instruction: TransactionInstruction;
  readonly stream: PublicKey;
  readonly streamKey?: Keypair;
  readonly isPda: boolean;
  readonly psAccountToken: PublicKey;
  readonly feeAccountToken: PublicKey;
};

/**
 * Constructs a crate stream instruction
 *
 * @param program - Anchor program created from the PS program IDL
 * @param psAccount - The PS account under the new stream will be created
 * @param psAccountMint - Mint of the PS account
 * @param owner - Owner of the PS account
 * @param feePayer - Account paying rent and protocol SOL fees
 * @param beneficiary - Destination account authorized to withdraw streamed
 * tokens
 * @param name - A name for the new stream
 * @param rateAmount - Token amount that will be streamed in every
 * {@link rateIntervalInSeconds} period
 * @param rateIntervalInSeconds - Period of time in seconds in which the
 * {@link rateAmount} will be streamed progressively second by second
 * @param allocationAssigned - Total token amount allocated to the new stream
 * out of the containing PS account's unallocated balance
 * @param startTs - Unix timestamp when the stream will start
 * @param cliffVestAmount - Token amount that is immediatelly withdrawable
 *  by the {@link beneficiary} as soon as the stream starts. When
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
 * @param psAccountToken - The PS account ATA where funds will be deposited
 * @param feeAccountToken - The fee account ATA
 */
export async function buildCreateStreamInstruction(
  program: Program<Ps>,
  psAccount: PublicKey,
  psAccountMint: PublicKey,
  owner: PublicKey,
  feePayer: PublicKey,
  beneficiary: PublicKey,
  name: string,
  rateAmount: BN,
  rateIntervalInSeconds: BN,
  allocationAssigned: BN,
  startTs: BN,
  cliffVestAmount: BN,
  cliffVestPercent: BN,
  tokenFeePayedFromAccount: boolean,
  usePda: boolean,
  psAccountToken?: PublicKey,
  feeAccountToken?: PublicKey,
): Promise<CreateStreamInstructionResult> {
  if (!psAccountToken) {
    psAccountToken = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      psAccountMint,
      psAccount,
      true,
    );
  }

  feeAccountToken = await getAssociatedToken(
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
 * @param owner - Owner of the new account
 * @param feePayer - Account paying rent and protocol SOL fees
 * @param mint - Mint that will be streamed out of this account
 * @param name - Name for the new account
 * @param type - Either Open or Lock. Under locked accounts, once a stream
 * starts it cannot be paused or closed, they will run until out of funds
 * @param solFeePayedFromAccount - If true, protocol SOL fees will be payed
 * from the newly created account, otherwise from the {@link feePayer} account
 * @param category - Category of the new account
 * @param subCategory  - Subcategory of the new account
 * @param rateIntervalInSeconds - Period of time in seconds in which the
 * rate amount will be streamed progressively second by second. When a stream
 * is created using this template, the allocation asigned to the stream will
 * be provided. Then the rate amount will be calculated as
 * `(allocationAssigned - cliff) / numberOfIntervals`
 * @param numberOfIntervals - Number of intervals of duration
 * {@link rateIntervalInSeconds} in which the allocation assigned will be
 * streamed
 * @param startTs - Unix timestamp when the stream will start
 * @param cliffVestPercent - Percentage of allocation assigned that is
 * immediatelly withdrawable by the beneficiary as soon as a
 * stream created with this template starts. This value will be provided in a
 * range from 0 (0%) to 1_000_000 (100%)
 * @param tokenFeePayedFromAccount - If true, the protocol token fees will be
 * paid from PS account ATA and deposited upfront during stream
 * creation or allocation. If false, the beneficiary will pay for token fees
 * at withdraw time
 */
export async function buildCreateAccountAndTemplateInstruction(
  program: Program<Ps>,
  owner: PublicKey,
  feePayer: PublicKey,
  mint: PublicKey,
  name: string | undefined,
  type: AccountType,
  solFeePayedFromAccount: boolean,
  category: Category = Category.default,
  subCategory: SubCategory = SubCategory.default,
  rateIntervalInSeconds: BN,
  numberOfIntervals: BN,
  startTs: BN,
  cliffVestPercent: BN,
  tokenFeePayedFromAccount: boolean,
): Promise<CreateAccountAndTemplateInstructionResult> {
  const [slotBn, psAccountSeeds] = await getAccountSeeds(
    program.provider.connection,
    owner,
  );

  const [psAccount] = await PublicKey.findProgramAddress(
    psAccountSeeds,
    program.programId,
  );

  const psAccountToken = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
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
      name || '',
      type,
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

export type UpdateStreamTemplateInstructionResult = {
  readonly instruction: TransactionInstruction;
};

/**
 * Constructs an instruction to update a stream template
 *
 * @param program - Anchor program created from the PS program IDL
 * @param psAccount - The PS account to add funds to
 * @param template - The stream template to be updated
 * @param owner - Owner of the new account
 * @param feePayer - Account paying rent and protocol SOL fees
 * @param newRateIntervalInSeconds
 * @param newNumberOfIntervals
 * @param newStartTs
 * @param newCliffVestPercent
 * @param newTokenFeePayedFromAccount
 */
export async function buildUpdateStreamTemplateInstruction(
  program: Program<Ps>,
  psAccount: PublicKey,
  template: PublicKey,
  owner: PublicKey,
  feePayer: PublicKey,
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

/**
 * Constructs a crate stream instruction using the configuration
 * from a template account. This is similar to
 * {@link buildCreateStreamInstruction} but only  {@link beneficiary},
 * {@link allocationAssigned} and {@link name} are provided, the rest
 * is taken from the template.
 *
 * @param program - Anchor program created from the PS program IDL
 * @param psAccount - The PS account under the new stream will be created
 * @param psAccountMint - Mint of the PS account
 * @param template - Template account with the configuration for new streams
 * @param owner - Owner of the PS account
 * @param feePayer - Account paying rent and protocol SOL fees
 * @param beneficiary - Destination account authorized to withdraw streamed
 * tokens
 * @param allocationAssigned - Total token amount allocated to the new stream
 * out of the containing PS account's unallocated balance
 * @param name - A name for the new stream
 * @param usePda - If true, the new stream will be created at an address
 * derived from the program
 * @param psAccountToken - The PS account ATA where funds will be deposited
 * @param feeAccountToken - The fee account ATA
 */
export async function buildCreateStreamWithTemplateInstruction(
  program: Program<Ps>,
  psAccount: PublicKey,
  psAccountMint: PublicKey,
  template: PublicKey,
  owner: PublicKey,
  feePayer: PublicKey,
  beneficiary: PublicKey,
  allocationAssigned: BN,
  name: string,
  usePda: boolean,
  psAccountToken?: PublicKey,
  feeAccountToken?: PublicKey,
): Promise<CreateStreamInstructionResult> {
  if (!psAccountToken) {
    psAccountToken = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      psAccountMint,
      psAccount,
      true,
    );
  }

  feeAccountToken = await getAssociatedToken(
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

export type AllocateFundsToStreamInstructionResult = {
  instruction: TransactionInstruction;
};

/**
 * Constructs an Allocate instruction
 *
 * @param program
 * @param psAccount
 * @param psAccountMint
 * @param owner
 * @param feePayer
 * @param stream
 * @param amount
 * @param psAccountToken
 * @param feeAccountToken
 */
export async function buildAllocateFundsToStreamInstruction(
  program: Program<Ps>,
  psAccount: PublicKey,
  psAccountMint: PublicKey,
  owner: PublicKey,
  feePayer: PublicKey,
  stream: PublicKey,
  amount: BN,
  psAccountToken?: PublicKey,
  feeAccountToken?: PublicKey,
): Promise<AllocateFundsToStreamInstructionResult> {
  psAccountToken = await getAssociatedToken(
    psAccountToken,
    psAccountMint,
    psAccount,
  );

  feeAccountToken = await getAssociatedToken(
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

export type WithdrawFromAccountInstructionResult = {
  instruction: TransactionInstruction;
  destinationToken: PublicKey;
  psAccountToken: PublicKey;
  feeAccountToken: PublicKey;
};

/**
 * TODO
 * @param program
 * @param psAccount
 * @param psAccountMint
 * @param owner
 * @param feePayer
 * @param destination
 * @param amount
 * @param destinationToken
 * @param psAccountToken
 * @param feeAccountToken
 * @returns
 */
export async function buildWithdrawFromAccountInstruction(
  program: Program<Ps>,
  psAccount: PublicKey,
  psAccountMint: PublicKey,
  owner: PublicKey,
  feePayer: PublicKey,
  destination: PublicKey,
  amount: BN,
  destinationToken?: PublicKey,
  psAccountToken?: PublicKey,
  feeAccountToken?: PublicKey,
): Promise<WithdrawFromAccountInstructionResult> {
  destinationToken = await getAssociatedToken(
    destinationToken,
    psAccountMint,
    destination,
  );

  psAccountToken = await getAssociatedToken(
    psAccountToken,
    psAccountMint,
    psAccount,
  );

  feeAccountToken = await getAssociatedToken(
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

export type RefreshAccountDataInstructionResult = {
  instruction: TransactionInstruction;
  psAccountToken: PublicKey;
};

/**
 * TODO
 * @param program
 * @param psAccount
 * @param psAccountMint
 * @param psAccountToken
 * @returns
 */
export async function buildRefreshAccountDataInstruction(
  program: Program<Ps>,
  psAccount: PublicKey,
  psAccountMint: PublicKey,
  psAccountToken?: PublicKey,
): Promise<RefreshAccountDataInstructionResult> {
  psAccountToken = await getAssociatedToken(
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

export type CloseAccountInstructionResult = {
  instruction: TransactionInstruction;
  destinationToken: PublicKey;
  psAccountToken: PublicKey;
  feeAccountToken: PublicKey;
};

/**
 * TODO
 * @param program
 * @param psAccount
 * @param psAccountMint
 * @param owner
 * @param feePayer
 * @param destination
 * @param destinationToken
 * @param psAccountToken
 * @param feeAccountToken
 * @returns
 */
export async function buildCloseFromAccountInstruction(
  program: Program<Ps>,
  psAccount: PublicKey,
  psAccountMint: PublicKey,
  owner: PublicKey,
  feePayer: PublicKey,
  destination: PublicKey,
  destinationToken?: PublicKey,
  psAccountToken?: PublicKey,
  feeAccountToken?: PublicKey,
): Promise<CloseAccountInstructionResult> {
  destinationToken = await getAssociatedToken(
    destinationToken,
    psAccountMint,
    destination,
  );

  psAccountToken = await getAssociatedToken(
    psAccountToken,
    psAccountMint,
    psAccount,
  );

  feeAccountToken = await getAssociatedToken(
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

export type WithdrawFromStreamInstructionResult = {
  instruction: TransactionInstruction;
  beneficiaryToken: PublicKey;
  psAccountToken: PublicKey;
  feeAccountToken: PublicKey;
};

/**
 * TODO
 * @param program
 * @param psAccount
 * @param psAccountMint
 * @param stream
 * @param beneficiary
 * @param feePayer
 * @param amount
 * @param beneficiaryToken
 * @param psAccountToken
 * @param feeAccountToken
 * @returns
 */
export async function buildWithdrawFromStreamInstruction(
  program: Program<Ps>,
  psAccount: PublicKey,
  psAccountMint: PublicKey,
  stream: PublicKey,
  beneficiary: PublicKey,
  feePayer: PublicKey,
  amount: BN,
  beneficiaryToken?: PublicKey,
  psAccountToken?: PublicKey,
  feeAccountToken?: PublicKey,
): Promise<WithdrawFromStreamInstructionResult> {
  beneficiaryToken = await getAssociatedToken(
    beneficiaryToken,
    psAccountMint,
    beneficiary,
  );

  psAccountToken = await getAssociatedToken(
    psAccountToken,
    psAccountMint,
    psAccount,
  );

  feeAccountToken = await getAssociatedToken(
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

export type PauseStreamInstructionResult = {
  instruction: TransactionInstruction;
};

/**
 * TODO
 * @param program
 * @param psAccount
 * @param stream
 * @param owner
 */
export async function buildPauseStreamInstruction(
  program: Program<Ps>,
  psAccount: PublicKey,
  owner: PublicKey,
  stream: PublicKey,
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
 * TODO
 * @param program
 * @param psAccount
 * @param stream
 * @param owner
 */
export async function buildResumeStreamInstruction(
  program: Program<Ps>,
  psAccount: PublicKey,
  owner: PublicKey,
  stream: PublicKey,
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

export type TansferStreamInstructionResult = {
  instruction: TransactionInstruction;
};

/**
 * TODO
 * @param program
 * @param stream
 * @param beneficiary
 * @param newBeneficiary
 */
export async function buildTransferStreamInstruction(
  program: Program<Ps>,
  stream: PublicKey,
  beneficiary: PublicKey,
  newBeneficiary: PublicKey,
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

export type CloseStreamInstructionResult = {
  instruction: TransactionInstruction;
  beneficiaryToken: PublicKey;
  psAccountToken: PublicKey;
  feeAccountToken: PublicKey;
};

/**
 * TODO
 * @param program
 * @param psAccount
 * @param psAccountMint
 * @param owner
 * @param stream
 * @param beneficiary
 * @param feePayer
 * @param beneficiaryToken
 * @param psAccountToken
 * @param feeAccountToken
 * @returns
 */
export async function buildCloseStreamInstruction(
  program: Program<Ps>,
  psAccount: PublicKey,
  psAccountMint: PublicKey,
  owner: PublicKey,
  stream: PublicKey,
  beneficiary: PublicKey,
  feePayer: PublicKey,
  beneficiaryToken?: PublicKey,
  psAccountToken?: PublicKey,
  feeAccountToken?: PublicKey,
): Promise<CloseStreamInstructionResult> {
  beneficiaryToken = await getAssociatedToken(
    beneficiaryToken,
    psAccountMint,
    beneficiary,
  );

  psAccountToken = await getAssociatedToken(
    psAccountToken,
    psAccountMint,
    psAccount,
  );

  feeAccountToken = await getAssociatedToken(
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

// async function getFeeAccountAssocaitedTokenAddress(
//   mint: PublicKey,
// ): Promise<PublicKey> {
//   return await Token.getAssociatedTokenAddress(
//     ASSOCIATED_TOKEN_PROGRAM_ID,
//     TOKEN_PROGRAM_ID,
//     mint,
//     FEE_ACCOUNT,
//     true,
//   );
// }

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

async function getAssociatedToken(
  associatedToken: PublicKey | undefined,
  mint: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> {
  if (associatedToken) {
    return associatedToken;
  }
  return await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    mint,
    owner,
    true,
  );
}

//#endregion
