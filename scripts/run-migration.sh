#!/bin/bash

echo -e "\033[0;32mRunning agent download count migration script...\033[0m"
echo

node scripts/updateAgentsWithDownloadCounts.js

# Check if the script ran successfully
if [ $? -eq 0 ]; then
  echo
  echo -e "\033[0;32mMigration completed successfully.\033[0m"
else
  echo
  echo -e "\033[0;31mError running migration script.\033[0m"
  exit 1
fi

echo "Press Enter to exit..."
read 