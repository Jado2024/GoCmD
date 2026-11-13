#!/bin/bash
# Exécute la régression GoCmd étape par étape (audit P5.15.23)
# Usage: bash run-regression-chunks.sh <chunk_number>
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
LOG_DIR="${GOCMD_REGRESSION_LOG_DIR:-preuves/audit-final}"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/test-regression.log"
CHUNK=$1
run_step() {
  local name="$1"; shift
  echo "=== STEP: $name — $(date -Iseconds)" >> "$LOG"
  local code=0
  "$@" >> "$LOG" 2>&1 || code=$?
  echo "=== EXIT[$name]=$code — $(date -Iseconds)" >> "$LOG"
  echo "$name|$code" >> "$LOG_DIR/regression-status.csv"
  if [ "$code" -ne 0 ]; then
    echo "FAIL[$name]=$code — voir $LOG" >&2
    exit "$code"
  fi
  return 0
}

case $CHUNK in
1)
  run_step "types" bun run test:types
  run_step "p51514-dmaic" node tests/v18913p51514-dmaic.test.cjs
  ;;
2)
  run_step "logic" bun run test:logic
  run_step "database" bun run test:database
  ;;
3)
  run_step "procurement" bun run test:procurement
  run_step "v07" bun run test:v07
  run_step "v09" bun run test:v09
  ;;
4)
  run_step "v11" bun run test:v11
  run_step "v12" bun run test:v12
  run_step "v14" bun run test:v14
  run_step "v16-taxonomy" node tests/test_v16_taxonomy.cjs
  ;;
5)
  run_step "v18" bun run test:v18
  run_step "v181" bun run test:v181
  run_step "v182" bun run test:v182
  run_step "v183" bun run test:v183
  ;;
6)
  run_step "v184" bun run test:v184
  run_step "v185" bun run test:v185
  run_step "v186" bun run test:v186
  run_step "v187" bun run test:v187
  ;;
7)
  run_step "v188" bun run test:v188
  run_step "v189" bun run test:v189
  run_step "v1891" bun run test:v1891
  run_step "v1892" bun run test:v1892
  run_step "v1893" bun run test:v1893
  ;;
8)
  run_step "v1895" bun run test:v1895
  run_step "v1896" bun run test:v1896
  run_step "v1897" bun run test:v1897
  run_step "v1898" bun run test:v1898
  run_step "v1899" bun run test:v1899
  ;;
9)
  run_step "v18910" bun run test:v18910
  run_step "v18911" bun run test:v18911
  run_step "v18912" bun run test:v18912
  run_step "v18913" bun run test:v18913
  run_step "v18913p3" bun run test:v18913p3
  ;;
10)
  run_step "v18913p4" bun run test:v18913p4
  run_step "v18913p5" bun run test:v18913p5
  run_step "v18913p52" bun run test:v18913p52
  run_step "v18913p53" bun run test:v18913p53
  ;;
11)
  run_step "v18913p54" bun run test:v18913p54
  run_step "v18913p55" bun run test:v18913p55
  run_step "v18913p56" bun run test:v18913p56
  run_step "v18913p57" bun run test:v18913p57
  ;;
12)
  run_step "v18913p58" bun run test:v18913p58
  run_step "v18913p59" bun run test:v18913p59
  run_step "v18913p510" bun run test:v18913p510
  run_step "v18913p511" bun run test:v18913p511
  ;;
13)
  run_step "v18913p512" bun run test:v18913p512
  run_step "v18913p513" bun run test:v18913p513
  run_step "v18913p5131" bun run test:v18913p5131
  run_step "v18913p5132" bun run test:v18913p5132
  run_step "v18913p5133" bun run test:v18913p5133
  ;;
14)
  run_step "v18913p5147" bun run test:v18913p5147
  run_step "v18913p5148" bun run test:v18913p5148
  run_step "v18913p5150" bun run test:v18913p5150
  run_step "v18913p5151" bun run test:v18913p5151
  ;;
15)
  run_step "v18913p5152" bun run test:v18913p5152
  run_step "v18913p5153" bun run test:v18913p5153
  run_step "v18913p5154" bun run test:v18913p5154
  run_step "v18913p5155" bun run test:v18913p5155
  ;;
16)
  run_step "v18913p5156" bun run test:v18913p5156
  run_step "v18913p5157" bun run test:v18913p5157
  run_step "expiry-p51513" bun run test:expiry:p51513
  ;;
17)
  run_step "v18913p51515" bun run test:v18913p51515
  run_step "v18913p51516" bun run test:v18913p51516
  run_step "v18913p51518" bun run test:v18913p51518
  run_step "v18913p51519" bun run test:v18913p51519
  ;;
18)
  run_step "backup-retention" python3 tests/test_backup_source_retention.py
  run_step "startup-guard-p51521" bun run test:startup-guard:p51521
  ;;
*)
  echo "Chunk inconnu: $CHUNK" >&2; exit 2;;
esac
