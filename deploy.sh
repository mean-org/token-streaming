#!/bin/bash
if [ -z "$PROGRAM_NAME" ]
then
      echo "Please provide the program name"
      exit 1
fi
if [ -z "$MULTISIG_AUTHORITY_ADDRESS" ]
then
      echo "Please provide the multisig authority"
      exit 2
fi
if [ -z "$RPC_URL" ]
then
      echo "Please provide correct environment or RPC url"
      exit 3
fi

# solana cli overwrite env
solana config set --url "$RPC_URL"

WALLET="$(solana address)"
echo "Wallet Address: $WALLET"

SOL_BALANCE="$(solana balance)"
echo "SOL balance: $SOL_BALANCE"

# Get balance amount & compare
SOL_BALANCE_AMOUNT=$(echo $SOL_BALANCE | grep -Po '\d+' | head -1 | grep -Po '\d+')
echo "SOL_BALANCE_AMOUNT: $SOL_BALANCE_AMOUNT"
if [ "$SOL_BALANCE_AMOUNT" -le "$MINIMUM_SOL_NEEDED" ]
then
      echo "SOL balance is LOW. At least $MINIMUM_SOL_NEEDED SOL are needed. The wallet has $SOL_BALANCE"
      exit 4
fi

# anchor cli
SO_FILE="$(anchor build --program-name "$PROGRAM_NAME" -- --features "$RPC_URL" --no-default-features | grep '$ solana program deploy')"
echo "Program binary(SO) path: $SO_FILE"

BUFFER_ACCOUNT_ADDRESS="$(solana program write-buffer target/deploy/$PROGRAM_NAME.so --output json-compact | jq .buffer -r)"
#echo "Buffer account address: $BUFFER_ACCOUNT_ADDRESS"
export BUFFER_ACCOUNT_ADDRESS=$BUFFER_ACCOUNT_ADDRESS
if [ -z "$BUFFER_ACCOUNT_ADDRESS" ]
then
      echo "Deploy failed..."
      exit 5
else
      echo "Updating buffer authority..."
      solana program set-buffer-authority "$BUFFER_ACCOUNT_ADDRESS" --new-buffer-authority "$MULTISIG_AUTHORITY_ADDRESS"
      echo "****** Account Detals: https://explorer.solana.com/address/${BUFFER_ACCOUNT_ADDRESS}?cluster=${CLUSTER} **********"
      exit 0
fi