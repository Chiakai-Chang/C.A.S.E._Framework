# recurrent／MTP 快取唯讀查核（2026-09-06）

範圍：核對本機 ROCmFPX source、Git 歷史、建置中繼資料與 llama.cpp 上游一手議題。本筆記沒有執行生成、重啟服務或更動模型／BAT；CASE 全流程 `cache_prompt:false` 對照由主線另行記錄。多 session 失敗、獨立 report packet 成功是交辦背景，本文未重新驗證。

## 結論與已證實事項

**跨請求 prefix reuse／recurrent checkpoint 是合理待驗方向，但不能把 #21681 或 #20700 當成本機已確認根因。** 本機已採較新的 MTP 與 checkpoint 實作，而且也有 fork 自己的後續修正。工具反覆讀取是語意失敗，與上游報告的數字脫落、全量重算或當機並非同一症狀。

本機 `D:/MyProject/ROCmFPX` HEAD 是 `776183047c671e432b0e8236c79fbbf7a3c6962b`（2026-09-02）。查核時只有 `AI_CHANGES.md` 修改及 `.claude/` 未追蹤，相關 C++ 無未提交修改。`build-win-hip-ninja/common/build-info.cpp` 宣告 build `11500`、commit `776183047`、Clang 21.0.0、Windows AMD64；BAT 指向該目錄的 `bin/llama-server.exe`，檔案最後修改時間為 2026-09-02 19:21:28。**這些不是目前運行程序及 DLL 的身分證明**，尚未據此宣稱服務正在跑同一版本。

BAT 確實設定指定 STRIX_LEAN GGUF、froggeric-v22.4、`--reasoning-preserve`、`-c 262144 -np 1 -b 2048 -ub 1024` 與 `--spec-type draft-mtp --spec-draft-n-max 3 --spec-mtp-strict-qwen`。BAT 註解也明說該特定模型的深 context 多輪驗證尚未完成；其中短工具測試成功不應擴張成 CASE 品質證據。

## 修正是否已在本機

| 一手來源 | 本機核對與判讀 |
|---|---|
| [#21681](https://github.com/ggml-org/llama.cpp/issues/21681) | 報告者以 `84ae843`、Qwen3.5 MoE、CUDA，在修改歷史中段後出現數字脫落；同一最終 payload 冷啟動重播可成功。頁面標記 `bug-unconfirmed`，`copy_cell` 是候選原因。它支持做快取對照，未證明 CASE 同因。 |
| [#20700](https://github.com/ggml-org/llama.cpp/pull/20700) | 該 FastMTP PR 已關閉、未合併；內含 `copy_cell` 元素數／byte 數修正提案。本機整個 `src/` 搜尋沒有 `copy_cell`，`llama-memory-recurrent.cpp` 也沒有 `ggml_view_1d`。不能說本機「漏了這個函式的一行修正」，也不能只據無該函式保證 recurrent 正確。 |
| [正式 MTP #22673](https://github.com/ggml-org/llama.cpp/pull/22673) | 本機 `255582687` 是 HEAD 祖先（`merge-base --is-ancestor` 回傳 0）；另含 `d14ce3dab` MTP clean-up #23269。不能用早期 FastMTP 分支的故障推定目前 MTP 實作相同。 |
| [#22384](https://github.com/ggml-org/llama.cpp/issues/22384)、[#24055](https://github.com/ggml-org/llama.cpp/issues/24055) | 議題主軸是 checkpoint 無效造成重算。本機搜尋條件已含 `cur.pos_max > pos_next` 排除及 `cur.pos_min == 0` 特例；建立 checkpoint 不再使用所報 `n_tokens >= 64` 條件。仍不能聲稱套用了議題中全部提案：本機沒有原文的 hybrid 專用 `return cur.pos_max <= pos_next` 分支，實作已演進。 |
| [#24110](https://github.com/ggml-org/llama.cpp/pull/24110) | 上游已合併；本機歷史含 `0e11ecbb9`／`6f3a9f3de`，目前 `server-context.cpp:3318` 依 `has_new_tokens` 決定是否減 1，這項避免不必要 restore 的行為已在 source。 |
| fork `0ef57fb813c5e965528e63928eb9dcd29e2addac` | 已確認是 HEAD 祖先，`git show` 可重查。它在 `common/speculative.cpp` 處理空 `data_spec`：清除 MTP pending／verify 狀態、重設 `i_last` 與 drafting；HEAD merge 訊息也明列 checkpoint restore tolerance fix。本機另含 spec-boundary rollback、M-RoPE position、replay livelock 修正歷史。這些是程式證據，不是本次工具失敗已消除的實測證據。 |
| [#26827](https://github.com/ggml-org/llama.cpp/pull/26827)、[#28252](https://github.com/ggml-org/llama.cpp/issues/28252) | 報告 MTP 多 ubatch 在 CUDA 多 GPU tensor split 長 prefill 的主機卡死，提案是逐 ubatch 同步。本機未找到 `mtp_multi_ubatch` 專用同步補丁，decode 結尾仍有註解掉的 `synchronize()`。但那不足以判定所有等價修正皆不存在；更不應把 CUDA 卡死外推成本機 ROCm 語意錯誤。此項優先度低於 prefix reuse 對照。 |

本機程式查核位置均以 HEAD 為準：`src/llama-memory-recurrent.cpp`、`src/llama-context.cpp`、`common/speculative.cpp`、`tools/server/server-context.cpp`。外部 issue 是報告者的一手觀察與提案，不自動等於維護者已確認的根因。

## `cache_prompt:false` 在 OpenAI chat 路由確實有接線

本機 source 的完整路徑如下，並非只支援 `/completion`：

1. `server-context.cpp:4984` 的 `post_chat_completions` 把 JSON 送到 `oaicompat_chat_params_parse`。
2. `server-common.cpp:1391` 起把尚未處理的頂層欄位複製到 `llama_params`；此前沒有覆寫 `cache_prompt`。
3. `server-context.cpp:4368` 將轉換後的 `data` 送入 `server_schema::eval_llama_cmpl_schema`；`server-schema.cpp:31` 把 `cache_prompt` 綁到 `task_params.cache_prompt`，`:540` 起逐欄位 evaluate。
4. `server-context.cpp:3242` 只有 true 才算 common prefix；false 分支（`:3311`）明確設 `n_past = 0`，後續 `n_past > 0` 的舊 checkpoint restore 路徑不進入。

因此，若主線送出的 HTTP JSON 頂層確實含 boolean false，且服務 binary 對應此 source，這個實驗能隔離「跨請求沿用舊 prefix」；**它沒有停用 MTP，也不等於完整重啟程序**。`--cache-ram 0` 只控制 `server_prompt_cache` 的配置（`server-context.cpp:1391`），與 request 的 `cache_prompt` 不應混稱同一開關。

## 待驗假說與不干擾服務的查證

- **H1：跨 session 的 prefix／checkpoint 恢復影響結果。** 先分析既有 HTTP payload：失敗前是否改動歷史中段、template／工具定義、系統提示或工作目錄，造成共同前綴退回；讀既有 server 日誌的 `n_past`、`restored context checkpoint`、`forcing full prompt re-processing` 與 `erased invalidated context checkpoint`。不同工作目錄本身不會清除 server slot。
- **H2：MTP 或單請求長上下文仍有問題。** 若主線每次 false 仍失敗，H1 的必要性下降，但不能因此排除 MTP。此輪不改 MTP；後續要比較同一 payload／採樣設定、MTP 開關與 cache 開關，應另行安排隔離服務，避免干擾現用程序。
- **H3：任務脈絡／工具結果或採樣差異足以解釋表現。** 成功的 report packet 與失敗全流程不是完全相同請求。先離線比對材料與工具事件，再解讀快取對照；不要把一次成功視為修好。source 文件也提醒 prefix reuse 與全 prefill 的不同 batch 形狀不保證逐 bit 相同（`tools/server/README.md:589`）。
- **版本核對仍可唯讀完成：** 讀運行程序的 executable path／命令列與載入 DLL 路徑、既有啟動日誌的 build 行，或服務 GET `/props` 的 `build_info`；與上述 HEAD／generated build info 比對。缺任何一段就保留「source 已含、運行版本待驗」的區分。此筆記未另行向服務發生成請求。

驗證限制：本輪只有來源與連結核對，未跑 kit／模型測試，未對效益或根因作驗收宣稱。

主線補查：運行服務 GET `/props` 回傳 `build_info: "b11500-776183047"`，與上述 source／generated build info 相符，模型路徑與 context 262144 也符合 BAT。這補上服務自報版本，仍不是所有載入 DLL 的獨立身分核驗。第 12 次整案關閉 prefix reuse 後在規劃階段失敗，沒有走到報表，無法判定晚期讀取循環是否同因；同一報表工作包的獨立 cache 開／關探測都成功。完整結果見[核心修復報告](../evaluation/case-core-repair-report.md)。
