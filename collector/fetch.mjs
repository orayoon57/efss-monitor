// 법제처 국가법령정보 OPEN API 클라이언트 (전자금융감독규정 = 행정규칙)
//
// 목록 조회: http://www.law.go.kr/DRF/lawSearch.do?OC={ID}&target=admrul&type=XML&query=전자금융감독규정
// 본문 조회: http://www.law.go.kr/DRF/lawService.do?OC={ID}&target=admrul&ID={행정규칙ID}&type=XML
//
// OC = open.law.go.kr 에 등록한 이메일의 @ 앞부분. (데모/소량 테스트는 OC=test)
// 환경변수 LAW_OC 로 주입.

import { XMLParser } from 'fast-xml-parser';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OC = process.env.LAW_OC || 'test';
const BASE = 'http://www.law.go.kr/DRF';
const RULE_NAME = '전자금융감독규정';

const parser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  parseTagValue: false, // 값을 항상 문자열로 (발령번호 등 앞자리 0 보존)
});

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'efss-monitor/0.1' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} :: ${url}`);
  return await res.text();
}

// 목록 응답에서 규칙 항목(객체)들을 재귀적으로 수집
function collectItems(node, out) {
  if (Array.isArray(node)) { for (const n of node) collectItems(n, out); return; }
  if (node && typeof node === 'object') {
    if ('행정규칙명' in node || '행정규칙일련번호' in node) out.push(node);
    for (const k of Object.keys(node)) collectItems(node[k], out);
  }
}

// 본문 응답에서 모든 텍스트 노드를 순서대로 수집 (스키마 변동에 강건한 diff용 표현)
function collectText(node, out) {
  if (node == null) return;
  if (typeof node === 'string') { const t = node.trim(); if (t) out.push(t); return; }
  if (typeof node === 'number') { out.push(String(node)); return; }
  if (Array.isArray(node)) { for (const n of node) collectText(n, out); return; }
  if (typeof node === 'object') { for (const k of Object.keys(node)) collectText(node[k], out); }
}

function normalize(s) {
  return s.replace(/\r/g, '')
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function publicUrl() {
  // 사람이 보는 친화 URL (이름 기반)
  return `https://www.law.go.kr/행정규칙/${encodeURIComponent(RULE_NAME)}`;
}

export async function fetchCurrent({ mock } = {}) {
  let searchXml, bodyXml;

  if (mock) {
    const variant = process.env.MOCK_VARIANT || 'v1';
    searchXml = await readFile(path.join(__dirname, 'fixtures', 'search.xml'), 'utf8');
    bodyXml = await readFile(path.join(__dirname, 'fixtures', `body_${variant}.xml`), 'utf8');
  } else {
    const searchUrl = `${BASE}/lawSearch.do?OC=${encodeURIComponent(OC)}&target=admrul&type=XML&display=20&query=${encodeURIComponent(RULE_NAME)}`;
    searchXml = await getText(searchUrl);
  }

  const sParsed = parser.parse(searchXml);
  const items = [];
  collectItems(sParsed, items);

  const pick =
    items.find(i => i['행정규칙명'] === RULE_NAME && String(i['현행연혁구분'] ?? '').includes('현행')) ||
    items.find(i => i['행정규칙명'] === RULE_NAME) ||
    items[0];

  if (!pick) throw new Error('목록에서 「전자금융감독규정」을 찾지 못했습니다. (OC 키/네트워크 확인)');

  const meta = {
    행정규칙명: pick['행정규칙명'] ?? RULE_NAME,
    행정규칙일련번호: String(pick['행정규칙일련번호'] ?? ''),
    행정규칙ID: String(pick['행정규칙ID'] ?? ''),
    발령일자: String(pick['발령일자'] ?? ''),
    발령번호: String(pick['발령번호'] ?? ''),
    시행일자: String(pick['시행일자'] ?? ''),
    제개정구분명: String(pick['제개정구분명'] ?? ''),
    소관부처명: String(pick['소관부처명'] ?? ''),
    생성일자: String(pick['생성일자'] ?? ''),
  };

  if (!mock) {
    const id = meta.행정규칙ID || meta.행정규칙일련번호;
    const bodyUrl = `${BASE}/lawService.do?OC=${encodeURIComponent(OC)}&target=admrul&ID=${encodeURIComponent(id)}&type=XML`;
    bodyXml = await getText(bodyUrl);
  }

  const bParsed = parser.parse(bodyXml);
  const parts = [];
  collectText(bParsed, parts);
  const bodyText = normalize(parts.join('\n'));

  return { meta, bodyText, rawBody: bodyXml, sourceUrl: publicUrl() };
}
