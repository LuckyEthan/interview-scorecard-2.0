function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getLevel(levels, percent) {
  return levels.find((level) => percent >= level.min)?.label ?? 'Unknown';
}

function uid(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 9);
}

// ========== 转录解析 / 自动评分 / 自动总结 ==========

/**
 * 检测转录文本的格式类型
 * @param {string} text 原始转录文本
 * @returns {'tencent'|'feishu'|'srt'|'vtt'|'plain'}
 */
function detectTranscriptFormat(text) {
  const lines = text.trim().split('\n').slice(0, 20);
  const joined = lines.join('\n');

  // SRT: 序号 + 时间戳 00:01:23,456 --> 00:01:25,789
  if (/\d+\r?\n\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/.test(joined)) {
    return 'srt';
  }
  // WebVTT
  if (/^WEBVTT/i.test(joined) || /\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}/.test(joined)) {
    return 'vtt';
  }
  // 腾讯会议: "发言人名称  HH:MM:SS" 或 "名称 (HH:MM:SS)"
    if (/^.{1,20}\s+(?:\d{4}\/\d{2}\/\d{2}\s+)?\d{2}:\d{2}:\d{2}\s*$/m.test(joined)) {
      return 'tencent';
    }
    // 飞书: "HH:MM:SS 名称" 或 "名称 HH:MM" 或 "名称(HH:MM:SS)"
    if (/^\d{2}:\d{2}(:\d{2})?\s+.+/m.test(joined) || /^.+\s+\d{2}:\d{2}$/m.test(joined) || /^.+\(\d{2}:\d{2}:\d{2}\)/m.test(joined)) {
      return 'feishu';
    }
  return 'plain';
}

/**
 * 解析腾讯会议转录格式
 * 格式: "发言人  HH:MM:SS\n内容" 或 "发言人(HH:MM:SS)\n内容"
 */
function parseTencentMeeting(text) {
  const result = [];
    const blocks = text.trim().split(/\n(?=\S+\s+(?:\d{4}\/\d{2}\/\d{2}\s+)?\d{2}:\d{2}:\d{2})|(?=\S+\(\d{2}:\d{2}:\d{2}\))/);
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length < 1) continue;
      const headerMatch = lines[0].match(/^(.+?)\s+(?:\d{4}\/\d{2}\/\d{2}\s+)?(\d{2}:\d{2}:\d{2})\s*$/) ||
                           lines[0].match(/^(.+?)\((\d{2}:\d{2}:\d{2})\)/);
    if (headerMatch) {
      const speaker = headerMatch[1].trim();
      const time = headerMatch[2];
      const content = lines.slice(1).join(' ').trim();
      if (content) {
        result.push({ speaker, time, text: content });
      }
    }
  }
  return result;
}

/**
 * 解析飞书转录格式
 * 格式: "HH:MM:SS 发言人\n内容" 或 "发言人 HH:MM\n内容"
 */
function parseFeishu(text) {
  const result = [];
  const blocks = text.trim().split(/\n(?=\d{2}:\d{2}(:\d{2})?\s+)|(?=\S+\s+\d{2}:\d{2}\n)/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 1) continue;
    const m1 = lines[0].match(/^(\d{2}:\d{2}(:\d{2})?)\s+(.+)$/);
    const m2 = lines[0].match(/^(.+?)\s+(\d{2}:\d{2})$/);
    if (m1) {
      const time = m1[1];
      const speaker = m1[3].trim();
      const content = lines.slice(1).join(' ').trim();
      if (content) result.push({ speaker, time, text: content });
    } else if (m2) {
      const speaker = m2[1].trim();
      const time = m2[2];
      const content = lines.slice(1).join(' ').trim();
      if (content) result.push({ speaker, time, text: content });
    }
  }
  return result;
}

/**
 * 解析 SRT 字幕格式
 */
function parseSRT(text) {
  const result = [];
  const blocks = text.trim().split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2}),\d{3}\s*-->/);
    if (timeMatch) {
      const time = timeMatch[1];
      const content = lines.slice(2).join(' ').trim();
      // 尝试提取 SRT 中的说话人标记 <v Speaker>
      const speakerMatch = content.match(/^<v\s+(.+?)>/);
      const speaker = speakerMatch ? speakerMatch[1] : 'Speaker';
      const cleanText = content.replace(/<\/?v[^>]*>/g, '').trim();
      if (cleanText) result.push({ speaker, time, text: cleanText });
    }
  }
  return result;
}

/**
 * 解析 WebVTT 字幕格式
 */
function parseVTT(text) {
  const result = [];
  const body = text.replace(/^WEBVTT[^\n]*\n/i, '').trim();
  const blocks = body.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    let timeLineIdx = lines.findIndex(l => /\d{2}:\d{2}:\d{2}\.\d{3}\s*-->/.test(l));
    if (timeLineIdx === -1) continue;
    const timeMatch = lines[timeLineIdx].match(/(\d{2}:\d{2}:\d{2})\.\d{3}\s*-->/);
    const time = timeMatch ? timeMatch[1] : '00:00:00';
    const content = lines.slice(timeLineIdx + 1).join(' ').trim();
    const speakerMatch = content.match(/^<v\s+(.+?)>/);
    const speaker = speakerMatch ? speakerMatch[1] : 'Speaker';
    const cleanText = content.replace(/<\/?v[^>]*>/g, '').trim();
    if (cleanText) result.push({ speaker, time, text: cleanText });
  }
  return result;
}

/**
 * 解析纯文本格式（按行分割，尝试识别说话人前缀）
 */
function parsePlainText(text) {
  const result = [];
  const lines = text.trim().split('\n').filter(l => l.trim());
  for (const line of lines) {
    const m = line.match(/^([^:：]{1,20})[：:]\s*(.+)$/);
    if (m) {
      result.push({ speaker: m[1].trim(), time: '', text: m[2].trim() });
    } else {
      result.push({ speaker: 'Unknown', time: '', text: line.trim() });
    }
  }
  return result;
}

/**
 * 统一转录解析入口
 * @param {string} text 原始转录文本
 * @param {string} format 格式类型，'auto' 则自动检测
 * @returns {Array<{speaker:string, time:string, text:string}>}
 */
function parseTranscript(text, format) {
  if (!text || !text.trim()) return [];
  const fmt = (format === 'auto' || !format) ? detectTranscriptFormat(text) : format;
  switch (fmt) {
    case 'tencent': return parseTencentMeeting(text);
    case 'feishu':  return parseFeishu(text);
    case 'srt':     return parseSRT(text);
    case 'vtt':     return parseVTT(text);
    default:        return parsePlainText(text);
  }
}

/**
 * 从文本中提取关键词（去除停用词，转小写，去重）
 */
function extractKeywords(text) {
  const stopWords = new Set([
    'the','a','an','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could',
    'should','may','might','shall','can','need','dare','ought',
    'to','of','in','for','on','with','at','by','from','as',
    'into','through','during','before','after','above','below',
    'between','under','again','further','then','once','here',
    'there','when','where','why','how','all','each','every',
    'both','few','more','most','other','some','such','no','nor',
    'not','only','own','same','so','than','too','very','just',
    'and','but','or','if','while','because','that','this','it',
    'i','you','he','she','we','they','me','him','her','us','them',
    '的','了','在','是','我','有','和','就','不','人','都','一',
    '个','上','也','很','到','说','要','去','你','会','着','没有',
    '看','好','自己','这','他','她','它','们','那','么','什么',
    '吗','呢','吧','啊','哦','嗯','对','可以','因为','所以',
    '但是','如果','虽然','然后','或者','还是','已经','正在'
  ]);
  const words = text.toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w));
  return [...new Set(words)];
}

/**
 * 在转录记录中查找与关键词最匹配的片段
 */
function findSnippet(transcriptEntries, keywords) {
  let bestScore = 0;
  let bestSnippet = '';
  for (const entry of transcriptEntries) {
    const entryWords = extractKeywords(entry.text);
    const matched = keywords.filter(kw => entryWords.includes(kw));
    const score = matched.length;
    if (score > bestScore) {
      bestScore = score;
      bestSnippet = entry.text.length > 120
        ? entry.text.substring(0, 120) + '...'
        : entry.text;
    }
  }
  return { score: bestScore, snippet: bestSnippet };
}

/**
 * 基于转录内容对每道题目进行自动评分
 * @param {Array} transcriptEntries 解析后的转录条目
 * @param {Object} config 问卷配置
 * @returns {Array<{sectionTitle:string, questionLabel:string, score:number, matchRatio:number, snippet:string}>}
 */
function autoScoreFromTranscript(transcriptEntries, config) {
  if (!transcriptEntries || !transcriptEntries.length || !config || !config.sections) {
    return [];
  }
  const results = [];
  const allTranscriptText = transcriptEntries.map(e => e.text).join(' ');
  const allTranscriptKeywords = extractKeywords(allTranscriptText);

  for (const section of config.sections) {
    for (const question of (section.questions || [])) {
      const label = question.label || question.question || '';
      // 从题目标签+期望答案中提取关键词
      const expectedText = label + ' ' + (question.expected || '') + ' ' + (question.answer || '');
      const expectedKeywords = extractKeywords(expectedText);

      if (expectedKeywords.length === 0) {
        results.push({
          sectionTitle: section.title || '',
          questionLabel: label,
          score: 0,
          matchRatio: 0,
          snippet: 'No keywords to match'
        });
        continue;
      }

      // 计算关键词匹配率
      const matchedKw = expectedKeywords.filter(kw => allTranscriptKeywords.includes(kw));
      const ratio = matchedKw.length / expectedKeywords.length;

      // 在转录中找到最相关的片段
      const { snippet } = findSnippet(transcriptEntries, expectedKeywords);

      // 评分: ratio >= 0.6 -> 2分, >= 0.3 -> 1分, < 0.3 -> 0分
      let score = 0;
      if (ratio >= 0.6) score = 2;
      else if (ratio >= 0.3) score = 1;

      results.push({
        sectionTitle: section.title || '',
        questionLabel: label,
        score,
        matchRatio: Math.round(ratio * 100),
        snippet: snippet || 'No relevant content found'
      });
    }
  }
  return results;
}

/**
 * 根据自动评分结果生成总结报告
 * @param {Array} scoreResults autoScoreFromTranscript 返回的结果
 * @param {Object} config 问卷配置
 * @returns {string} Markdown 格式的总结报告
 */
function generateSummary(scoreResults, config) {
  if (!scoreResults || !scoreResults.length) {
    return '暂无评分数据，无法生成总结。';
  }

  const totalScore = scoreResults.reduce((sum, r) => sum + r.score, 0);
  const maxScore = scoreResults.length * 2;
  const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

  const grading = config && config.grading ? config.grading : {
    veryStrong: 85, good: 70, average: 50
  };
  let level = 'Insufficient';
  if (percentage >= (grading.veryStrong || 85)) level = 'Very Strong';
  else if (percentage >= (grading.good || 70)) level = 'Good';
  else if (percentage >= (grading.average || 50)) level = 'Average';

  // 按 section 分组统计
  const sectionMap = {};
  for (const r of scoreResults) {
    const key = r.sectionTitle || 'General';
    if (!sectionMap[key]) sectionMap[key] = { total: 0, max: 0, items: [] };
    sectionMap[key].total += r.score;
    sectionMap[key].max += 2;
    sectionMap[key].items.push(r);
  }

  let report = '';
  report += `📊 总体评分: ${totalScore} / ${maxScore} (${percentage}%)\n`;
  report += `📋 综合等级: ${level}\n\n`;

  // 各 section 详情
  report += '--- 各部分详情 ---\n\n';
  for (const [title, data] of Object.entries(sectionMap)) {
    const secPct = data.max > 0 ? Math.round((data.total / data.max) * 100) : 0;
    report += `【${title}】 ${data.total}/${data.max} (${secPct}%)\n`;
    for (const item of data.items) {
      const icon = item.score === 2 ? '✅' : item.score === 1 ? '⚠️' : '❌';
      report += `  ${icon} ${item.questionLabel} — ${item.score}/2 (匹配 ${item.matchRatio}%)\n`;
    }
    report += '\n';
  }

  // 优势与劣势
  const strengths = scoreResults.filter(r => r.score === 2);
  const weaknesses = scoreResults.filter(r => r.score === 0);

  if (strengths.length > 0) {
    report += '✨ 优势领域:\n';
    for (const s of strengths.slice(0, 5)) {
      report += `  • ${s.questionLabel}\n`;
    }
    report += '\n';
  }

  if (weaknesses.length > 0) {
    report += '⚠️ 待改进领域:\n';
    for (const w of weaknesses.slice(0, 5)) {
      report += `  • ${w.questionLabel}\n`;
    }
    report += '\n';
  }

  // 录用建议
  report += '--- 录用建议 ---\n';
  if (level === 'Very Strong') {
    report += '🎉 强烈推荐录用。候选人在各方面表现优异。\n';
  } else if (level === 'Good') {
    report += '👍 建议录用。候选人整体表现良好，部分领域可进一步提升。\n';
  } else if (level === 'Average') {
    report += '🤔 需谨慎考虑。候选人达到基本要求，但多个领域表现一般。\n';
  } else {
    report += '❌ 不建议录用。候选人未能达到岗位基本要求。\n';
  }

  return report;
}

// ========== 结束: 转录解析 / 自动评分 / 自动总结 ==========

function emptyState() {
  return {
    meta: {
      title: 'New questionnaire',
      subtitle: 'Describe the context of the test here',
      maxScorePerQuestion: 2
    },
    grading: {
      labels: { "2": "Correct", "1": "Partial", "0": "Incorrect" },
      globalLevels: [
        { min: 85, label: 'Very strong' },
        { min: 70, label: 'Good' },
        { min: 50, label: 'Average / needs improvement' },
        { min: 0, label: 'Insufficient' }
      ]
    },
    sections: []
  };
}

let editorState = null;
let currentQuestionnaireFileName = '';
let _currentTranscript = null;
let _lastScoreResults = null;

function persistState() {
  try {
    if (editorState) {
      localStorage.setItem('app.interview.config', JSON.stringify(editorState));
      localStorage.setItem('app.interview.filename', currentQuestionnaireFileName || '');
    }
  } catch (e) {
    console.warn('Could not persist questionnaire to localStorage', e);
  }
}

function loadPersistedState() {
  try {
    const stored = localStorage.getItem('app.interview.config');
    if (stored) {
      const parsed = JSON.parse(stored);
      currentQuestionnaireFileName = localStorage.getItem('app.interview.filename') || '';
      return parsed;
    }
  } catch (e) {
    console.warn('Could not restore questionnaire from localStorage', e);
  }
  return null;
}

function setLoadStatus(message) {
  const el = document.getElementById('loadStatus');
  if (el) el.textContent = message || '';
}

function setEditorStatus(message, isError = false) {
  const statusBox = document.getElementById('editorStatus');
  if (!statusBox) return;
  statusBox.textContent = message;
  statusBox.style.borderColor = isError ? 'var(--bad)' : 'var(--border)';
}

function showView(view) {
  const interviewView = document.getElementById('interviewView');
  const editorView = document.getElementById('editorView');
  const openEditorBtn = document.getElementById('openEditorBtn');
  const backToInterviewBtn = document.getElementById('backToInterviewBtn');

  if (!interviewView || !editorView) return;

  if (view === 'editor') {
    interviewView.style.display = 'none';
    editorView.style.display = 'block';
    if (openEditorBtn) openEditorBtn.style.display = 'none';
    if (backToInterviewBtn) backToInterviewBtn.style.display = 'inline-flex';
    renderEditor();
  } else {
    interviewView.style.display = 'block';
    editorView.style.display = 'none';
    if (openEditorBtn) openEditorBtn.style.display = 'inline-flex';
    if (backToInterviewBtn) backToInterviewBtn.style.display = 'none';
    if (editorState) {
      buildInterviewUI(editorState);
    }
  }
}

function normalizeQuestionnaire(data) {
  if (!data.meta) data.meta = {};
  if (!data.grading) {
    data.grading = {
      labels: { "2": "Correct", "1": "Partial", "0": "Incorrect" },
      globalLevels: [
        { min: 85, label: 'Very strong' },
        { min: 70, label: 'Good' },
        { min: 50, label: 'Average / needs improvement' },
        { min: 0, label: 'Insufficient' }
      ]
    };
  }
  if (!Array.isArray(data.sections)) data.sections = [];
  data.meta.maxScorePerQuestion = Number(data.meta.maxScorePerQuestion || 2);

  data.sections = data.sections.map((section) => ({
    id: section.id || uid('section'),
    title: section.title || '',
    description: section.description || '',
    questions: Array.isArray(section.questions) ? section.questions.map((question) => ({
      id: question.id || uid('q'),
      label: question.label || '',
      text: question.text || '',
      expectedAnswer: Array.isArray(question.expectedAnswer) ? question.expectedAnswer : []
    })) : []
  }));

  return data;
}

function buildInterviewUI(config) {
  const app = document.getElementById('app');
  if (!app) return;

  const totalQuestions = config.sections.reduce((sum, section) => sum + section.questions.length, 0);
  const totalMax = totalQuestions * (config.meta.maxScorePerQuestion || 2);

  app.innerHTML = `
    <header class="hero">
      <h1>${escapeHtml(config.meta.title || 'Questionnaire')}</h1>
      <p>${escapeHtml(config.meta.subtitle || '')}</p>
    </header>
    <div class="layout">
      <aside class="summary">
        <div class="card">
          <h2>Summary</h2>
          <div class="kpis">
            <div class="kpi"><span>Score</span><strong id="totalScore">0 / ${totalMax}</strong></div>
            <div class="kpi"><span>Completed</span><strong id="answeredCount">0 / ${totalQuestions}</strong></div>
            <div class="kpi"><span>Rate</span><strong id="ratio">0%</strong></div>
            <div class="kpi"><span>Level</span><strong id="globalLevel">Pending</strong></div>
          </div>
        </div>
        <div class="card">
          <h2>Levels by domain</h2>
          <ul id="domainLevels" class="compact-list"></ul>
        </div>
        <div class="card">
          <h2>Weak points</h2>
          <ul id="weaknesses" class="compact-list">
            <li>No weak points identified.</li>
          </ul>
        </div>
      </aside>
      <main class="main" id="questionnaire"></main>
    </div>
    <section class="card recap-card">
      <div class="toolbar" style="justify-content: space-between;">
        <div>
          <h2 style="margin:0;">HR Summary</h2>
          <div class="helper">Export as CSV for easy sharing with HR / manager.</div>
        </div>
        <div class="toolbar" style="margin:0;">
          <button id="exportResultBtn" type="button">Export CSV summary</button>
          <input type="text" id="resultFilename" value="interview-recap.csv" style="width:220px;" />
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Question</th>
              <th>Domain</th>
              <th>Status</th>
              <th>Points</th>
              <th>Answer / notes</th>
            </tr>
          </thead>
          <tbody id="recapTableBody"></tbody>
        </table>
      </div>
    </section>

    <!-- Transcript Import Panel -->
    <section id="transcriptPanel" class="card transcript-panel" style="display:none;">
      <h2>📋 会议转录导入</h2>
      <div id="transcriptDropzone" class="transcript-dropzone">
        <p>将转录文件拖拽到此处，或点击上方"导入会议转录"按钮选择文件</p>
        <p class="muted">支持格式：腾讯会议、飞书、SRT、VTT、纯文本</p>
      </div>
      <div style="margin:0.5rem 0;">
        <label for="transcriptFormatSelect" style="margin-right:0.5rem;">格式：</label>
        <select id="transcriptFormatSelect" class="transcript-format-select">
          <option value="auto">自动检测</option>
          <option value="tencent">腾讯会议</option>
          <option value="feishu">飞书</option>
          <option value="srt">SRT 字幕</option>
          <option value="vtt">WebVTT 字幕</option>
          <option value="plain">纯文本</option>
        </select>
      </div>
      <pre id="transcriptPreview" class="transcript-preview"></pre>
      <div class="transcript-actions">
        <button id="autoScoreBtn" type="button">🤖 自动评分</button>
        <button id="autoSummaryBtn" type="button">📊 自动总结</button>
        <button id="saveTranscriptBtn" type="button">💾 保存结果</button>
      </div>
    </section>

    <!-- Auto Score Result -->
    <section id="autoScoreResult" class="card auto-score-result">
      <h2>🤖 自动评分结果</h2>
      <div id="autoScoreContent"></div>
    </section>

    <!-- Summary Report -->
    <section id="summaryReport" class="card summary-report">
      <h2>📊 自动总结报告</h2>
      <div id="summaryReportContent" class="report-content"></div>
    </section>
  `;

  const questionnaire = document.getElementById('questionnaire');

  config.sections.forEach((section) => {
    const sectionEl = document.createElement('section');
    sectionEl.className = 'card section-card';
    sectionEl.dataset.sectionId = section.id;
    sectionEl.innerHTML = `
      <h2>${escapeHtml(section.title)}</h2>
      <p class="muted">${escapeHtml(section.description || '')}</p>
      <div class="section-score" data-section-score>0 / ${section.questions.length * (config.meta.maxScorePerQuestion || 2)} (0%)</div>
    `;

    section.questions.forEach((question) => {
      const q = document.createElement('div');
      q.className = 'question';
      q.dataset.questionId = question.id;
      q.dataset.label = question.label;
      q.dataset.domain = section.title;
      q.dataset.text = question.text;
      q.innerHTML = `
        <h3>${escapeHtml(question.label)}</h3>
        <p>${escapeHtml(question.text)}</p>
        <div class="rating">
          <label><input type="radio" name="${question.id}" value="2"> ${escapeHtml(config.grading.labels["2"])}</label>
          <label><input type="radio" name="${question.id}" value="1"> ${escapeHtml(config.grading.labels["1"])}</label>
          <label><input type="radio" name="${question.id}" value="0"> ${escapeHtml(config.grading.labels["0"])}</label>
        </div>
        <textarea placeholder="Observed answer / recruiter notes"></textarea>
        <details>
          <summary>Expected answer</summary>
          <ul>${(question.expectedAnswer || []).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        </details>
      `;
      sectionEl.appendChild(q);
    });

    questionnaire.appendChild(sectionEl);
  });

  function getQuestionScore(questionEl) {
    const checked = questionEl.querySelector('input[type="radio"]:checked');
    return checked ? Number(checked.value) : null;
  }

  function collectResult() {
    const questions = [...document.querySelectorAll('#app .question')];
    const responses = questions.map((q) => {
      const score = getQuestionScore(q);
      const notes = q.querySelector('textarea').value.trim();
      const status = score === null ? 'Not rated' : config.grading.labels[String(score)];
      return {
        questionId: q.dataset.questionId,
        questionLabel: q.dataset.label,
        questionText: q.dataset.text,
        domain: q.dataset.domain,
        status,
        points: score,
        notes
      };
    });

    const totalScore = responses.reduce((sum, item) => sum + (item.points ?? 0), 0);
    const ratio = totalMax ? Math.round((totalScore / totalMax) * 100) : 0;

    const byDomain = config.sections.map((section) => {
      const items = responses.filter((r) => r.domain === section.title);
      const max = items.length * (config.meta.maxScorePerQuestion || 2);
      const score = items.reduce((sum, item) => sum + (item.points ?? 0), 0);
      const percent = max ? Math.round((score / max) * 100) : 0;
      return {
        domain: section.title,
        score,
        max,
        percent,
        level: getLevel(config.grading.globalLevels, percent)
      };
    });

    return {
      meta: {
        title: config.meta.title,
        subtitle: config.meta.subtitle,
        exportedAt: new Date().toISOString()
      },
      summary: {
        totalQuestions,
        totalScore,
        totalMax,
        ratio,
        level: getLevel(config.grading.globalLevels, ratio)
      },
      byDomain,
      responses
    };
  }

  function toCsv(result) {
    const rows = [];
    rows.push(['Title', result.meta.title]);
    rows.push(['Subtitle', result.meta.subtitle]);
    rows.push(['Exported at', result.meta.exportedAt]);
    rows.push([]);
    rows.push(['Total score', result.summary.totalScore, '/', result.summary.totalMax]);
    rows.push(['Overall rate', `${result.summary.ratio}%`]);
    rows.push(['Overall level', result.summary.level]);
    rows.push([]);
    rows.push(['Domain', 'Score', 'Max', 'Percentage', 'Level']);
    result.byDomain.forEach((d) => rows.push([d.domain, d.score, d.max, `${d.percent}%`, d.level]));
    rows.push([]);
    rows.push(['Question', 'Domain', 'Status', 'Points', 'Answer / notes']);
    result.responses.forEach((r) => rows.push([
      r.questionLabel,
      r.domain,
      r.status,
      r.points ?? '',
      r.notes
    ]));

    return rows.map((row) =>
      row.map((cell) => {
        const value = cell == null ? '' : String(cell);
        return `"${value.replaceAll('"', '""')}"`;
      }).join(';')
    ).join('\n');
  }

  function exportResultCsv() {
    const data = collectResult();
    const csv = toCsv(data);
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const filenameInput = document.getElementById('resultFilename');
    a.href = url;
    a.download = filenameInput.value.trim() || 'interview-recap.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function update() {
    const questions = [...document.querySelectorAll('#app .question')];
    let answered = 0;
    let totalScore = 0;
    const weaknesses = [];

    questions.forEach((q) => {
      const score = getQuestionScore(q);
      q.classList.remove('score-0', 'score-1', 'score-2');
      if (score !== null) {
        answered += 1;
        totalScore += score;
        q.classList.add(`score-${score}`);
        if (score <= 1) weaknesses.push(q.dataset.label);
      }
    });

    const ratio = totalMax ? Math.round((totalScore / totalMax) * 100) : 0;
    document.getElementById('totalScore').textContent = `${totalScore} / ${totalMax}`;
    document.getElementById('answeredCount').textContent = `${answered} / ${totalQuestions}`;
    document.getElementById('ratio').textContent = `${ratio}%`;
    document.getElementById('globalLevel').textContent = getLevel(config.grading.globalLevels, ratio);

    const weakUl = document.getElementById('weaknesses');
    weakUl.innerHTML = weaknesses.length
      ? weaknesses.map(item => `<li>${escapeHtml(item)}</li>`).join('')
      : '<li>No weak points identified.</li>';

    const domainLevels = document.getElementById('domainLevels');
    domainLevels.innerHTML = '';

    document.querySelectorAll('#app .section-card').forEach((sectionEl) => {
      const sectionQuestions = [...sectionEl.querySelectorAll('.question')];
      const max = sectionQuestions.length * (config.meta.maxScorePerQuestion || 2);
      const score = sectionQuestions.reduce((sum, q) => sum + (getQuestionScore(q) ?? 0), 0);
      const percent = max ? Math.round((score / max) * 100) : 0;
      const title = sectionEl.querySelector('h2').textContent;
      sectionEl.querySelector('[data-section-score]').textContent = `${score} / ${max} (${percent}%)`;

      const li = document.createElement('li');
      li.textContent = `${title}: ${percent}% (${getLevel(config.grading.globalLevels, percent)})`;
      domainLevels.appendChild(li);
    });

    const recapBody = document.getElementById('recapTableBody');
    recapBody.innerHTML = questions.map((q) => {
      const score = getQuestionScore(q);
      const notes = q.querySelector('textarea').value.trim();
      const status = score === null ? 'Not rated' : config.grading.labels[String(score)];
      const points = score === null ? '-' : String(score);
      return `
        <tr>
          <td>${escapeHtml(q.dataset.label)}</td>
          <td>${escapeHtml(q.dataset.domain)}</td>
          <td>${escapeHtml(status)}</td>
          <td>${escapeHtml(points)}</td>
          <td>${notes ? escapeHtml(notes) : '<span class="muted">No notes</span>'}</td>
        </tr>
      `;
    }).join('');
  }

  document.querySelectorAll('#app input[type="radio"]').forEach((input) => {
    input.addEventListener('change', update);
  });

  document.querySelectorAll('#app textarea').forEach((textarea) => {
    textarea.addEventListener('input', update);
  });

  const exportBtn = document.getElementById('exportResultBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportResultCsv);
  }

  // === 转录面板内操作按钮事件绑定 ===
  const autoScoreBtn = document.getElementById('autoScoreBtn');
  if (autoScoreBtn) {
    autoScoreBtn.addEventListener('click', () => {
      if (!_currentTranscript || _currentTranscript.length === 0) {
        alert('请先导入会议转录内容');
        return;
      }
      if (!editorState) {
        alert('请先加载问卷配置');
        return;
      }
      const results = autoScoreFromTranscript(_currentTranscript, editorState);
      _lastScoreResults = results;

      const container = document.getElementById('autoScoreContent');
      const section = document.getElementById('autoScoreResult');
      if (container && section) {
        let html = '';
        results.forEach((r) => {
          const cls = r.score === 2 ? 'good' : r.score === 1 ? 'partial' : 'bad';
          html += `<div class="score-match">
            <strong>${escapeHtml(r.question)}</strong>
            <span class="match-score ${cls}">${r.score}/2 (匹配率: ${Math.round(r.ratio * 100)}%)</span>
            <p class="muted">${r.snippet ? escapeHtml(r.snippet) : '未找到相关片段'}</p>
          </div>`;
        });
        container.innerHTML = html;
        section.classList.add('visible');
      }
    });
  }

  const autoSummaryBtn = document.getElementById('autoSummaryBtn');
  if (autoSummaryBtn) {
    autoSummaryBtn.addEventListener('click', () => {
      if (!_lastScoreResults || _lastScoreResults.length === 0) {
        alert('请先执行自动评分');
        return;
      }
      if (!editorState) {
        alert('请先加载问卷配置');
        return;
      }
      const summary = generateSummary(_lastScoreResults, editorState);
      const container = document.getElementById('summaryReportContent');
      const section = document.getElementById('summaryReport');
      if (container && section) {
        let html = `<div class="report-section">
          <strong>总体评级：</strong> ${escapeHtml(summary.overallLevel)}
          （得分率 ${Math.round(summary.scorePercent)}%）
        </div>`;
        if (summary.sections && summary.sections.length > 0) {
          html += '<div class="report-section"><strong>各板块得分：</strong><ul>';
          summary.sections.forEach((s) => {
            html += `<li>${escapeHtml(s.name)}：${s.score}/${s.total}</li>`;
          });
          html += '</ul></div>';
        }
        if (summary.strengths && summary.strengths.length > 0) {
          html += '<div class="report-section"><strong>✅ 优势：</strong><ul>';
          summary.strengths.forEach((s) => {
            html += `<li>${escapeHtml(s)}</li>`;
          });
          html += '</ul></div>';
        }
        if (summary.weaknesses && summary.weaknesses.length > 0) {
          html += '<div class="report-section"><strong>⚠️ 待改进：</strong><ul>';
          summary.weaknesses.forEach((w) => {
            html += `<li>${escapeHtml(w)}</li>`;
          });
          html += '</ul></div>';
        }
        html += `<div class="report-section"><strong>📝 录用建议：</strong> ${escapeHtml(summary.recommendation)}</div>`;
        container.innerHTML = html;
        section.classList.add('visible');
      }
    });
  }

  const saveTranscriptBtn = document.getElementById('saveTranscriptBtn');
  if (saveTranscriptBtn) {
    saveTranscriptBtn.addEventListener('click', () => {
      const data = {
        timestamp: new Date().toISOString(),
        transcript: _currentTranscript || [],
        scoreResults: _lastScoreResults || [],
        summary: null
      };
      if (_lastScoreResults && _lastScoreResults.length > 0 && editorState) {
        data.summary = generateSummary(_lastScoreResults, editorState);
      }
      try {
        localStorage.setItem('app.interview.transcript_results', JSON.stringify(data));
        alert('转录评分结果已保存！');
      } catch (err) {
        alert('保存失败：' + err.message);
      }
    });
  }

  // === 转录面板拖拽上传事件 ===
  const dropzone = document.getElementById('transcriptDropzone');
  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target.result;
        const formatSelect = document.getElementById('transcriptFormatSelect');
        const format = formatSelect ? formatSelect.value : 'auto';
        const parsed = parseTranscript(text, format);
        _currentTranscript = parsed;
        const preview = document.getElementById('transcriptPreview');
        if (preview) {
          preview.textContent = parsed.map(t => `[${t.speaker}] ${t.text}`).join('\n');
          preview.classList.add('visible');
        }
      };
      reader.readAsText(file);
    });
  }

  update();
}

function hydrateEditorForm() {
  const titleInput = document.getElementById('titleInput');
  const subtitleInput = document.getElementById('subtitleInput');
  if (!titleInput || !subtitleInput || !editorState) return;

  titleInput.value = editorState.meta.title || '';
  subtitleInput.value = editorState.meta.subtitle || '';
  renderSectionsEditor();
  renderPreview();
}

function syncEditorMeta() {
  const titleInput = document.getElementById('titleInput');
  const subtitleInput = document.getElementById('subtitleInput');
  if (!editorState || !titleInput || !subtitleInput) return;

  editorState.meta.title = titleInput.value.trim();
  editorState.meta.subtitle = subtitleInput.value.trim();
  editorState.meta.maxScorePerQuestion = 2;
  persistState();
  renderPreview();
}

function renderSectionsEditor() {
  const sectionsList = document.getElementById('sectionsList');
  if (!sectionsList || !editorState) return;

  sectionsList.innerHTML = '';
  if (!editorState.sections.length) {
    sectionsList.innerHTML = '<div class="empty">No sections yet.</div>';
    return;
  }

  editorState.sections.forEach((section, sIndex) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'list-item';
    wrapper.innerHTML = `
      <div class="toolbar" style="justify-content: space-between;">
        <div>
          <strong>Section ${sIndex + 1}</strong>
          <span class="badge">${escapeHtml(section.id)}</span>
        </div>
        <div class="toolbar" style="margin:0;">
          <button type="button" data-action="move-section-up" data-section="${sIndex}">↑</button>
          <button type="button" data-action="move-section-down" data-section="${sIndex}">↓</button>
          <button type="button" data-action="delete-section" data-section="${sIndex}">Delete</button>
        </div>
      </div>

      <div class="inline-grid" style="margin-top:12px;">
        <div class="form-row">
          <label>Section title</label>
          <input type="text" data-field="section-title" data-section="${sIndex}" value="${escapeHtml(section.title || '')}" />
        </div>
        <div class="form-row">
          <label>Identifier</label>
          <input type="text" data-field="section-id" data-section="${sIndex}" value="${escapeHtml(section.id || '')}" />
        </div>
      </div>

      <div class="form-row" style="margin-top:12px;">
        <label>Description</label>
        <textarea data-field="section-description" data-section="${sIndex}">${escapeHtml(section.description || '')}</textarea>
      </div>

      <div class="list-box" style="margin-top:12px;">
        <div class="toolbar" style="justify-content: space-between;">
          <h4 style="margin:0;">Questions</h4>
          <button type="button" data-action="add-question" data-section="${sIndex}">Add question</button>
        </div>
        <div id="questionList-${sIndex}"></div>
      </div>
    `;
    sectionsList.appendChild(wrapper);

    const questionList = wrapper.querySelector(`#questionList-${sIndex}`);
    if (!section.questions.length) {
      questionList.innerHTML = '<div class="empty">No questions in this section.</div>';
    } else {
      section.questions.forEach((question, qIndex) => {
        const q = document.createElement('div');
        q.className = 'list-item';
        q.innerHTML = `
          <div class="toolbar" style="justify-content: space-between;">
            <div>
              <strong>Question ${qIndex + 1}</strong>
              <span class="badge">${escapeHtml(question.id)}</span>
            </div>
            <div class="toolbar" style="margin:0;">
              <button type="button" data-action="move-question-up" data-section="${sIndex}" data-question="${qIndex}">↑</button>
              <button type="button" data-action="move-question-down" data-section="${sIndex}" data-question="${qIndex}">↓</button>
              <button type="button" data-action="delete-question" data-section="${sIndex}" data-question="${qIndex}">Delete</button>
            </div>
          </div>

          <div class="inline-grid" style="margin-top:12px;">
            <div class="form-row">
              <label>Label</label>
              <input type="text" data-field="question-label" data-section="${sIndex}" data-question="${qIndex}" value="${escapeHtml(question.label || '')}" />
            </div>
            <div class="form-row">
              <label>Identifier</label>
              <input type="text" data-field="question-id" data-section="${sIndex}" data-question="${qIndex}" value="${escapeHtml(question.id || '')}" />
            </div>
          </div>

          <div class="form-row" style="margin-top:12px;">
            <label>Question</label>
            <textarea data-field="question-text" data-section="${sIndex}" data-question="${qIndex}">${escapeHtml(question.text || '')}</textarea>
          </div>

          <div class="form-row" style="margin-top:12px;">
            <label>Expected answers (one line = one expected point)</label>
            <textarea data-field="question-answers" data-section="${sIndex}" data-question="${qIndex}">${escapeHtml((question.expectedAnswer || []).join('\n'))}</textarea>
          </div>
        `;
        questionList.appendChild(q);
      });
    }
  });

  bindDynamicEditorEvents();
}

function bindDynamicEditorEvents() {
  const sectionsList = document.getElementById('sectionsList');
  if (!sectionsList || !editorState) return;

  sectionsList.querySelectorAll('[data-field]').forEach((input) => {
    input.addEventListener('input', (event) => {
      const field = event.target.dataset.field;
      const sIndex = Number(event.target.dataset.section);
      const qIndex = event.target.dataset.question !== undefined ? Number(event.target.dataset.question) : null;
      const value = event.target.value;

      if (field === 'section-title') editorState.sections[sIndex].title = value;
      if (field === 'section-id') editorState.sections[sIndex].id = value;
      if (field === 'section-description') editorState.sections[sIndex].description = value;
      if (field === 'question-label') editorState.sections[sIndex].questions[qIndex].label = value;
      if (field === 'question-id') editorState.sections[sIndex].questions[qIndex].id = value;
      if (field === 'question-text') editorState.sections[sIndex].questions[qIndex].text = value;
      if (field === 'question-answers') {
        editorState.sections[sIndex].questions[qIndex].expectedAnswer = value
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
      }

      persistState();
      renderPreview();
      setEditorStatus('Changes saved.');
    });
  });

  sectionsList.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      const sIndex = Number(button.dataset.section);
      const qIndex = button.dataset.question !== undefined ? Number(button.dataset.question) : null;

      if (action === 'delete-section') {
        editorState.sections.splice(sIndex, 1);
      }
      if (action === 'move-section-up' && sIndex > 0) {
        [editorState.sections[sIndex - 1], editorState.sections[sIndex]] = [editorState.sections[sIndex], editorState.sections[sIndex - 1]];
      }
      if (action === 'move-section-down' && sIndex < editorState.sections.length - 1) {
        [editorState.sections[sIndex + 1], editorState.sections[sIndex]] = [editorState.sections[sIndex], editorState.sections[sIndex + 1]];
      }
      if (action === 'add-question') {
        editorState.sections[sIndex].questions.push({
          id: uid('q'),
          label: 'New question',
          text: '',
          expectedAnswer: []
        });
      }
      if (action === 'delete-question') {
        editorState.sections[sIndex].questions.splice(qIndex, 1);
      }
      if (action === 'move-question-up' && qIndex > 0) {
        const arr = editorState.sections[sIndex].questions;
        [arr[qIndex - 1], arr[qIndex]] = [arr[qIndex], arr[qIndex - 1]];
      }
      if (action === 'move-question-down' && qIndex < editorState.sections[sIndex].questions.length - 1) {
        const arr = editorState.sections[sIndex].questions;
        [arr[qIndex + 1], arr[qIndex]] = [arr[qIndex], arr[qIndex + 1]];
      }

      persistState();
      renderSectionsEditor();
      renderPreview();
      setEditorStatus('Structure updated.');
    });
  });
}

function renderPreview() {
  const preview = document.getElementById('preview');
  if (!preview || !editorState) return;

  const sectionCount = editorState.sections.length;
  const questionCount = editorState.sections.reduce((sum, section) => sum + section.questions.length, 0);

  preview.innerHTML = `
    <div class="list-item">
      <strong>${escapeHtml(editorState.meta.title || 'Untitled')}</strong><br>
      <span class="helper">${escapeHtml(editorState.meta.subtitle || '')}</span>
      <p style="margin:8px 0 0;">${sectionCount} section(s) · ${questionCount} question(s)</p>
    </div>
    ${editorState.sections.map(section => `
      <div class="list-item">
        <h3 style="margin:0 0 6px 0;">${escapeHtml(section.title || 'Untitled section')}</h3>
        <p class="helper">${escapeHtml(section.description || '')}</p>
        ${section.questions.length ? `
          <ul class="compact-list">
            ${section.questions.map(question => `
              <li>
                <strong>${escapeHtml(question.label || 'No label')}</strong><br>
                ${escapeHtml(question.text || '')}
              </li>
            `).join('')}
          </ul>
        ` : '<div class="empty">No questions.</div>'}
      </div>
    `).join('')}
  `;
}

function renderEditor() {
  if (!editorState) {
    editorState = emptyState();
  }
  hydrateEditorForm();
}

function loadQuestionnaireFromObject(data, filename = '') {
  editorState = normalizeQuestionnaire(data);
  currentQuestionnaireFileName = filename || currentQuestionnaireFileName || '';
  persistState();
  buildInterviewUI(editorState);
  renderEditor();
  setLoadStatus(currentQuestionnaireFileName || 'Questionnaire loaded');
  setEditorStatus('Questionnaire loaded.');
}

function newQuestionnaire() {
  editorState = emptyState();
  currentQuestionnaireFileName = '';
  persistState();
  buildInterviewUI(editorState);
  renderEditor();
  setEditorStatus('New questionnaire created.');
  setLoadStatus('New questionnaire');
}

function loadSelectedQuestionnaire() {
  const fileInput = document.getElementById('configFileInput');
  const file = fileInput && fileInput.files ? fileInput.files[0] : null;

  if (file) {
    file.text()
      .then((text) => {
        const config = JSON.parse(text);
        loadQuestionnaireFromObject(config, file.name || '');
      })
      .catch((error) => {
        setLoadStatus(`Loading error: ${error.message}`);
      });
    return;
  }

  if (editorState) {
    buildInterviewUI(editorState);
    setLoadStatus(currentQuestionnaireFileName || 'Questionnaire reloaded');
    return;
  }

  const stored = loadPersistedState();
  if (stored) {
    loadQuestionnaireFromObject(stored, currentQuestionnaireFileName);
    return;
  }

  setLoadStatus('Select a questionnaire file first.');
}

function loadSelectedEditorFile() {
  const fileInput = document.getElementById('fileInput');
  const file = fileInput && fileInput.files ? fileInput.files[0] : null;
  if (!file) {
    setEditorStatus('Select a file before loading.', true);
    return;
  }

  file.text()
    .then((text) => {
      const parsed = JSON.parse(text);
      loadQuestionnaireFromObject(parsed, file.name || '');
      setEditorStatus('Questionnaire loaded.');
    })
    .catch((error) => setEditorStatus(`Unable to load: ${error.message}`, true));
}

function exportQuestionnaire() {
  try {
    syncEditorMeta();
    const blob = new Blob([JSON.stringify(editorState, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentQuestionnaireFileName || 'questionnaire.json';
    a.click();
    URL.revokeObjectURL(url);
    setEditorStatus('Questionnaire exported.');
  } catch (error) {
    setEditorStatus(`Unable to export: ${error.message}`, true);
  }
}

function setupApp() {
  const openEditorBtn = document.getElementById('openEditorBtn');
  const backToInterviewBtn = document.getElementById('backToInterviewBtn');
  const loadBtn = document.getElementById('loadConfigBtn');
  const configFileInput = document.getElementById('configFileInput');
  const editorFileInput = document.getElementById('fileInput');
  const newQuestionnaireBtn = document.getElementById('newQuestionnaireBtn');
  const exportBtn = document.getElementById('exportBtn');
  const addSectionBtn = document.getElementById('addSectionBtn');
  const titleInput = document.getElementById('titleInput');
  const subtitleInput = document.getElementById('subtitleInput');

  if (openEditorBtn) {
    openEditorBtn.addEventListener('click', () => {
      persistState();
      showView('editor');
    });
  }

  if (backToInterviewBtn) {
    backToInterviewBtn.addEventListener('click', () => {
      syncEditorMeta();
      persistState();
      showView('interview');
    });
  }

  if (loadBtn) {
    loadBtn.addEventListener('click', loadSelectedQuestionnaire);
  }

  if (configFileInput) {
    configFileInput.addEventListener('change', loadSelectedQuestionnaire);
  }

  if (editorFileInput) {
    editorFileInput.addEventListener('change', loadSelectedEditorFile);
  }

  if (newQuestionnaireBtn) {
    newQuestionnaireBtn.addEventListener('click', newQuestionnaire);
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', exportQuestionnaire);
  }

  if (addSectionBtn) {
    addSectionBtn.addEventListener('click', () => {
      if (!editorState) editorState = emptyState();
      editorState.sections.push({
        id: uid('section'),
        title: 'New section',
        description: '',
        questions: []
      });
      persistState();
      renderSectionsEditor();
      renderPreview();
      setEditorStatus('Section added.');
    });
  }

  if (titleInput) {
    titleInput.addEventListener('input', syncEditorMeta);
  }

  if (subtitleInput) {
    subtitleInput.addEventListener('input', syncEditorMeta);
  }

  // === 转录导入相关事件绑定 ===
  const importTranscriptBtn = document.getElementById('importTranscriptBtn');
  const transcriptFileInput = document.getElementById('transcriptFileInput');

  if (importTranscriptBtn && transcriptFileInput) {
    importTranscriptBtn.addEventListener('click', () => {
      transcriptFileInput.click();
    });

    transcriptFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
      if (file.size > MAX_FILE_SIZE) {
        alert('文件过大，请选择小于 10MB 的文件');
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target.result;
        const formatSelect = document.getElementById('transcriptFormatSelect');
        const format = formatSelect ? formatSelect.value : 'auto';
        const parsed = parseTranscript(text, format);

        // 保存到当前状态
        _currentTranscript = parsed;

        // 更新预览
        const preview = document.getElementById('transcriptPreview');
        if (preview) {
          preview.textContent = parsed.map(t =>
            `[${t.speaker}] ${t.text}`
          ).join('\n');
          preview.classList.add('visible');
        }

        // 显示转录面板
        const panel = document.getElementById('transcriptPanel');
        if (panel) panel.style.display = 'block';
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }

  const stored = loadPersistedState();
  if (stored) {
    editorState = normalizeQuestionnaire(stored);
  } else {
    editorState = emptyState();
  }

  buildInterviewUI(editorState);
  renderEditor();
  showView('interview');
}

window.addEventListener('DOMContentLoaded', setupApp);
