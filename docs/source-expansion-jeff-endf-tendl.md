# JEFF-4.0 / ENDF-B-VIII.0 / TENDL 官方数据源清单与 ingest 实施建议

> 生成时间：2026-03-02（UTC）
> 约束遵循：仅调研与计划，不修改 nds-mcp 现有物理语义，不做代码实现。

## 1) 汇总表（可直接用于 ingest 规划）

| 数据源 | 是什么（机构/评估性质/用途） | 官方来源（主站 + 常见官方镜像） | 推荐 ingest 格式 | 当前可用版本与发布日期 | 下载模式/压缩/规模（大致） | 许可/再分发（对 sqlite 资产影响） | 推荐引用方式 |
|---|---|---|---|---|---|---|---|
| **JEFF-4.0** | OECD-NEA JEFF 项目维护；国际评估库（evaluated library）；用于堆物理、屏蔽、活化、输运等。 | 主站：NEA JEFF 页面与 NEA Data Platform（DOI 数据集）；镜像：IAEA NDS `download-endf/JEFF-4.0/` | **首选 ENDF-6（NSUB=10/neutron）**；可选 ACE、PENDF0K、GENDF-1102、OpenMC HDF5。 | 当前主版本 **JEFF-4.0**（发布于 2025-06，NEA 公告 2025-07-02）。 | IAEA 镜像：`n/` + `n-index.htm` + `000-NSUB-index.htm`；示例文件 `n/n_001-H-1_0125.zip`。NSUB=10: 593 材料，zipped ~667MB；全库 zipped ~3GB。NEA 单包：`JEFF40-Evaluations-Neutron-593.zip` 608,170,633 bytes。 | **明确可再分发：CC BY 4.0**（DOI 记录含 rights 字段）。可发布派生 sqlite，但需保留来源与署名信息。 | 优先引用 JEFF-4.0 官方 DOI（例如 neutron: `10.82555/e9ajn-a3p20`；按需加 ACE/HDF5 DOI）。 |
| **ENDF/B-VIII.0** | BNL/NNDC + CSEWG 维护；美国评估核数据库；反应堆、中子输运、核工程基准用途。 | 主站：NNDC `endf-b8.0`；镜像：IAEA NDS `download-endf/ENDF-B-VIII.0/` | **首选 ENDF-6（NSUB=10/neutron）**；可选后处理 ACE/HDF5（由下游自行处理）。 | 目标版本 **ENDF/B-VIII.0** 于 **2018-02-02** 发布（NNDC）。注：NNDC 现也提供 VIII.1（2024）。 | IAEA 镜像：示例 `n/n_0125_1-H-1.zip`。NSUB=10: 557 材料，zipped ~329MB；全库 zipped ~546MB。 | 页面未见清晰 machine-readable 许可证条款，**待验证**。在未澄清前，发布 sqlite 建议仅分发“派生参数 + 明确来源链接”，避免打包原始 ENDF 文本。 | 建议引用 Brown et al., *Nuclear Data Sheets* 148 (2018), DOI: `10.1016/j.nds.2018.02.001`。 |
| **TENDL（建议以 TENDL-2025 为首选）** | TALYS 体系（A.J. Koning, D. Rochman 等）驱动的全球评估库；覆盖核素广、适合缺测核素与宽能区工程计算。 | 主站：`tendl.web.psi.ch`（本次环境连通性不稳定）；镜像：IAEA NDS `download-endf/TENDL-2025/`（另有 `TENDL-2023/`）。 | **首选 ENDF-6（NSUB=10/neutron）**；可选按需二次处理 ACE/HDF5。 | IAEA 当前可见 **TENDL-2025**（库标注 2025，n-index 常见 `EVAL-JUN25`）；官方主站精确发布日期 **待验证**。 | 示例 `n/n_003-Li-6_0325.zip`。TENDL-2025 NSUB=10: 2850 材料，zipped ~4GB；全库 zipped ~17GB。TENDL-2023 作为次级回退：NSUB=10 ~3GB。 | 官方许可/再分发条款在已抓取页面中不充分，**待验证**。在许可证确认前，不建议公开分发包含原始记录文本的 sqlite 全量资产。 | 若官方版本引用格式不可得：先引用 TENDL 版本页 + TALYS 基础文献（Koning & Rochman, 2012, DOI: `10.1016/j.nds.2012.11.002`）；官方格式 **待验证**。 |

## 2) 可执行清单（按优先级：JEFF-4.0 -> ENDF/B-VIII.0 -> TENDL）

### P1. JEFF-4.0（先做，信息最完整且许可清晰）

- **最小可用 ingest 输入包定义**
  - 首选“单包模式”：`JEFF40-Evaluations-Neutron-593.zip`（DOI: `10.82555/e9ajn-a3p20`）。
  - 等价“目录模式”：`/JEFF-4.0/{000-NSUB-index.htm,n-index.htm,n/*.zip}`（593 个 neutron 文件）。
- **校验项**
  - 完整性：文件计数=593，`NSUB=10`，`000-NSUB-index.htm` 中 neutron 条目匹配。
  - 哈希：单包 md5=`51d00ee7bf1491d428f9b30a9782e41d`；入库时再生成 sha256 清单。
  - 结构：文件名模式 `^n_[0-9]{3}-[A-Za-z]{1,3}-[0-9M]+_[0-9]{4}\.zip$`。
  - 元数据键（建议强制）：`source_id, source_url, mirror_url, upstream_version, release_date, retrieved_at, nsub, materials, checksum_algo, checksum, citation, license`。
- **失败回退策略**
  - 主站 NEA DOI 不可用 -> 切换 IAEA 镜像目录模式。
  - IAEA 不可用 -> 回 NEA API `.../files/.../content` 直链。
  - 双站均失败 -> 使用最近一次已验收快照（带 `snapshot_date` 与 `provenance`）。

### P2. ENDF/B-VIII.0

- **最小可用 ingest 输入包定义**
  - 目录模式：`/ENDF-B-VIII.0/{000-NSUB-index.htm,n-index.htm,n/*.zip}`（557 个 neutron 文件）。
- **校验项**
  - 完整性：计数=557；`000-NSUB-index.htm` 中 NSUB=10 zipped ~329MB。
  - 结构：文件名模式 `^n_[0-9]{4}_[0-9]+-[A-Za-z]{1,3}-[0-9M]+\.zip$`。
  - 元数据键：同 JEFF，且 `license_status` 置为 `pending_verification`。
  - 哈希：上游未提供统一校验值时，固定生成本地 `SHA256SUMS` 并入库留痕。
- **失败回退策略**
  - 主站 NNDC 不可用 -> 使用 IAEA 镜像。
  - 双站不可用 -> 使用内部冻结快照；并在发布说明中声明“来源暂不可在线复验”。

### P3. TENDL（建议默认 2025，允许 2023 回退）

- **最小可用 ingest 输入包定义**
  - 首选：`/TENDL-2025/{000-NSUB-index.htm,n-index.htm,n/*.zip}`（2850 个 neutron 文件，~4GB zipped）。
  - 回退：`TENDL-2023` 同结构（2847 个 neutron 文件，~3GB zipped）。
- **校验项**
  - 完整性：计数匹配 000 索引；关键字段含 `EVAL-JUN25`（2025）或对应年份标签。
  - 结构：文件名模式与 JEFF 类似（`n_003-Li-6_0325.zip` 风格）。
  - 元数据键：同上，且强制 `tendl_year`、`release_status`（`official`/`mirror_verified`）。
  - 哈希：生成并保存 `SHA256SUMS`；抽样解压 + ENDF 头记录语法检查。
- **失败回退策略**
  - 主站 PSI 不可达 -> 使用 IAEA 镜像。
  - TENDL-2025 不完整/不可达 -> 自动降级 TENDL-2023，并写入 `degraded_from=TENDL-2025`。
  - 许可证/官方引用不可确认 -> 标记 `待验证`，暂停外部分发，仅内部试运行。

## 3) 实施建议（<=30行）

1. 先把 JEFF-4.0 打通成“黄金路径”，因为许可证（CC BY 4.0）与 DOI 校验最清楚。
2. ingest 入口统一只接收 ENDF-6 neutron（NSUB=10），其余格式（ACE/HDF5）放在后处理层。
3. 每个源都执行同一套三层校验：`文件完整性` -> `命名/结构` -> `ENDF 基础语法`。
4. 强制写入统一元数据键，特别是 `upstream_version`、`release_date`、`citation`、`license_status`。
5. ENDF/B-VIII.0 与 TENDL 在许可证未明确前，默认 `license_status=pending_verification`。
6. 对外发布 sqlite 时，仅发布“派生数值+索引”优先；原始 ENDF 文本外链到官方站点。
7. 下载器支持主站与镜像自动切换，并记录 `source_url_used` 与失败原因。
8. TENDL 采用“2025 优先，2023 可降级”的显式策略，保证流程可用性。
9. 所有下载产物生成不可变 `SHA256SUMS` 与 `MANIFEST.json`，作为可追溯 ingest 证据。
10. 在 README/NEXT 追加“数据源状态表”（可用性、许可证状态、最近验证日期），减少后续重复调研。

## 4) 关键参考链接

- JEFF-4.0 发布新闻（NEA，2025-07-02）：https://www.oecd-nea.org/jcms/pl_108637/jeff-4-0
- JEFF-4.0 neutron DOI：https://doi.org/10.82555/e9ajn-a3p20
- JEFF-4.0 ACE DOI：https://doi.org/10.82555/53ret-j3386
- JEFF-4.0 PENDF0K DOI：https://doi.org/10.82555/wgw94-qcx30
- JEFF-4.0 GENDF-1102 DOI：https://doi.org/10.82555/8ezdz-qd769
- JEFF-4.0 HDF5 DOI：https://doi.org/10.82555/ksevy-avx19
- IAEA JEFF-4.0 镜像目录：https://www-nds.iaea.org/public/download-endf/JEFF-4.0/
- NNDC ENDF/B-VIII.0 主站：https://www.nndc.bnl.gov/endf-b8.0/
- IAEA ENDF/B-VIII.0 镜像目录：https://www-nds.iaea.org/public/download-endf/ENDF-B-VIII.0/
- ENDF/B-VIII.0 综述论文 DOI：https://doi.org/10.1016/j.nds.2018.02.001
- TENDL-2025 IAEA 镜像目录：https://www-nds.iaea.org/public/download-endf/TENDL-2025/
- TENDL-2023 IAEA 镜像目录：https://www-nds.iaea.org/public/download-endf/TENDL-2023/
- TENDL 主站（连通性待验证）：https://tendl.web.psi.ch/
- TALYS/TENDL 代表文献 DOI：https://doi.org/10.1016/j.nds.2012.11.002

## 5) 待验证项（必须显式跟踪）

- ENDF/B-VIII.0 官方可再分发许可条款（用于公开 sqlite 分发的法律边界）。
- TENDL-2025 官方主站发布日期与官方推荐引用格式。
- TENDL 官方可再分发许可条款（尤其是否允许再打包分发派生数据库）。
