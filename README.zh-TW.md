# kimi-plugin-cc

[English](./README.md) · **繁體中文**

一個給 Claude Code 用的外掛：把 Kimi 變成你的 **執行代理人**——Claude 負責規劃，Kimi 在隔離的 git worktree 裡寫 code，然後再用一個全新的 Kimi session 對照計畫書審查 diff。

> **為什麼要做這個外掛**
>
> Claude 擅長規劃跟對話，Kimi 擅長埋頭寫 code。這個外掛把交接做成明確的契約：一份結構化的 `plan.md` 是規格、一個 worktree 是工作區、一份遵守 JSON schema 的 review 是裁決。Kimi 動工的時候，你的主 repo 一個檔案都不會被碰到。

---

## 你會拿到什麼

| 指令 | 用途 |
|---|---|
| `/kimi:doctor` | 檢查 `kimi-cli`、`git`、Node、Kimi 最低版本，並切換 review gate 開關。 |
| `/kimi:plan` | 把當前對話結晶成結構化的 `plan.md`、驗證、寫到 per-repo 的 plans 目錄、印出路徑。**不會跑 Kimi**。 |
| `/kimi:code [<plan.md>]` | 在新 worktree 裡叫 Kimi 依照 plan 實作，**完成後自動接 review**。**不傳路徑時**，Claude 會自己從當前對話起一份 plan、給你看一眼、確認後才動工。`--no-review` 關自動審查。 |
| `/kimi:review [<plan.md>]` | 讓 Kimi 審 diff。傳 `plan.md` 進去就會自動找該 plan 最新的 code job 來審；不傳就審當下未提交的變更。 |
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

純對話流程——不用先寫 plan 檔：

```text
# 1. 跟 Claude 在 chat 裡討論你想做什麼。不需要先寫檔案。

# 2. 交出去。
/kimi:code

#    → Claude 把對話結晶成 plan，貼出來給你看
#    → 你確認後才動工：plan 落地到 ~/.kimi-plugin-cc/state/<hash>/plans/
#    → 在 ~/.kimi-plugin-cc/state/<hash>/worktrees/<job> 開 worktree
#    → Kimi（write-capable agent profile）在裡面實作
#    → 跑完後審查：檢查寫入都沒越界跑出 worktree
#    → 自動用 Kimi（read-only agent profile）審 diff
#    → 印出 verdict（pass / needs-attention / block），exit code 0/1/2

# 3. 對照 review 回饋繼續修
/kimi:code <第 2 步印出的 plan 路徑> --resume <job-id>

# 4. 滿意了？自己把 worktree branch merge 回主線
$ git merge kimi/<job-id>
```

如果你想先看 plan 落地後再下指令動 code：

```text
/kimi:plan        # 寫 plan、印出路徑、停在這
/kimi:code <印出的路徑>
```

`plan.md` 是你主要使用的識別物。雖然 Job ID 會印在輸出中，但大部分操作（如審查）都可以直接透過 `plan.md` 完成，減少手動輸入 ID 的需求。

### 執行模式

| 模式 | 什麼時候用 |
|---|---|
| （預設）foreground | 互動使用。卡住等到完成；自動接 review。 |
| `--wait` | 從 Claude 用 `Bash(run_in_background: true)` 呼叫時。跟預設一樣會等到完成，但會每 30 秒輸出一次心跳，不讓背景 bash 看起來卡死。 |
| `--background` | 長任務。馬上回 prompt，之後用 `/kimi:status` 追。**自動審查不會跑**——完工後請用 `/kimi:review plan.md`。 |
| `--no-review` | 跳過自動審查鏈（預設 code 跑完會接 review）。 |

`--timeout-ms <N>`（或 `KIMI_TIMEOUT_MS` 環境變數）可以對單次 Kimi 呼叫設上限，預設無限。

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
  plans/<slug>-<ts>.md # /kimi:plan 或自動 fallback 寫出來的 plan
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

外掛是一個輕量的 Node 24 dispatcher（`runner.mjs`），其運作方式是透過 `kimi --print --afk` 的 shell 呼叫。沒有 daemon、沒有 broker、沒有 IPC。會話延續用 kimi-cli 自己提供的 `--continue`（依 cwd 持久化的 session）。每一個 `code` job 都會拿到一個位於 `~/.kimi-plugin-cc/` 底下的獨立 worktree，所以 Kimi 連手滑碰到你 working tree 的可能都沒有。

失敗模式都明文處理：kimi exit code 75（rate limit / 5xx / timeout）會自動重試一次；exit 0 但最後一行是 `BLOCKED:` 會被標成 `blocked` 而不是 `done`；Stop hook 任何內部錯誤一律放行。`Plan → Code → Review` 的邊界用兩種方式強制：分離 Kimi session（reviewer 從來不接續 coder）**加上**分離 Kimi `--agent-file` profile。reviewer 的 profile 排除了 Shell、WriteFile、StrReplaceFile、`Agent` 工具跟 web 工具——read-only 是 Kimi 端的工具邊界，不是 prompt 上的口頭保證。

## Worktree 容納 + 後審查

`/kimi:code` 在 `~/.kimi-plugin-cc/state/<repo-hash>/worktrees/<job-id>/` 跑 Kimi，並透過 `--work-dir` 讓 Kimi 的相對路徑都解析到那裡。跑完後，runner 會掃 `stdout.jsonl` 找有沒有任何 `WriteFile` / `StrReplaceFile` 工具呼叫指到 worktree 外。任何路徑（含 `../../etc/x` 這種越界）都會被 resolve 成最終實際位置再做容納檢查。發現越界就把 job 標成 `blocked`，錯誤原因會顯示在 `/kimi:status`，worktree 留著給你檢查、不會自動 merge。

這**不是 sandbox**——`Shell` 還是可以下 `cat /etc/passwd`——但 worktree 本來就是用完即丟，你的真正 working tree 完全不受影響，後審查能擋下最常見的寫入越界。要更緊的隔離，請把 Claude Code 整個跑在 container 裡。

---

## 為什麼**不**裝 broker？

`kimi-cli` 本身就把 session 寫到磁碟，提供 `kimi --continue` 跟 `kimi --resume <id>`。一個常駐 broker 頂多省 1–3 秒冷啟動，但代價是一堆難 debug 的失敗模式（stale socket、zombie、broker 一掛所有 job 連坐、單 broker 變瓶頸）。每次 one-shot CLI 呼叫反而更簡單、平行友善、crash 也是局部的。

外掛裡的 `runKimiWithRetry()` 是預留好的接縫——將來真要塞 broker 就在這替換，不會動到 plan/worktree/review 那層。

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
