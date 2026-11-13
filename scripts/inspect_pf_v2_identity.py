#!/usr/bin/env python3
"""Print PF fixed article attributes from the DEMO only; read-only."""
import json, sqlite3
from pathlib import Path
DB=Path(__file__).resolve().parents[1]/'db/custom.db'
with sqlite3.connect(f'file:{DB}?mode=ro',uri=True) as c:
 c.row_factory=sqlite3.Row
 rows=c.execute('''SELECT family,model,variant,length,width,height,coreType,foamComposition,
 mattressFinish,upholstery,foamNature,foamGrade,foamDensity,foamLayers,specialNotes,
 canonicalIdentity,sku FROM Product WHERE materialId IS NULL AND isOrderScoped=0 ORDER BY id''').fetchall()
 print(json.dumps([dict(row) for row in rows],ensure_ascii=False))
