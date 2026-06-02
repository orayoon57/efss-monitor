// 수집 오케스트레이터
// 1) 법제처에서 전금감 현재 본문/메타 수집
// 2) 직전 스냅샷(current.json)과 비교 → 변경 감지
// 3) 월간 기록(monthly/YYYY-MM.json), 다이제스트 HTML, 인덱스, 스냅샷 갱신
//    -> git 히스토리에 남는 current.json/monthly 가 "언제 무엇을 인지했는지" 증빙이 됨

import { fetchCurrent } from './fetch.mjs';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffLines } from 'diff';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'web', 'data');
const MONTHLY = path.join(DATA, 'monthly');

const sha = s => createHash('sha256').update(s).digest('hex');
const ym = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const splitLines = v => v.split('\n').map(s => s.trim()).filter(Boolean);

async function readJson(p, fallback) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
}

function buildDiff(prevText, curText) {
  const added = [], removed = [];
  for (const part of diffLines(prevText || '', curText || '')) {
    if (part.added) added.push(...splitLines(part.value));
    else if (part.removed) removed.push(...splitLines(part.value));
  }
  return { added, removed };
}

function digestHtml(rec) {
  const m = rec.meta;
  const badge = rec.baseline
    ? '<span style="background:#3a3a3a;color:#fff;padding:2px 10px;border-radius:2px;font-size:12px;">기준선 등록</span>'
    : rec.changed
      ? '<span style="background:#7c2d2d;color:#fff;padding:2px 10px;border-radius:2px;font-size:12px;">변경 감지</span>'
      : '<span style="background:#2f5d3a;color:#fff;padding:2px 10px;border-radius:2px;font-size:12px;">변경 없음</span>';

  const diffRows = !rec.changed ? '' : `
    <h3 style="font-size:14px;margin:24px 0 8px;color:#7c2d2d;">변경 본문 (자동 추출 · 검토 필요)</h3>
    ${rec.diff.removed.map(l => `<div style="background:#fbeaea;border-left:3px solid #7c2d2d;padding:6px 10px;margin:3px 0;font-size:13px;">− ${esc(l)}</div>`).join('')}
    ${rec.diff.added.map(l => `<div style="background:#e9f2ec;border-left:3px solid #2f5d3a;padding:6px 10px;margin:3px 0;font-size:13px;">+ ${esc(l)}</div>`).join('')}
  `;

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"></head>
<body style="margin:0;background:#f7f5f0;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#1a1a1a;">
<div style="max-width:680px;margin:0 auto;padding:32px 24px;">
  <div style="border-bottom:2px solid #7c2d2d;padding-bottom:12px;margin-bottom:20px;">
    <div style="font-size:12px;letter-spacing:2px;color:#7c2d2d;">규정 변경 모니터 · 월간 다이제스트</div>
    <div style="font-size:24px;font-weight:700;margin-top:4px;">${esc(m.행정규칙명)} <span style="font-size:14px;color:#666;">(${esc(rec.month)})</span></div>
  </div>
  <p style="margin:0 0 16px;">${badge}</p>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <tr><td style="padding:6px 0;color:#777;width:120px;">제개정구분</td><td>${esc(m.제개정구분명) || '-'}</td></tr>
    <tr><td style="padding:6px 0;color:#777;">발령일자</td><td>${esc(m.발령일자) || '-'} (제${esc(m.발령번호) || '-'}호)</td></tr>
    <tr><td style="padding:6px 0;color:#777;">시행일자</td><td>${esc(m.시행일자) || '-'}</td></tr>
    <tr><td style="padding:6px 0;color:#777;">행정규칙일련번호</td><td>${esc(m.행정규칙일련번호) || '-'}</td></tr>
    <tr><td style="padding:6px 0;color:#777;">소관부처</td><td>${esc(m.소관부처명) || '-'}</td></tr>
  </table>
  ${diffRows}
  <p style="margin-top:24px;"><a href="${esc(rec.sourceUrl)}" style="color:#7c2d2d;">법제처 본문 보기 →</a></p>
  <p style="font-size:11px;color:#999;margin-top:24px;border-top:1px solid #ddd;padding-top:12px;">
    이 다이제스트는 법제처 국가법령정보 OPEN API에서 자동 추출한 것으로, 변경 본문은 담당자 검토가 필요합니다.
    법제처는 <b>시행·확정된</b> 규정만 반영하므로, 예고 단계 조기경보는 금융위 입법예고 채널을 별도 모니터링하세요.
    생성: ${esc(rec.generatedAt)}
  </p>
</div></body></html>`;
}

async function main() {
  await mkdir(MONTHLY, { recursive: true });
  const mock = !!process.env.MOCK;
  const now = new Date();
  const month = ym(now);

  const cur = await fetchCurrent({ mock });
  const curHash = sha(cur.bodyText);
  const prev = await readJson(path.join(DATA, 'current.json'), null);

  const baseline = !prev;
  const changed = !!prev && (
    prev.meta.행정규칙일련번호 !== cur.meta.행정규칙일련번호 ||
    prev.bodyHash !== curHash
  );

  const diff = (prev && changed) ? buildDiff(prev.bodyText, cur.bodyText) : { added: [], removed: [] };

  const rec = {
    month,
    generatedAt: now.toISOString(),
    baseline,
    changed,
    meta: cur.meta,
    prevMeta: prev ? prev.meta : null,
    diff,
    addedCount: diff.added.length,
    removedCount: diff.removed.length,
    sourceUrl: cur.sourceUrl,
  };

  await writeFile(path.join(MONTHLY, `${month}.json`), JSON.stringify(rec, null, 2));
  const html = digestHtml(rec);
  await writeFile(path.join(DATA, `digest-${month}.html`), html);
  await writeFile(path.join(DATA, 'digest-latest.html'), html); // 이메일 발송용 고정 경로

  // 증빙용 현재 스냅샷 (이 파일의 git diff = 본문 변경 이력)
  await writeFile(path.join(DATA, 'current.json'), JSON.stringify({
    meta: cur.meta, bodyHash: curHash, bodyText: cur.bodyText, updatedAt: now.toISOString(),
  }, null, 2));

  const index = await readJson(path.join(DATA, 'index.json'), []);
  const entry = {
    month, changed, baseline,
    시행일자: cur.meta.시행일자, 일련번호: cur.meta.행정규칙일련번호,
    제개정구분명: cur.meta.제개정구분명, generatedAt: rec.generatedAt,
  };
  const at = index.findIndex(e => e.month === month);
  if (at >= 0) index[at] = entry; else index.push(entry);
  index.sort((a, b) => b.month.localeCompare(a.month));
  await writeFile(path.join(DATA, 'index.json'), JSON.stringify(index, null, 2));

  console.log(`[${month}] baseline=${baseline} changed=${changed} +${rec.addedCount}/-${rec.removedCount} 일련번호=${cur.meta.행정규칙일련번호} 시행=${cur.meta.시행일자}`);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
