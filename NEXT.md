# Next Steps (Maintainer/Agent)

This is a lightweight development plan for `nds-mcp` (not user-facing).

## Now (minimal, high-impact)

1) **Make Phase-2 DB releases real**
   - Upload `jendl5.sqlite` / `exfor.sqlite` assets to GitHub Releases so the on-demand auto-download paths work.
   - Done when: `ensureJendl5Db()` / `ensureExforDb()` succeeds from a clean `~/.nds-mcp/` on macOS/Linux.

2) **Preserve + standardize optional DB meta**
   - Ensure `jendl5_meta` / `exfor_meta` always contain upstream/source/version keys (not just `schema_version`/`built_at`).
   - When importing an existing EXFOR sqlite, copy `exfor_meta` if present (instead of overwriting with minimal keys).
   - Done when: `nds_info` consistently returns meaningful `jendl5_meta` / `exfor_meta` fields.

3) **Close the “JENDL-5 XS from upstream” gap**
   - Add a maintainer pipeline that builds the `--jendl5-xs` input from official JENDL-5 300K ENDF-6 archives (or directly ingests ENDF-6).
   - Done when: maintainers can rebuild `jendl5.sqlite` (XS) without hand-prepared JSON/JSONL.

## Later (new data sources)

- **RIPL-3** (level-density / optical-model / gamma-strength parameters) as a separate optional DB + tools.
- **ENDF/B-VIII.0** evaluated cross sections (large; likely separate DB, reuse the same query/interpolation surface as JENDL).
- **XUNDL** as an unevaluated “latest experiments” layer complementing ENSDF.
- **KADoNiS** for MACS (if not relying solely on EXFOR’s MACS entries).
- **KTUY** theoretical mass predictions (lowest priority).

## References (local only)

- `/Users/fkg/Coding/Agents/autoresearch-nds/meta/docs/survey-nuclear-data-sources.md`
- `/Users/fkg/Coding/Agents/autoresearch-nds/meta/docs/nds-mcp-phase2-plan.md`

