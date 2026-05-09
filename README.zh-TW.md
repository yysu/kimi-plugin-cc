# kimi-plugin-cc

[English](./README.md) · **繁體中文**

一個給 Claude Code 用的外掛：把 Kimi 變成你的 **執行代理人**——Claude 負責規劃，Kimi 在隔離的 git worktree 裡寫 code，然後再用一個全新的 Kimi session 對著計畫書審查 diff。

> **為什麼要做這個外掛**
>
> Claude 擅長規劃跟對話，Kimi 擅長埋頭寫 code。這個外掛把交接做成明確的契約：一份結構化的 `plan.md` 是規格、一個 worktree 是工作區、一份遵守 JSON schema 的 review 是裁決。Kimi 動工的時候，你的主 repo 一個檔案都不會被碰到。

---

## 你會拿到什麼

| 指令 | 用途 |
|---|---|
| `/kimi:doctor` | 檢查 `kimi-cli`、`git`、Node 環境，並切換 review gate 開關。 |
| `/kimi:code <plan.md>` | 在新 worktree 裡叫 Kimi 依照 plan 實作。 |
| `/kimi:review` | 讓 Kimi 審 diff（目前未提交的變更、跟某 base branch 的差異、或某個 job 的 worktree）。 |
| `/kimi:adversarial-review` | 同樣的目標選擇邏輯，但姿態變成「找碴模式」（安全 / 正確性壓力測試）。 |
| `/kimi:status` / `/kimi:result` / `/kimi:cancel` | 管理進行中與已結束的 job。 |

另外提供 `kimi-coder` subagent —— 當你需要把較大的實作任務交出去，Claude 會自動引用。

---

## 環境需求

- **Node ≥ 24**（只用 `node:fs/promises`、`node:test` 等標準庫）。
- **Git** 在 `PATH` 中。
- **kimi-cli** 在 `PATH` 中而且已登入。安裝：<https://github.com/MoonshotAI/kimi-cli>，再執行 `kimi login`。

外掛 **零執行期相依套件**，整個都用 Node 標準庫實作。

---

## 安裝

```text
/plugin marketplace add yysu/kimi-plugin-cc
/plugin install kimi@kimi-plugin-cc
/reload-plugins
```

裝完跑一次：

```text
/kimi:doctor
```

---

## 計畫書（plan）格式

計畫書是一份附帶 YAML frontmatter 的 markdown 檔，本身就是契約：`/kimi:code` 沒拿到計畫書就拒跑，`/kimi:review` 會拿計畫書的欄位當審查依據。

```yaml
---
id: add-google-login                  # 必填，slug。會當成 job id 跟 branch 名稱用。
goal: |                                # 必填。
  加入 Google OAuth 登入流程，含 session cookie。
base_branch: main                      # 必填。
files_may_touch:                       # 必填，至少 1 條 glob。reviewer 會檢查有沒有越界。
  - src/auth/**
  - src/routes/login.ts
  - tests/auth/**
out_of_scope:                          # 必填，可給空陣列。明示哪些事不要做。
  - 重構既有的 session middleware
  - UI 重新設計
success_criteria:                      # 必填，至少 1 條。reviewer 的驗收 rubric。
  - tests/auth/ 底下所有測試通過
  - 使用者可以完成端到端登入
  - 沒有新的 ESLint warning
constraints:                           # 選填。
  - 不引入新的執行期套件
notes_for_kimi: |                      # 選填，自由格式上下文。
  OAuth client id 環境變數叫 GOOGLE_OAUTH_CLIENT_ID。
---

# 背景描述

frontmatter 下面的 markdown body 也會一起傳給 Kimi。
```

Schema 在 `plugins/kimi/schemas/plan.schema.json`。

---

## 一個典型流程

```text
# 1. 你跟 Claude 一起寫計畫書（不需要任何工具，就是個 .md）
$ cat plan.md

# 2. 把計畫書交給 Kimi
/kimi:code plan.md

#    → 在 ~/.kimi-plugin-cc/state/<repo-hash>/worktrees/<job> 開 worktree
#    → 在裡面跑 kimi --print --afk
#    → 抓 diff 跟最後一行 DONE: / BLOCKED: 契約

# 3. 讓 Kimi 審自己的 code
/kimi:review --job <job-id>

#    → 全新 Kimi session（絕不接續 coder 的 context）
#    → 輸出結構化 JSON 裁決（pass / needs-attention / block）

# 4. 對照 review 回饋在同一個 worktree 繼續修
/kimi:code plan.md --resume <job-id>

# 5. 滿意了？自己把 worktree branch merge 回主線，用你習慣的方式
$ git merge kimi/<job-id>
```

長任務加 `--background`，再用 `/kimi:status` 追進度。

---

## 狀態存在哪裡

所有 Kimi 相關的狀態都在你的 repo 之外：

```
~/.kimi-plugin-cc/state/<repo-hash>/
  jobs/<job-id>/
    meta.json         # 任務狀態（status、pid、exit code、verdict……）
    prompt.txt        # 真正送給 kimi 的 prompt
    stdout.jsonl      # kimi --output-format=stream-json 的輸出
    stderr.log
    diff.patch        # git diff vs base branch（code 任務）
    review.json       # 解析過的 review payload（review 任務）
    review.md         # 給人看的 review 報告
  worktrees/<job-id>/ # 真正的 git worktree
  config.json         # 此 repo 的外掛設定（如 review_gate_enabled）
```

`<repo-hash>` 是 `sha1(git toplevel 絕對路徑)` 取前 12 字元。不同 repo 永遠不會撞到。需要的話可以用 `KIMI_PLUGIN_STATE_DIR` 環境變數覆寫根目錄。

---

## 選用：Stop hook review gate

預設關閉。要開的話一個 repo 開一次：

```text
/kimi:doctor --enable-review-gate
```

開啟後，Claude Code 每次 `Stop` 事件都會觸發 Kimi 對當下未提交的 diff 做一次小型 review。如果 review 第一行是 `BLOCK: <reason>`，Claude 就會被擋下，被告知問題在哪、必須先處理。

> ⚠️ 這會讓 Claude 跟 Kimi 進入互相纏鬥的長 loop，吃 Kimi 配額很兇。**只有在你會盯著螢幕的時候開**。隨時可以用 `--disable-review-gate` 關掉。

實作在 `plugins/kimi/scripts/stop-gate-hook.mjs`。Hook 採「失敗即放行」原則——任何內部錯誤一律 ALLOW，永不變成擋路的牆。

---

## Review 的輸出長相

Reviewer 必須以這一行作結：

```
KIMI_REVIEW_JSON: {"verdict":"pass|needs-attention|block","summary":"…","findings":[…],"scope_check":{…},"next_steps":[…]}
```

Schema 在 `plugins/kimi/schemas/review-output.schema.json`。runner 退出碼會反映 verdict —— `0`（pass）、`1`（needs-attention）、`2`（block），方便 CI 跟 hook 用條件判斷。

每筆 finding 帶 `severity`（`critical`/`high`/`medium`/`low`/`nit`）、`confidence`（0-1）、選填 `category`（correctness、security、scope-violation、missing-criterion……）。

---

## 兩段話講完架構

外掛是一個輕量的 Node 24 dispatcher（`runner.mjs`），對外就是 `kimi --print --afk` 的 shell 呼叫。沒有 daemon、沒有 broker、沒有 IPC。會話延續用 kimi-cli 自己提供的 `--continue`（依 cwd 持久化的 session）。每一個 `code` job 都會拿到一個位於 `~/.kimi-plugin-cc/` 底下的獨立 worktree，所以 Kimi 連手滑碰到你 working tree 的可能都沒有。

失敗模式都明文處理：kimi exit code 75（rate limit / 5xx / timeout）會自動重試一次；exit 0 但最後一行是 `BLOCKED:` 會被標成 `blocked` 而不是 `done`；Stop hook 任何內部錯誤一律放行。`Plan → Code → Review` 的邊界靠分離 Kimi session 強制——reviewer 永遠是新人視角，從來不接續 coder。

---

## 為什麼**不**裝 broker？

`kimi-cli` 本身就把 session 寫到磁碟，提供 `kimi --continue` 跟 `kimi --resume <id>`。一個常駐 broker 頂多省 1–3 秒冷啟動，但代價是一堆難 debug 的失敗模式（stale socket、zombie、broker 一掛所有 job 連坐、單 broker 變瓶頸）。每次 one-shot CLI 呼叫反而更簡單、更平行、crash 也是局部的。

外掛裡的 `runKimiWithRetry()` 是預留好的縫——將來真要塞 broker 就在這替換，不會動到 plan/worktree/review 那層。

---

## 開發

```sh
# 跑測試（不需要真的 kimi —— 用 tests/fake-kimi-bin/kimi 假 binary）
npm test

# 升版本（同步更新 package.json + plugin.json）
npm run bump 0.2.0
```

測試套件用 `node --test` 加 PATH 上的假 kimi。CI 在 Node 24 上跑（見 `.github/workflows/ci.yml`）。

---

## 致謝

設計過程參考了 `MoonshotAI/kimi-cli` 公開的 CLI 介面，以及 `openai/codex-plugin-cc` 所示範的 Claude Code 外掛模式。本 repo 程式碼皆為原創，未複製上述兩個專案的任何原始碼。

## 授權

MIT —— 詳見 `LICENSE`。
