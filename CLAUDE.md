# 份子钱记账本 — 开发说明（给下次开工的自己）

## 项目是什么
个人用的人情往来（份子钱）记账网页。纯前端、零依赖、无构建；数据存 `localStorage`（key `fzq_data_v1`）。
用户：cmysdd，中文界面，非开发者。仓库 https://github.com/cmysdd/fenziqian ，网页版 https://cmysdd.github.io/fenziqian/ （GitHub Pages，main 分支根目录）。

## 文件
| 文件 | 作用 |
|---|---|
| `index.html` | 骨架：顶栏 Tab、`#view` 容器、`#modalRoot`/`#toastRoot`、PWA meta |
| `style.css` | 浅色主题；`@media (max-width:760px)` 手机布局；`@media print` 打印 |
| `app.js` | 全部逻辑，一个 IIFE，按段落注释分区（见下） |
| `manifest.json` / `sw.js` / `icons/` | PWA 安装与离线缓存 |
| `启动记账本.vbs` | 本地用浏览器 `--app=` 模式打开（无地址栏），ASCII 内容，勿写中文注释（WSH 按 ANSI 读） |

## app.js 结构（按文件内注释块顺序）
1. **工具**：`$ $$ uid esc today money sum byDateDesc/Asc daysBetween`
2. **数据层**：`state = {contacts, events, records, settings, meta}`，`load()/save()`；`contactById/eventById/displayName`（同名时带单位）
3. **统计核心**：`recordsOf({contactId,eventId}) totals(recs) balanceOf(contactId) groupBy`
   方向约定：`in` = 对方给我（红 +），`out` = 我给对方（绿 −）；差额 = in − out，正数表示我欠人情
4. **弹窗/提示**：`openModal(html)` 返回 mask，`closeModal() toast(msg,isError) confirmDialog()`；表单用 `formData(form)` 取值
5. **表单**：`contactForm eventForm recordForm(r, presets)`；`resolveContact(name,unit,dept,knownId,{quiet})` 找到或新建联系人（记一笔和语音批量共用）
   - `recordForm` 的 `presets` 支持 `eventId direction amount date method note unit dept contactName`；「保存并继续」把除姓名外全部字段作为 presets 再开一次
   - `bindContactAutocomplete(input, hiddenIdInput, onPick)` 姓名联想，onPick(null) 表示输入了新名字
6. **语音/文字批量录入**：`cnToNumber` `extractAmount` `parseClause(raw, defaults)` `parseBatchText` `voiceBatchForm(presets)`
   - 解析顺序：方向词 → 支付方式词 → 已有联系人名（长名优先）→ 金额 → 括号备注 → 去填充词 → 分词归位（单位/科室后缀 `DEPT_SUFFIX`，>6 字进备注）
   - 中文金额必须带 百/千/万 或 元/块/钱 后缀，避免把「张三」「王五」里的数字当金额；「王五五百」把多余前导数字还给姓名
   - 听写用 Web Speech API（`continuous`），Chrome 在国内常 `network` 错误 → 提示用 Edge
7. **路由**：hash 路由 `#/home #/records #/events[/id] #/contacts[/id] #/stats #/settings`；`render()` 重绘整页；`bindPage(view)` 只绑定一次，靠 `data-act` 事件委托（`edit-record add-record voice-add edit-contact add-contact edit-event add-event del-record toggle print export-event-csv`）
8. **页面**：`pageHome pageRecords(filteredRecords, recFilter) pageEvents pageEventDetail pageContacts(contactView) pageContactDetail pageStats(statsYear, bars()) pageSettings(installCard)`；`recordsTable(recs, opts)` 与 `statCards(t)` 复用
9. **导入导出**：`download() csv()`（带 BOM）`exportRecordsCsv exportEventCsv exportContactsCsv exportJson importJson`（合并按 id 去重 / 覆盖）
10. **示例数据** `loadDemo()`；**页面级绑定** 在 `render` 包装器里按 page 绑定 id 元素；末尾 PWA `beforeinstallprompt` 与 `serviceWorker.register`（仅 http/https）

## 约定与坑
- 页面靠字符串模板渲染，所有用户输入输出前过 `esc()`。
- `render` 是函数声明后又被包装重赋值（`origRender`），在包装器里给页面上的 id 元素绑事件；新页面的事件绑定放那里。
- 筛选输入框重绘后要手动恢复焦点（records 页有示例）。
- 无头 Chrome 最小窗口 500px，测手机布局要用 390px 的 iframe 包一层。
- **改任何静态文件后把 `sw.js` 的 `CACHE_VERSION` +1**，否则已安装的 PWA 不更新。
- 本地 file:// 版与 Pages 网页版数据不互通（不同 origin），迁移靠 JSON 导出/导入。
- git 根目录就是本文件夹（不是上一级）。

## 测试方法（无测试框架）
写一个临时 `_test.html`：复制 index.html 骨架 + `localStorage.clear()` + `<script src="app.js">`，再用脚本点按钮、改 hash、读 DOM，把结果写进 `<pre id="report">`，然后：
```
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --allow-file-access-from-files --virtual-time-budget=8000 --dump-dom "file:///C:/Users/Administrator/Desktop/份子钱记账本/app/_test.html" | sed -n '/===REPORT===/,/===END===/p'
```
截图：`--window-size=1280,1000 --screenshot=x.png`。测完删掉 `_test*.html`。语法检查：`node --check app.js`。

## 发布
```
git add -A && git commit -m "..." && git push        # 偶发 Connection reset，重试即可
```
Pages 自动部署，约 1 分钟生效。凭据在 Git Credential Manager（`git credential fill` 可取 token 调 GitHub API；JSON 里有中文时写文件用 `--data-binary @file`）。

## 待办 / 可做的下一步
- 语音解析：姓名紧贴中文金额且姓名含数字（如「钱十一六百」）会算错，目前靠核对表手改
- 多设备同步（目前只有手动 JSON 备份）
- 深色模式（用户当初选了不需要）
