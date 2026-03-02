# nds-mcp Build SOP (Internal / Minimal)

内部文档：仅供维护者/agent 用于构建与验证数据库；不是 MCP 客户端的“用户手册”。  
仅保留 agent/运维必需步骤。  
目标产物：`~/.nds-mcp/{nds.sqlite,jendl5.sqlite,exfor.sqlite,ddep.sqlite}`（`CODATA` 已并入 `nds.sqlite`）。

发布前硬性要求：每个已接入的可选数据库都必须先本地构造出对应 sqlite 并通过校验，再上传 Release 资产。

## 1) Preconditions

```bash
node -v && pnpm -v && python3 -V && sqlite3 --version
python3 -m pip install --user x4i3
```

## 2) Build Commands

```bash
cd /Users/fkg/Coding/Agents/nds-mcp
```

主库（`nds.sqlite`，需原始数据目录）：

```bash
pnpm run ingest -- --data-dir /path/to/raw --output ~/.nds-mcp/nds.sqlite
```

仅更新 `nds.sqlite` 内的 CODATA 常数（可选）：

```bash
pnpm run ingest:codata -- --output ~/.nds-mcp/nds.sqlite
```

JENDL-5 衰变库（`jendl5.sqlite`）：

```bash
scripts/download-jendl5-dec.sh ~/.nds-mcp/raw/jendl5-dec_upd5.tar.gz
pnpm run ingest:jendl5-dec -- --source ~/.nds-mcp/raw/jendl5-dec_upd5.tar.gz --output ~/.nds-mcp/jendl5.sqlite
```

JENDL-5 中子 XS（`jendl5.sqlite`，300K pointwise）：

```bash
scripts/download-jendl5-xs.sh ~/.nds-mcp/raw/jendl5-n-300K.tar.gz
pnpm run ingest:jendl5-xs -- --source ~/.nds-mcp/raw/jendl5-n-300K.tar.gz --output ~/.nds-mcp/jendl5.sqlite
```

说明：`--jendl5-xs` 支持以下输入形态（推荐优先官方 `jendl5-n-300K.tar.gz`）：
- tar/tgz（可包含 `.dat.gz` / `.dat` / `.endf` / `.txt` 或 json/jsonl）
- 已解压目录（递归扫描同类文件）
- 单个 ENDF 文本文件（含 `.gz`）

EXFOR 全量构建（推荐）：

```bash
python3 scripts/build-exfor-from-x4i3.py --output ~/.nds-mcp/exfor.sqlite
```

EXFOR 快速构建（调试）：

```bash
python3 scripts/build-exfor-from-x4i3.py --limit 120000 --output ~/.nds-mcp/exfor.sqlite
```

已是标准化 EXFOR SQLite 时直接导入：

```bash
pnpm run ingest:exfor -- --source /path/to/exfor.sqlite --output ~/.nds-mcp/exfor.sqlite
```

DDEP 构建（当前支持 JSONL 或标准化 sqlite 导入）：

```bash
pnpm run ingest:ddep -- --source /path/to/ddep.jsonl --ddep-release 2026-01 --output ~/.nds-mcp/ddep.sqlite
```

## 3) Verification

```bash
cd /Users/fkg/Coding/Agents/nds-mcp
scripts/check-db.sh
```

可选：MCP 查询烟测：

```bash
pnpm exec tsx - <<'TS'
import { queryRadiationSpectrum } from './src/db/jendl5RadiationSpec.ts';
import { searchExfor } from './src/db/exfor.ts';
const jdb = `${process.env.HOME}/.nds-mcp/jendl5.sqlite`;
const edb = `${process.env.HOME}/.nds-mcp/exfor.sqlite`;
const rad = await queryRadiationSpectrum(jdb, { Z: 27, A: 60, state: 0, type: 'gamma', min_intensity: 0.01 });
const exf = await searchExfor(edb, { Z: 13, A: 27, state: 0, projectile: 'n', quantity: 'SIG', limit: 3 });
console.log({ radiation_found: !!rad, exfor_hits: exf.length });
TS
```

## 4) Baseline (2026-02-28 full EXFOR)

- `candidate_rows=683261`
- `exfor_entries=110020`
- `exfor_points=7096882`
- projectile: `n,p,a,d,g,h`

## 5) Fast Recovery

- `x4sqlite` 链接失效：用 `x4i3` 路径（上面 EXFOR 全量构建命令）。
- `x4i3` 异常：`python3 -m pip install --upgrade --user x4i3`。
- 重建：`rm -f ~/.nds-mcp/{jendl5.sqlite,exfor.sqlite}` 后重跑。

## 6) Release Upload（可选 DB）

先构建 sqlite 再 release（不可跳过）：

```bash
# 全量可选 DB 校验
scripts/check-db.sh

# 仅发布 jendl5.sqlite 时，使用 scoped 校验
scripts/check-db.sh --only main,jendl5

scripts/release-phase2-dbs.sh --tag <tag> --repo fkguo/nds-mcp \
  --jendl5 ~/.nds-mcp/jendl5.sqlite \
  --exfor ~/.nds-mcp/exfor.sqlite \
  --ddep ~/.nds-mcp/ddep.sqlite
```

如仅发布 `jendl5.sqlite`，仅传 `--jendl5` 即可；但上传前必须保证本地 `jendl5_xs_meta` / `jendl5_xs_points` / `jendl5_xs_interp` 非空。
