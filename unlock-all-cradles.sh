#!/usr/bin/env bash
# Bulk-unlock all Zebra MC18 cradle slots on the LAN over WiFi adb.
#
# Each MC18 can only unlock its OWN slot, so we fan out to every device:
#   1. discover MC18s listening on adb-tcp :5555 on the subnet
#   2. adb connect each
#   3. unlock: try the broadcast; if the build marks it a protected
#      broadcast (SecurityException), fall back to driving the CradleUtility UI
#
# Prereqs on each device (one-time):
#   - same WiFi as this host
#   - Developer options -> Wireless debugging (adb over network) ON
#   - accept the adb RSA "Allow" prompt
#
# Usage: ./unlock-all-cradles.sh [subnet_prefix] [duration]
#   subnet_prefix default = auto from host (e.g. 192.168.1)
#   duration      default = 10  (valid range 10-30)

set -uo pipefail

DUR="${2:-10}"
ACTION="com.android.actions.unlock.cradle"

# --- resolve subnet prefix ---
PREFIX="${1:-}"
if [[ -z "$PREFIX" ]]; then
  HOSTIP=$(ifconfig 2>/dev/null | awk '/inet /{print $2}' | grep -v '^127' | head -1)
  PREFIX="${HOSTIP%.*}"
fi
[[ -z "$PREFIX" ]] && { echo "could not determine subnet; pass it: $0 192.168.1"; exit 1; }
echo ">> scanning ${PREFIX}.0/24 for adb:5555 ..."

# --- discover open :5555 ---
declare -a IPS=()
while read -r ip; do IPS+=("$ip"); done < <(
  for i in $(seq 1 254); do
    ( nc -G1 -z -w1 "${PREFIX}.$i" 5555 2>/dev/null && echo "${PREFIX}.$i" ) &
  done; wait
)
[[ ${#IPS[@]} -eq 0 ]] && { echo "no devices on :5555"; exit 1; }
echo ">> found: ${IPS[*]}"

# --- connect ---
for ip in "${IPS[@]}"; do adb connect "${ip}:5555" >/dev/null 2>&1; done
sleep 1

# --- collect authorized MC18 transports ---
declare -a DEVS=()
while read -r serial; do DEVS+=("$serial"); done < <(adb devices | awk '/:5555[[:space:]]+device$/{print $1}')
echo ">> authorized: ${DEVS[*]:-none}"
[[ ${#DEVS[@]} -eq 0 ]] && { echo "none authorized (accept the on-device Allow prompt)"; exit 1; }

# --- UI-drive fallback: open CradleUtility, set duration, tap Unlock ---
ui_unlock() {
  local d="$1" xml
  adb -s "$d" shell am start -n com.symbol.cradleutility/.MainActivity >/dev/null 2>&1
  sleep 2
  # center of a node matched by $1 within the current dump $xml
  center() {
    echo "$xml" | grep "$1" | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | head -1 \
      | grep -oE '[0-9]+' | paste -sd' ' - \
      | awk '{printf "%d %d", ($1+$3)/2, ($2+$4)/2}'
  }
  # 1) select the CRADLE UNLOCK tab (fresh launch may open a different tab)
  adb -s "$d" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  xml=$(adb -s "$d" shell cat /sdcard/ui.xml 2>/dev/null | tr '>' '>\n')
  local TAB; TAB=$(center "CRADLE UNLOCK")
  [[ -n "$TAB" ]] && { adb -s "$d" shell input tap $TAB; sleep 1; }
  # 2) re-dump now that the Unlock tab is showing
  adb -s "$d" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  xml=$(adb -s "$d" shell cat /sdcard/ui.xml 2>/dev/null | tr '>' '>\n')
  local F B; F=$(center "id/uTimeTB"); B=$(center "id/UnlockButton")
  [[ -z "$F" || -z "$B" ]] && { echo "UI elements not found"; return 1; }
  adb -s "$d" shell input tap $F
  adb -s "$d" shell input keyevent 123
  for _ in 1 2 3 4 5; do adb -s "$d" shell input keyevent 67; done
  adb -s "$d" shell input text "$DUR"
  adb -s "$d" shell input tap $B
}

# --- unlock each ---
for d in "${DEVS[@]}"; do
  adb -s "$d" logcat -c >/dev/null 2>&1
  out=$(adb -s "$d" shell am broadcast -a "$ACTION" --ei UnlockPeriod "$DUR" 2>&1)
  if echo "$out" | grep -qi "SecurityException\|Permission Denial"; then
    echo "[$d] broadcast blocked -> UI-drive"
    ui_unlock "$d"
  fi
  sleep 1
  res=$(adb -s "$d" logcat -d 2>/dev/null | grep -iE "Response ACK|NACK|Invalid duration|Failure in unlocking" | tail -1)
  echo "[$d] ${res:-no cradle log}"
done
