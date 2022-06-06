#!/bin/bash

# Variables
# You can change these if you want.
REPO_STORE=./stores/schemas
ASSETS_OUT=./assets/schemas
TARGET_BRANCH=feature/federation
COMMAND_TO_RUN="cp $REPO_STORE/schemas/* $ASSETS_OUT"

echo "# Import Latest Fabric Schemas"
echo "## Configuration:"
echo "## REPO_STORE=$REPO_STORE"
echo "## ASSETS_OUT=$ASSETS_OUT"
echo "## TARGET_BRANCH=$TARGET_BRANCH"
echo "## COMMAND_TO_RUN=$COMMAND_TO_RUN"

# Either use existing store or create a new one
echo "Checking if store exists..."
if [ -d $REPO_STORE ];
then
echo "Store already exists.  Updating..."
NEEDS_UPDATE=true
else
echo "Store does not exist.  Creating..."
git clone https://github.com/FabricLabs/fabric.git $REPO_STORE
fi

# Change Directory to the store
cd $REPO_STORE

# Ensure correct branch
git checkout $TARGET_BRANCH

# Update if necessary (pull latest)
if $NEEDS_UPDATE;
then
echo "Updating from Fabric Labs branch, '$TARGET_BRANCH'..."
git pull origin $TARGET_BRANCH
fi

# Cleanup
cd ../..

# Confirm before execution
echo "Will execute: $COMMAND_TO_RUN"
read -p "Are you sure? (y/n)?" choice
case "$CHOICE" in
  y ) echo "No: $COMMAND_TO_RUN";; #eval $COMMAND_TO_RUN;;
  n ) echo "Aborting";;
  * ) echo "Invalid choice";;
 esac

# Report
echo "All done!  The latest schemas should now be located in `./assets/schemas`"
echo "Have a productive day!"
