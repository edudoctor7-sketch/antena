/**
 * 안테나랩 홈페이지 ↔ 구글시트 연결 (앱스스크립트)
 *
 * 하는 일 세 가지
 *   1) 방문자가 남긴 후기를 「후기」 시트에 한 줄씩 쌓는다
 *   2) 관리자가 고친 홈페이지 문구를 「설정」 시트에 저장한다
 *   3) 홈페이지가 열릴 때 위 두 가지를 내려보내서, 모든 방문자가 같은 화면을 본다
 *
 * 설치 방법은 같은 폴더의 「구글시트 연결방법.md」 를 보세요.
 */

/* 관리자 비밀번호 — 홈페이지 관리자 로그인과 같은 번호여야 합니다. */
var ADMIN_PW = '5822';

/* ★ 여기는 보통 비워 두시면 됩니다.
 *
 * 스프레드시트를 연 상태에서 [확장 프로그램 → Apps Script] 로 만드셨다면
 * 비워 두어도 알아서 그 시트를 찾아갑니다.
 *
 * 만약 「시트를 찾지 못했습니다」 라는 문제가 나오면,
 * 구글시트 주소창의 가운데 긴 글자를 아래 따옴표 사이에 넣어 주세요.
 *
 *   https://docs.google.com/spreadsheets/d/여기가_시트_ID/edit
 *                                         ~~~~~~~~~~~~~~ 이 부분
 */
var SHEET_ID = '';

var SHEET_REVIEW = '후기';
var SHEET_CONFIG = '설정';
var HEADER = ['접수일시', '이름', '소속·구분', '별점', '후기내용', '공개', '표시순서'];

/* ── 시트 준비 ─────────────────────────────────────────
   스크립트가 시트에 붙어 있으면 그 시트를, 아니면 SHEET_ID 로 찾아 연다. */
function ss_() {
  if (SHEET_ID) return SpreadsheetApp.openById(SHEET_ID);

  var bound = SpreadsheetApp.getActiveSpreadsheet();
  if (bound) return bound;

  var saved = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (saved) return SpreadsheetApp.openById(saved);

  throw new Error(
    '시트를 찾지 못했습니다. 스프레드시트를 연 상태에서 [확장 프로그램 → Apps Script] 로 ' +
    '만드셨는지 확인해 주세요. 따로 만드신 경우에는 Code.gs 맨 위 SHEET_ID 에 ' +
    '시트 주소의 가운데 긴 글자를 넣고 새 버전으로 다시 배포해 주세요.');
}

/* 스크립트가 시트에 직접 붙어 있는지 여부 (문제 찾을 때 쓰는 표시) */
function isBound_() {
  try { return !!SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { return false; }
}

function reviewSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName(SHEET_REVIEW);
  if (!sh) {
    sh = ss.insertSheet(SHEET_REVIEW);
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
    sh.getRange(1, 1, 1, HEADER.length).setFontWeight('bold').setBackground('#E8F4F4');
    sh.setFrozenRows(1);
    sh.setColumnWidth(5, 420);
  }
  return sh;
}

function configSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName(SHEET_CONFIG);
  if (!sh) {
    sh = ss.insertSheet(SHEET_CONFIG);
    sh.getRange(1, 1, 1, 2).setValues([['항목', '값']]);
    sh.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#E8F4F4');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* 홈페이지 문구는 길어서 셀 한 칸(5만 자)을 넘을 수 있다.
   그래서 4만 자씩 잘라 여러 줄에 나눠 담는다. */
function saveConfig_(key, text) {
  var sh = configSheet_();
  var vals = sh.getDataRange().getValues();
  for (var i = vals.length - 1; i >= 1; i--) {
    if (String(vals[i][0]).indexOf(key) === 0) sh.deleteRow(i + 1);
  }
  var s = String(text || '');
  var CHUNK = 40000;
  var n = 0;
  for (var p = 0; p < s.length || n === 0; p += CHUNK) {
    sh.appendRow([key + '#' + n, s.substr(p, CHUNK)]);
    n++;
  }
}

function readConfig_(key) {
  var sh = configSheet_();
  var vals = sh.getDataRange().getValues();
  var parts = [];
  for (var i = 1; i < vals.length; i++) {
    var k = String(vals[i][0]);
    if (k.indexOf(key + '#') === 0) {
      parts.push({ n: parseInt(k.split('#')[1], 10) || 0, v: String(vals[i][1] || '') });
    }
  }
  parts.sort(function (a, b) { return a.n - b.n; });
  return parts.map(function (x) { return x.v; }).join('');
}

/* ── 응답 도우미 ─────────────────────────────────────── */
function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ── 홈페이지가 내용을 읽어갈 때 (GET) ──────────────────── */
function doGet(e) {
  try {
    var type = (e && e.parameter && e.parameter.type) || 'all';

    if (type === 'ping') {
      return out_({ ok: true, sheet: ss_().getName(), bound: isBound_(), version: 2 });
    }

    var reviews = [];
    var sh = reviewSheet_();
    var last = sh.getLastRow();
    if (last > 1) {
      var rows = sh.getRange(2, 1, last - 1, HEADER.length).getValues();
      rows.forEach(function (r, i) {
        var pub = String(r[5]).trim();
        if (pub !== 'O' && pub !== 'o' && pub !== 'ㅇ' && pub !== 'TRUE' && r[5] !== true) return;
        reviews.push({
          id: 'sheet' + (i + 2),
          date: formatDate_(r[0]),
          name: String(r[1] || '익명'),
          role: String(r[2] || ''),
          star: parseInt(r[3], 10) || 5,
          text: String(r[4] || ''),
          pub: true,
          order: Number(r[6]) || 0
        });
      });
      reviews.sort(function (a, b) { return (a.order || 999) - (b.order || 999); });
    }

    var content = {};
    try { content = JSON.parse(readConfig_('content') || '{}'); } catch (err) { content = {}; }

    return out_({ ok: true, reviews: reviews, content: content });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

function formatDate_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  return String(v || '').slice(0, 10);
}

/* ── 홈페이지가 내용을 보낼 때 (POST) ───────────────────── */
function doPost(e) {
  try {
    var body = {};
    try { body = JSON.parse(e.postData.contents); } catch (err) {
      return out_({ ok: false, error: '보내온 내용을 읽지 못했습니다.' });
    }

    /* 1) 방문자 후기 접수 — 비밀번호 없이 누구나 */
    if (body.type === 'review') {
      var name = String(body.name || '').trim();
      var text = String(body.text || '').trim();
      if (!name || !text) return out_({ ok: false, error: '이름과 후기 내용이 필요합니다.' });
      if (text.length > 3000) return out_({ ok: false, error: '후기가 너무 깁니다.' });

      reviewSheet_().appendRow([
        new Date(),
        name.slice(0, 60),
        String(body.role || '').slice(0, 80),
        parseInt(body.star, 10) || 5,
        text,
        '',          /* 공개 칸 — 대표님이 확인 후 O 를 넣으면 홈페이지에 올라갑니다 */
        ''
      ]);

      notify_(name, body.role, body.star, text);
      return out_({ ok: true });
    }

    /* 2) 관리자가 고친 내용을 웹에 반영 — 비밀번호 확인 */
    if (body.type === 'publish') {
      if (String(body.pw || '') !== String(ADMIN_PW)) {
        return out_({ ok: false, error: '비밀번호가 맞지 않습니다.' });
      }
      if (body.content && typeof body.content === 'object') {
        saveConfig_('content', JSON.stringify(body.content));
      }
      if (Array.isArray(body.reviews)) {
        writeReviews_(body.reviews);
      }
      return out_({ ok: true, saved: new Date().toISOString() });
    }

    return out_({ ok: false, error: '알 수 없는 요청입니다.' });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

/* 관리자 페이지에서 정리한 후기 목록을 시트에 그대로 옮겨 적는다. */
function writeReviews_(list) {
  var sh = reviewSheet_();
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, HEADER.length).clearContent();
  if (!list.length) return;
  var rows = list.map(function (r, i) {
    return [
      r.date || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'),
      String(r.name || '익명'),
      String(r.role || ''),
      parseInt(r.star, 10) || 5,
      String(r.text || ''),
      (r.pub === false ? '' : 'O'),
      i + 1
    ];
  });
  sh.getRange(2, 1, rows.length, HEADER.length).setValues(rows);
}

/* 새 후기가 들어오면 메일로 알려 준다. */
function notify_(name, role, star, text) {
  try {
    var to = Session.getEffectiveUser().getEmail();
    if (!to) return;
    MailApp.sendEmail({
      to: to,
      subject: '[안테나랩 홈페이지] 새 후기 - ' + name,
      body: [
        '홈페이지에 새 후기가 등록되었습니다.',
        '',
        '이름: ' + name,
        '소속: ' + (role || '-'),
        '별점: ' + (star || 5),
        '',
        '내용:',
        text,
        '',
        '───────────────',
        '구글시트의 「후기」 탭을 열어 「공개」 칸에 O 를 넣으면 홈페이지에 올라갑니다.',
        ss_().getUrl()
      ].join('\n')
    });
  } catch (err) {
    /* 메일이 안 가도 후기 저장은 이미 끝났으므로 그냥 넘어간다 */
  }
}

/* ── 문제가 생겼을 때 여기를 눌러서 확인합니다 ────────────────
   앱스스크립트 화면 위쪽에서 이 함수를 고르고 ▶실행 을 누른 뒤,
   아래 「실행 로그」에 나오는 내용을 봐 주세요. */
function 연결검사() {
  var log = [];
  log.push('스크립트가 시트에 붙어 있나요? : ' + (isBound_() ? '예' : '아니오'));
  log.push('SHEET_ID 를 적어두셨나요?      : ' + (SHEET_ID ? '예' : '아니오 (비어 있음)'));
  try {
    var s = ss_();
    log.push('찾은 시트 이름                : ' + s.getName());
    reviewSheet_();
    configSheet_();
    log.push('「후기」·「설정」 시트          : 준비 완료');
    log.push('');
    log.push('✅ 이상 없습니다. 홈페이지에서 [연결 확인]을 다시 눌러 보세요.');
    log.push('   그래도 안 되면 [배포 → 배포 관리 → ✏️ → 버전: 새 버전 → 배포] 를 해주세요.');
  } catch (err) {
    log.push('');
    log.push('❌ 문제: ' + err.message);
  }
  Logger.log(log.join('\n'));
  return log.join('\n');
}
