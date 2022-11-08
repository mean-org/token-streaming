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
solana config set --url $RPC_URL

WALLET="$(solana address)"
echo "Wallet Address: $WALLET"

SOL_BALANCE="$(solana balance)"
echo "SOL balance: $SOL_BALANCE"

# Get balance amount & compare
SOL_BALANCE_AMOUNT=$(echo $SOL_BALANCE | grep -Po '\d+' | head -1 | grep -Po '\d+')
MAX_AIRDROP_ATTEMPS=3
AIRDROP_ATTEMPS=$MAX_AIRDROP_ATTEMPS

while [ "$AIRDROP_ATTEMPS" -ge 0 && "$SOL_BALANCE_AMOUNT" -le "$MINIMUM_SOL_NEEDED" ]
do
      echo "SOL balance is LOW. At least $MINIMUM_SOL_NEEDED SOL are needed. The wallet has $SOL_BALANCE"
      echo "Requesting SOL..."
      if [ "$AIRDROP_ATTEMPS" -lt "$MAX_AIRDROP_ATTEMPS" ]; then sleep 2; fi
      solana airdrop 2
      AIRDROP_ATTEMPS=$(( $AIRDROP_ATTEMPS - 1 ))
      SOL_BALANCE="$(solana balance)"
      SOL_BALANCE_AMOUNT=$(echo $SOL_BALANCE | grep -Po '\d+' | head -1 | grep -Po '\d+')
done

if [ "$SOL_BALANCE_AMOUNT" -le "$MINIMUM_SOL_NEEDED" ]
then
      echo "SOL balance is LOW. At least $MINIMUM_SOL_NEEDED SOL are needed. The wallet has $SOL_BALANCE. Aborting after $MAX_AIRDROP_ATTEMPS airdrop attemps..."
      exit 4
fi

# anchor cli
SO_FILE="$(anchor build --program-name $PROGRAM_NAME -- --features test | grep '$ solana program deploy')"    

echo "Program binary(SO) path: $SO_FILE"

BUFFER_ACCOUNT_ADDRESS="$(solana program write-buffer target/deploy/$PROGRAM_NAME.so --output json-compact | jq .buffer -r)"
echo "{BUFFER_ACCOUNT_ADDRESS}={$BUFFER_ACCOUNT_ADDRESS}" >> $GITHUB_ENV
if [ -z "$BUFFER_ACCOUNT_ADDRESS" ]
then
      echo "Deploy failed..."
      exit 5
else
      echo "Updating buffer authority..."
      solana program set-buffer-authority $BUFFER_ACCOUNT_ADDRESS --new-buffer-authority $MULTISIG_AUTHORITY_ADDRESS

      BUFFER_ACCOUNT_URL="https://explorer.solana.com/address/${BUFFER_ACCOUNT_ADDRESS}?cluster=devnet"
     
      echo "****** Account Detals: ${BUFFER_ACCOUNT_URL} **********"
      echo "{BUFFER_ACCOUNT_ADDRESS}={$BUFFER_ACCOUNT_ADDRESS}" >> $GITHUB_ENV
      echo "{BUFFER_ACCOUNT_URL}={$BUFFER_ACCOUNT_URL}" >> $GITHUB_ENV
      exit 0
fi