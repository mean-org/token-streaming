import { IdlAccounts } from '@project-serum/anchor';
import { Commitment, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { Msp } from './msp_idl_005'; // point to the latest IDL
// Given an IDL type IDL we can derive Typescript types for its accounts
// using eg. IdlAccounts<IDL>['ACCOUNT_NAME']
type RawStream = IdlAccounts<Msp>['stream'];
type RawAccount = IdlAccounts<Msp>['treasury'];

declare global {
  export interface String {
    toPublicKey(): PublicKey;
  }
}

/**
 * MSP Instructions types
 * @deprecated Deprecated in v3.2.0, use {@link ACTION_CODES}.
 */
export enum MSP_ACTIONS {
  /** @deprecated Use {@link ACTION_CODES.ScheduleOneTimePayment}. */
  scheduleOneTimePayment = 1,
  /** @deprecated Use {@link ACTION_CODES.CreateStream}. */
  createStream = 2,
  /** @deprecated Use {@link ACTION_CODES.CreateStreamWithFunds}. */
  createStreamWithFunds = 3,
  /** @deprecated Use {@link ACTION_CODES.AddFundsToAccount}. */
  addFunds = 4,
  /** @deprecated Use {@link ACTION_CODES.WithdrawFromStream}. */
  withdraw = 5,
  /** @deprecated Use {@link ACTION_CODES.PauseStream}. */
  pauseStream = 6,
  /** @deprecated Use {@link ACTION_CODES.ResumeStream}. */
  resumeStream = 7,
  /** @deprecated Use {@link ACTION_CODES.ProposeUpdate}. */
  proposeUpdate = 8,
  /** @deprecated Use {@link ACTION_CODES.AnswerUpdate}. */
  answerUpdate = 9,
  /** @deprecated Use {@link ACTION_CODES.CreateAccount}. */
  createTreasury = 10,
  /** @deprecated Use {@link ACTION_CODES.CloseStream}. */
  closeStream = 11,
  /** @deprecated Use {@link ACTION_CODES.CloseAccount}. */
  closeTreasury = 12,
  /** @deprecated Use {@link ACTION_CODES.TransferStream}. */
  transferStream = 13,
  /** @deprecated Use {@link ACTION_CODES.WithdrawFromAccount}. */
  treasuryWithdraw = 14,
}

/**
 * Codes for identifying user actions supported by this client.
 */
export enum ACTION_CODES {
  ScheduleOneTimePayment = 1,
  CreateStream = 2,
  CreateStreamWithFunds = 3,
  AddFundsToAccount = 4,
  WithdrawFromStream = 5,
  PauseStream = 6,
  ResumeStream = 7,
  ProposeUpdate = 8,
  AnswerUpdate = 9,
  CreateAccount = 10,
  CloseStream = 11,
  CloseAccount= 12,
  TransferStream = 13,
  WithdrawFromAccount= 14,
}

/**
 * Transaction fees
 */
export type TransactionFees = {
  /* Solana fees calculated based on the tx signatures and cluster */
  blockchainFee: number;
  /* MSP flat fee amount depending of the instruction that is being executed */
  mspFlatFee: number;
  /* MSP fee amount in percent depending of the instruction that is being executed */
  mspPercentFee: number;
};

/**
 * Transaction fees parameters
 */
export type TransactionFeesParams = {
  instruction: ACTION_CODES;
  signaturesAmount: number;
};

/**
 * Transaction message
 */
export type TransactionMessage = {
  action: string;
  description: string;
  amount: number;
  fees: TransactionFees;
};

export interface ListStreamParams {
  /**
   * @deprecated Depracated in v3.2.0. Please use {@link psAccountOwner} instead.
   */
  treasurer?: PublicKey;
  psAccountOwner?: PublicKey;
  /**
   * @deprecated Depracated in v3.2.0. Please use {@link psAccount} instead.
   */
  treasury?: PublicKey;
  psAccount?: PublicKey;
  beneficiary?: PublicKey;
  commitment?: Commitment;
  category?: Category;
  subCategory?: SubCategory;
}

/**
 * Stream activity
 */
export type StreamActivity = {
  signature: string;
  initializer: string;
  action: string;
  actionCode: ActivityActionCode;
  amount: string;
  mint: string;
  blockTime: number;
  utcDate: string;
};

/**
 * Stream activity
 */
export type StreamActivityRaw = {
  signature: string;
  initializer: PublicKey | undefined;
  action: string;
  amount: BN | undefined;
  mint: PublicKey | undefined;
  blockTime: number | undefined;
  utcDate: string;
};

/**
 *  Activity parsed from instruction
 */
export type ActivityRaw = {
  signature: string;
  action: ActivityActionCode;
  blockTime: number;
  utcDate: string;
  initializer?: PublicKey;
  stream?: PublicKey;
  template?: PublicKey;
  beneficiary?: PublicKey;
  destination?: PublicKey;
  destinationTokenAccount?: PublicKey;
  mint?: PublicKey;
  amount?: BN;
};

/**
 *  Vesting treasury activity
 * @deprecated Deprecated in v3.2.0. Please use {@link VestingAccountActivity} instead.
 */
export type VestingTreasuryActivity = {
  signature: string;
  action: VestingTreasuryActivityAction;
  initializer?: string;
  mint?: string;
  blockTime?: number;
  template?: string;
  // createStream - allocation amount
  // addFunds - deposited amount
  // withdraw - withdrawn amount
  amount?: string;
  beneficiary?: string; // create stream
  destination?: string; // withdraw
  destinationTokenAccount?: string; // withdrawn associated token account
  stream?: string; // vesting stream activities
  utcDate: string;
};

/**
 *  Vesting account activity
 */
export type VestingAccountActivity = {
  signature: string;
  actionCode: ActivityActionCode;
  initializer?: string;
  mint?: string;
  blockTime?: number;
  template?: string;
  // createStream - allocation amount
  // addFunds - deposited amount
  // withdraw - withdrawn amount
  amount?: string;
  beneficiary?: string; // create stream
  destination?: string; // withdraw
  destinationTokenAccount?: string; // withdrawn associated token account
  stream?: string; // vesting stream activities
  utcDate: string;
};

/**
 *  Vesting treasury activity
 * @deprecated Deprecated in v3.2.0. Please use {@link ActivityRaw} instead.
 */
export type VestingTreasuryActivityRaw = {
  signature: string;
  action: VestingTreasuryActivityAction;
  initializer?: PublicKey;
  mint?: PublicKey;
  blockTime?: number;
  template?: PublicKey;
  // createStream - allocation amount
  // addFunds - deposited amount
  // withdraw - withdrawn amount
  amount: BN | undefined;
  beneficiary?: PublicKey; // create stream
  destination?: PublicKey; // withdraw
  destinationTokenAccount?: PublicKey; // withdrawn associated token account
  stream?: PublicKey; // vesting stream activities
  utcDate: string;
};

/**
 * @deprecated Deprecated in v3.2.0. Please use {@link ActivityActionCode} instead.
 */
export enum VestingTreasuryActivityAction {
  TreasuryCreate,
  TreasuryModify,
  TreasuryAddFunds,
  TreasuryWithdraw,
  StreamCreate,
  StreamPause,
  StreamResume,
  StreamClose,
  StreamAllocateFunds,
  StreamWithdraw,
  TreasuryRefresh,
}

export enum ActivityActionCode {
  Unknown = 0,
  AccountCreated = 10,
  AccountCreatedWithTemplate = 20,
  StreamTemplateUpdated = 30,
  FundsAddedToAccount = 40,
  FundsWithdrawnFromAccount = 50,
  AccountDataRefreshed = 60,
  StreamCreated = 70,
  FundsAllocatedToStream = 80,
  FundsWithdrawnFromStream = 90,
  StreamPaused = 110,
  StreamResumed = 120,
  StreamClosed = 140,
}

/**
 * Treasury type
 *
 * @deprecated Deprecated in v3.2.0. Please use {@link AccountType} instead.
 *
 */
export enum TreasuryType {
  Open = 0,
  Lock = 1,
}

/**
 * Treasury type
 */
export enum AccountType {
  Open = 0,
  Lock = 1,
}

/**
 * Treasury info
 * @deprecated Deprecated in v3.2.0. Use {@link PaymentStreamingAccount} 
 * instead.
 */
export type Treasury = {
  id: PublicKey | string;
  version: number;
  initialized: boolean;
  bump: number;
  slot: number;
  name: string;
  treasurer: PublicKey | string;
  associatedToken: PublicKey | string;
  mint: PublicKey | string;
  labels: string[];
  balance: string;
  allocationReserved: string;
  allocationAssigned: string;
  totalWithdrawals: string;
  totalStreams: number;
  createdOnUtc: Date | string;
  treasuryType: TreasuryType;
  autoClose: boolean;
  category: Category;
  subCategory: SubCategory;
  data: RawAccount;
};

/**
 * Payment Streaming account
 */
export type PaymentStreamingAccount = {
  id: PublicKey;
  version: number;
  initialized: boolean;
  bump: number;
  slot: number;
  name: string;
  owner: PublicKey;
  mint: PublicKey;
  balance: BN;
  allocationAssigned: BN;
  totalWithdrawals: BN;
  totalStreams: number;
  createdOnUtc: Date;
  accountType: AccountType;
  autoClose: boolean;
  category: Category;
  subCategory: SubCategory;
  data: RawAccount;
};

/**
 * Stream template
 */
export type StreamTemplate = {
  id: PublicKey | string;
  version: number;
  bump: number;
  startUtc: Date | string;
  cliffVestPercent: number;
  rateIntervalInSeconds: number;
  durationNumberOfUnits: number;
  feePayedByTreasurer: boolean;
};

/**
 * Stream states
 * @deprecated Deprecated in v3.2.0. Please use {@link STREAM_STATUS_CODE} instead.
 */
export enum STREAM_STATUS {
  Scheduled = 1,
  Running = 2,
  Paused = 3,
}

/**
 * Stream status codes.
 */
export enum STREAM_STATUS_CODE {
  Scheduled = 0,
  Running = 1,
  Paused = 2,
  Unknown = 99,
}

/**
 * Allocation type
 * @deprecated Deprecated in v3.2.0.
 */
export enum AllocationType {
  All = 0,
  Specific = 1,
  None = 2,
}

/**
 * Stream
 */
export type Stream = {
  id: PublicKey;
  /**
   * @deprecated Deprecated in v3.2.0. Use {@link psAccountOwner} 
   * instead.
   */
  treasurer: PublicKey;
  psAccountOwner: PublicKey;
  /**
   * @deprecated Deprecated in v3.2.0. Use {@link psAccount} 
   * instead.
   */
  treasury: PublicKey;
  psAccount: PublicKey;
  beneficiary: PublicKey;
  /**
   * @deprecated Deprecated in v3.2.0. Use {@link psAccount} 
   * instead.
   */
  associatedToken: PublicKey;
  /**
   * The mint being streamed
   */
  mint: PublicKey;
  // Amounts
  cliffVestAmount: BN;
  rateAmount: BN;
  allocationAssigned: BN;
  totalWithdrawalsAmount: BN;
  withdrawableAmount: BN;
  fundsLeftInStream: BN;
  fundsSentToBeneficiary: BN;
  remainingAllocationAmount: BN;
  // Dates
  startUtc: string;
  createdOnUtc: string;
  estimatedDepletionDate: string;
  // Time(s)
  secondsSinceStart: number;
  rateIntervalInSeconds: number;
  createdBlockTime: number;
  lastRetrievedBlockTime: number;
  lastRetrievedTimeInSeconds: number;
  // General
  initialized: boolean;
  version: number;
  name: string;
  streamUnitsPerSecond: number;
  cliffVestPercent: number;
  upgradeRequired: boolean;
  /** @deprecated Deprecated in v3.2.0. */
  status: STREAM_STATUS | string;
  statusCode: STREAM_STATUS_CODE;
  statusName: string;
  isManuallyPaused: boolean;
  /**
   * @deprecated Deprecated in v3.2.0. Use {@link tokenFeePayedFromAccount} 
   * instead.
   */
  feePayedByTreasurer: boolean;
  tokenFeePayedFromAccount: boolean;
  category: Category;
  subCategory: SubCategory;
  data: RawStream;
};

/**
 * Beneficiary Info
 */
export type Beneficiary = {
  streamName: string;
  address: PublicKey;
};

/**
 * Stream Beneficiary Info
 */
export type StreamBeneficiary = {
  streamName: string;
  address: PublicKey;
  beneficiary: PublicKey;
};

// Primary category of tresury accounts
export enum Category {
  default = 0,
  vesting = 1,
}

// Sub categories of vesting accounts
export enum SubCategory {
  default = 0,
  advisor = 1,
  development = 2,
  foundation = 3,
  investor = 4,
  marketing = 5,
  partnership = 6,
  seed = 7,
  team = 8,
  community = 9,
}

// Preferred Time Unit
export enum TimeUnit {
  Second = 0,
  Minute = 60,
  Hour = 3600,
  Day = 86400,
  Week = 604800,
  Month = 2629750,
  Year = 31557000,
}

// Given an IDL type IDL we can derive Typescript types for its accounts
// using eg. IdlAccounts<IDL>['ACCOUNT_NAME']
// Events are not possible yet.
// See https://github.com/coral-xyz/anchor/issues/2050
// See https://github.com/coral-xyz/anchor/pull/2185
// So we need to manually keep this type synchronized with
// MSP IDL -> events -> StreamEvent
export type StreamEventData = {
  version: number;
  initialized: boolean;
  name: string;
  treasurerAddress: PublicKey;
  rateAmountUnits: BN;
  rateIntervalInSeconds: BN;
  /**
   * For stream events, this field is guaranteed to be in seconds
   */
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
  feePayedByTreasurer: boolean;
  status: string;
  isManualPause: boolean;
  cliffUnits: BN;
  currentBlockTime: BN;
  secondsSinceStart: BN;
  estDepletionTime: BN;
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
  createdOnUtc: BN;
  category: number;
  subCategory: number;
};

type FeepayerAccounts = {
  /** Account paying for rent and protocol SOL fees */
  feePayer: PublicKey;
}

export type TransferTransactionAccounts = {
  /** The account providing the tokens to transfer */
  sender: PublicKey;

  /** The beneficiary receiving the tokens */
  beneficiary: PublicKey;

  /**
   * The token mint to be sent. Pass the special `NATIVE_SOL_MINT`
   * here to crate a System program native SOL transfer.
   */
  mint: PublicKey;
} & FeepayerAccounts

export type ScheduleTransferTransactionAccounts = {
  /** The account providing the tokens to transfer */
  owner: PublicKey;
  
  /** The account receiving the tokens */
  beneficiary: PublicKey;
  
  /** The token mint to be sent */
  mint: PublicKey;
} & FeepayerAccounts

export type StreamPaymentTransactionAccounts = {
  /** The account providing the tokens to transfer */
  owner: PublicKey;

  /** The account receiving the tokens */
  beneficiary: PublicKey;

  /** The token mint to be sent */
  mint: PublicKey;
} & FeepayerAccounts

export type CreateAccountTransactionAccounts = {
  /** Owner of the new account */
  owner: PublicKey;

  /** Mint that will be streamed out of this account */
  mint: PublicKey;
} & FeepayerAccounts

export type CreateStreamTransactionAccounts = {
  /** The PS account under the new stream will be created */
  psAccount: PublicKey;

  /** Owner of the PS account */
  owner: PublicKey;

  /** Destination account authorized to withdraw streamed tokens */
  beneficiary: PublicKey;
} & FeepayerAccounts

export type CreateVestingAccountTransactionAccounts = {
  /** Owner of the vesting contract account */
  owner: PublicKey;

  /** Mint that will be vested */
  mint: PublicKey;
} & FeepayerAccounts

export type UpdateVestingTemplateTransactionAccounts = {
  /** Owner of the vesting contract account */
  owner: PublicKey;

  /** Mint that will be vested */
  vestingAccount: PublicKey;
} & FeepayerAccounts

export type CreateVestingStreamTransactionAccounts = {
  /** The vesting account under the new stream will be created */
  vestingAccount: PublicKey;

  /** Owner of the vesting account */
  owner: PublicKey;
  
  /** Account paying for rent and protocol SOL fees */
  feePayer: PublicKey;
  
  /** Destination account authorized to withdraw streamed tokens */
  beneficiary: PublicKey;
}

export type AddFundsToAccountTransactionAccounts = {
  /** The PS account to add funds to */
  psAccount: PublicKey;

  /** Mint of the PS account */
  psAccountMint: PublicKey

  /** The account providing the funds */
  contributor: PublicKey
} & FeepayerAccounts

export type AllocateFundsToStreamTransactionAccounts = {
  /** The PS account containing the stream */
  psAccount: PublicKey;

  /** Owner of the new account */
  owner: PublicKey;

  /** Stream to allocate funds to */
  stream: PublicKey;
} & FeepayerAccounts

export type FundStreamTransactionAccounts = {
  /** The PS account to withdraw funds from */
  psAccount: PublicKey;

  /** Owner of the Payment Streaming account */
  owner: PublicKey;

  /** Stream to add funds to */
  stream: PublicKey;
} & FeepayerAccounts

export type WithdrawFromAccountTransactionAccounts = {
  /** The PS account to withdraw funds from */
  psAccount: PublicKey;

  /** Owner of the associated token account where the withdrawn funds will be
   * deposited.
   */
  destination: PublicKey;
} & FeepayerAccounts

export type RefreshAccountDataTransactionAccounts = {
  /** The PS account to withdraw funds from */
  psAccount: PublicKey;
} & FeepayerAccounts

export type CloseAccountTransactionAccounts = {
  /** The PS account to withdraw funds from */
  psAccount: PublicKey;

  /**
   * Owner of the associated token account where the remaining funds will be
   * deposited.
   */
  destination: PublicKey;
} & FeepayerAccounts

export type WithdrawFromStreamTransactionAccounts = {
  /** The stream to withdraw fund from */
  stream: PublicKey;
} & FeepayerAccounts

export type PauseResumeStreamTransactionAccounts = {
  /** The stream to be paused/resumed */
  stream: PublicKey;

  /**
   * The owner of the Payment Streaming account containing the stream that
   * will be paused/resumed.
   */
  owner: PublicKey;
} & FeepayerAccounts

export type TransferStreamTransactionAccounts = {
  /** The stream to be transferred */
  stream: PublicKey;

  /** Current beneficiary of the stream. The account authorizing the
   * transfer. */
  beneficiary: PublicKey;

  /** New beneficiary for the stream */
  newBeneficiary: PublicKey;
} & FeepayerAccounts

export type CloseStreamTransactionAccounts = {
  /** The stream to be closed */
  stream: PublicKey;

  /** Account that will receive any remaining withdrawable amount on the
   * stream. If ommited, remaining funds will be sent to the beneficiary. */
  destination?: PublicKey;
} & FeepayerAccounts
