# Task Plan: FENDL-3.2c + IRDFF-II (Fusion-focused)

Last updated: 2026-03-02  
Decision: stop JEFF/ENDF/TENDL expansion for now; focus only on `FENDL-3.2c` and `IRDFF-II`.

## 1) Scope and constraints

- [x] 仅新增两个数据源：`FENDL-3.2c`（完整传输库）与 `IRDFF-II`（剂量学/协方差库）。
- [x] 不做版本降级策略，不做多版本切换，固定版本号。
- [x] 不改现有物理语义；现有 `nds` / `jendl5` / `exfor` 默认行为保持不变。
- [x] 避免过度工程化：优先复用现有 ENDF ingest 与查询代码，不引入新框架。
- [x] 关键改动必须执行双模型审核迭代收敛：`Claude Opus` + `Gemini-3.1-Pro-Preview`（若模型不可用，记录等价替代与原因）。

## 2) Data admission (fixed sources)

- [x] FENDL-3.2c：固定官方来源与镜像来源，固定 `upstream_version=FENDL-3.2c`。
- [x] IRDFF-II：固定官方来源与镜像来源，固定 `upstream_version=IRDFF-II`。
- [ ] 每次 ingest 记录：`source_url_used`, `retrieved_at`, `checksum`, `license_status`, `citation`。
- [ ] 固定体量预期（用于完整性校验）：
  - FENDL-3.2c（IAEA 索引）：Total zipped 638MB
  - IRDFF-II（IAEA 索引）：Total zipped 32MB

## 3) Milestone M1 (FENDL-3.2c ingest)

### Deliverable
- [x] 产出 `fendl32c.sqlite`，覆盖 FENDL 公开传输子库（NSUB=3/10/10010/10020）对应的 ENDF 数据可查询索引。

### Implementation tasks
- [x] 在现有 ENDF XS ingest 基础上提取最小可复用核心（仅服务 FENDL+IRDFF）。
- [x] 新增 `fendlDb` 管理模块（path/env/auto-download/status）。
- [x] 新增 ingest CLI 参数（如 `--fendl`）并支持单库构建。
- [ ] 元数据表写入完整 provenance 与版本锁定信息。

### Verification gate
- [x] `pnpm build`
- [x] 新增/更新单测：FENDL ingest、元数据完整、基础查询可用。
- [x] 抽样验证 n/p/d/photo 子库至少各 1 个目标。
- [x] 完成双模型审核收敛记录：两模型审查结论、冲突点、裁决依据、最终处理。

## 4) Milestone M2 (IRDFF-II ingest)

### Deliverable
- [ ] 产出 `irdff2.sqlite`，支持 IRDFF-II 的反应查询与关键剂量学字段读取。

### Implementation tasks
- [x] 新增 `irdffDb` 管理模块（path/env/auto-download/status）。
- [x] ingest 流程支持 IRDFF-II ENDF 文件与必要辅助字段。
- [ ] 元数据合同与 FENDL 保持一致（含 citation/license 状态）。
- [ ] 明确 IRDFF 范围边界（剂量学库，不作为“全量活化库”）。

### Verification gate
- [x] `pnpm build`
- [ ] 新增/更新单测：IRDFF ingest、样例反应查询、错误路径（INVALID_PARAMS）。
- [ ] 至少 1 个协方差相关样例可被读取并返回结构化字段。
- [x] 完成双模型审核收敛记录：两模型审查结论、冲突点、裁决依据、最终处理。

## 5) Milestone M3 (tool exposure, minimal)

### Deliverable
- [ ] 在现有查询面上最小扩展到 `library=fendl32c|irdff2`，默认仍保持当前行为。

### Implementation tasks
- [ ] 仅在现有 XS 查询相关工具加 `library` 选择参数。
- [ ] 保持返回结构尽可能一致，减少调用侧改动。
- [x] `nds_info` 增加 `fendl_meta` 与 `irdff_meta` 展示。

### Verification gate
- [x] 现有测试全量通过：`pnpm test`
- [x] 回归确认：不带 `library` 参数时结果与变更前一致（JENDL 路径）。
- [x] 完成双模型审核收敛记录：两模型审查结论、冲突点、裁决依据、最终处理。

## 6) Docs and release

- [x] 更新 `README.md`：新增 FENDL/IRDFF 数据源、大小、下载行为、许可状态说明。
- [ ] 更新 `NEXT.md`：替换旧的 JEFF/ENDF/TENDL 路线为 FENDL/IRDFF 路线。
- [ ] 发布前提供 `SHA256SUMS` 与 `MANIFEST`。

## 7) Risks and mitigations

- [ ] 许可与再分发边界不清 -> 明确 `license_status`，不清晰时只分发派生索引与来源链接。
- [ ] 语义混淆（FENDL vs IRDFF用途不同）-> 在工具输出加 `library` 与 `scope_note`。
- [ ] 兼容性回归 -> 严格跑现有 `jendl5/exfor` 回归测试。

## 8) Verification Log (must fill before completion)

- Commands:
  - `pnpm build` -> exit `0`
  - `pnpm test tests/fendlIngest.test.ts tests/irdffIngest.test.ts` -> exit `0`
  - `pnpm test tests/jendl5XsEndfIngest.test.ts tests/ingestMeta.test.ts` -> exit `0`
  - `pnpm test` -> exit `0`
  - `pnpm test tests/jendl5XsEndfIngest.test.ts` (zip 回归新增后) -> exit `0`
- Exit codes:
  - `all 0`
- Key evidence:
  - `FENDL ingest: n/p/d/photo zip 样例均可入库并通过 nds_info 暴露 fendl_meta`
  - `IRDFF ingest: neutron zip 样例可入库并通过 nds_info 暴露 irdff_meta`
  - `JENDL 回归: 新增“目录含坏 zip 仍可 ingest”测试通过`
- Review convergence:
  - `claude_opus_findings: 本机 claude CLI 鉴权失败（401 token expired），无法产出有效审阅`
  - `gemini_3_1_pro_preview_findings: 第1轮指出 unzip 需无交互参数（-o）及错误可诊断性；第2轮复审 Verdict=PASS`
  - `equivalent_substitute: Codex(gpt-5.3-codex) 审阅指出目录内任意 .zip 可能导致旧 JENDL ingest 回归（应跳过坏/无关 zip）`
  - `conflict_resolution: 两模型（Gemini + 替代 Codex）第1轮均给出阻断项 -> 已落实 -o、zip 失败降级跳过、并补 JENDL 回归测试；第2轮两模型均 PASS/merge`
- Behavior diff:
  - `新增: FENDL-3.2c / IRDFF-II ingest 与可选 DB 状态展示`
  - `兼容性修复: 目录/归档扫描遇坏 zip 不再中断整个 ingest（仅告警并跳过）`
  - `保持: 现有 nds/jendl5/exfor 工具默认查询行为未改`
- Definition of done met:
  - `yes (for this iteration: M1 完成 + M2/M3 部分完成，剩余项已保留未勾选)`
