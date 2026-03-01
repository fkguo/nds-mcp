#!/usr/bin/env python3
import argparse
import datetime as dt
import os
import sqlite3
from collections import defaultdict

from x4i3.exfor_manager import X4DBManagerDefault

from exfor_x4i3_common import PROJECTILE_MAP, SUPPORTED_Q, extract_points, parse_target


def main():
    parser = argparse.ArgumentParser(description='Build normalized EXFOR SQLite from x4i3 index.tbl')
    parser.add_argument('--index', default='/opt/miniconda3/lib/python3.12/site-packages/x4i3/data/index.tbl')
    parser.add_argument('--output', default=os.path.expanduser('~/.nds-mcp/exfor.sqlite'))
    parser.add_argument('--limit', type=int, default=0, help='0 means full build')
    parser.add_argument('--max-points-per-dataset', type=int, default=5000)
    args = parser.parse_args()

    index_db = sqlite3.connect(args.index)
    total_candidates = index_db.execute(
        "SELECT COUNT(*) FROM theworks WHERE quantity IN ('SIG','DA','DE','FY','MACS') AND projectile IN ('N','P','G','D','A','HE3','H')"
    ).fetchone()[0]
    query = (
        "SELECT entry, subent, pointer, target, projectile, reaction, quantity, author "
        "FROM theworks WHERE quantity IN ('SIG','DA','DE','FY','MACS') AND projectile IN ('N','P','G','D','A','HE3','H') "
        "ORDER BY entry, subent, pointer"
    )
    if args.limit > 0:
        query += f" LIMIT {args.limit}"

    tmp_output = f"{args.output}.tmp.build"
    output_db = sqlite3.connect(tmp_output)
    output_db.executescript("""
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;
CREATE TABLE IF NOT EXISTS exfor_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS exfor_entries (
  entry_id TEXT NOT NULL,
  subentry_id TEXT NOT NULL,
  target_Z INTEGER NOT NULL,
  target_A INTEGER,
  state INTEGER NOT NULL DEFAULT 0,
  projectile TEXT NOT NULL,
  reaction TEXT,
  quantity TEXT NOT NULL,
  reference TEXT,
  year INTEGER,
  PRIMARY KEY(entry_id, subentry_id)
);
CREATE TABLE IF NOT EXISTS exfor_points (
  entry_id TEXT NOT NULL,
  subentry_id TEXT NOT NULL,
  point_index INTEGER NOT NULL,
  energy_eV REAL,
  kT_keV REAL,
  value REAL,
  uncertainty REAL,
  FOREIGN KEY(entry_id, subentry_id) REFERENCES exfor_entries(entry_id, subentry_id)
);
CREATE INDEX IF NOT EXISTS idx_exfor_entries_lookup ON exfor_entries(target_Z, target_A, state, projectile, quantity);
CREATE INDEX IF NOT EXISTS idx_exfor_points_lookup ON exfor_points(entry_id, subentry_id, point_index);
""")

    manager = X4DBManagerDefault()
    written_entries = set()
    stats = defaultdict(int)
    current_entry = None
    entry_rows = []
    cursor = output_db.cursor()

    def flush_entry(entry, rows):
        if not rows:
            return
        try:
            entry_obj = manager.retrieve(ENTRY=entry).get(entry)
            if entry_obj is None:
                stats['missing_entries'] += 1
                return
            dataset_map = entry_obj.getSimplifiedDataSets(makeAllColumns=True)
        except Exception:
            stats['entry_load_errors'] += 1
            return
        by_subent = defaultdict(list)
        for key in dataset_map.keys():
            by_subent[key[1]].append(key)
        for row in rows:
            entry_id, subent, pointer, target_raw, projectile_raw, reaction, quantity, author = row
            target = parse_target(target_raw)
            if target is None or quantity not in SUPPORTED_Q:
                stats['skipped_non_nuclide_or_quantity'] += 1
                continue
            projectile = PROJECTILE_MAP.get(projectile_raw)
            if projectile is None:
                stats['skipped_projectile'] += 1
                continue
            pointer = (pointer or ' ').strip() or ' '
            key = (entry_id, subent, pointer)
            dataset = dataset_map.get(key)
            if dataset is None and by_subent.get(subent):
                dataset = dataset_map[by_subent[subent][0]]
            if dataset is None:
                stats['missing_dataset'] += 1
                continue
            points = extract_points(dataset, quantity, args.max_points_per_dataset)
            if not points:
                stats['empty_points'] += 1
                continue
            subentry_id = subent if pointer == ' ' else f"{subent}:{pointer}"
            unique_key = (entry_id, subentry_id)
            if unique_key in written_entries:
                continue
            z, a, state = target
            cursor.execute(
                "INSERT INTO exfor_entries(entry_id, subentry_id, target_Z, target_A, state, projectile, reaction, quantity, reference, year) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (entry_id, subentry_id, z, a, state, projectile, reaction, quantity, author, None),
            )
            cursor.executemany(
                "INSERT INTO exfor_points(entry_id, subentry_id, point_index, energy_eV, kT_keV, value, uncertainty) VALUES (?,?,?,?,?,?,?)",
                [(entry_id, subentry_id, *point) for point in points],
            )
            written_entries.add(unique_key)
            stats['entries_inserted'] += 1
            stats['points_inserted'] += len(points)

    for row_index, row in enumerate(index_db.execute(query), 1):
        if current_entry is None:
            current_entry = row[0]
        if row[0] != current_entry:
            flush_entry(current_entry, entry_rows)
            entry_rows = [row]
            current_entry = row[0]
        else:
            entry_rows.append(row)
        if row_index % 20000 == 0:
            output_db.commit()
            print(f"rows={row_index} entries={stats['entries_inserted']} points={stats['points_inserted']}")
    flush_entry(current_entry, entry_rows)

    output_db.execute("INSERT OR REPLACE INTO exfor_meta(key, value) VALUES ('schema_version', '1')")
    output_db.execute("INSERT OR REPLACE INTO exfor_meta(key, value) VALUES ('built_at', ?)", (dt.datetime.now(dt.UTC).strftime('%Y-%m-%d %H:%M:%S'),))
    output_db.execute("INSERT OR REPLACE INTO exfor_meta(key, value) VALUES ('source', ?)", (f"x4i3 index.tbl {'full' if args.limit == 0 else f'limit={args.limit}'}",))
    output_db.execute("INSERT OR REPLACE INTO exfor_meta(key, value) VALUES ('candidate_rows', ?)", (str(total_candidates if args.limit == 0 else min(args.limit, total_candidates)),))
    output_db.commit()
    output_db.close()
    index_db.close()
    os.replace(tmp_output, args.output)
    print(f"done output={args.output} entries={stats['entries_inserted']} points={stats['points_inserted']}")


if __name__ == '__main__':
    main()
