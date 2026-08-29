/* 「웹에 반영하기」 — 관리자 페이지에서 고친 내용을 깃허브에 저장한다.
 *
 * 왜 서버가 필요한가
 *   홈페이지는 서버 프로그램이 없는 정적 사이트라, 브라우저는 보안상 서버 파일을
 *   직접 고칠 수 없다. 그래서 고친 내용이 그 사람 브라우저에만 남았다.
 *   이 파일이 그 사이를 이어 준다 — 관리자 화면이 여기로 보내면,
 *   여기서 깃허브에 저장하고, 넷리파이가 그걸 보고 홈페이지를 새로 올린다.
 *
 * 깃허브 열쇠(토큰)는 넷리파이 서버 안에만 있고 브라우저로 내려가지 않는다.
 * 대표님은 비밀번호 네 자리만 아시면 된다.
 *
 * 넷리파이에 넣어 두어야 하는 값 (Project configuration → Environment variables)
 *   GITHUB_TOKEN   깃허브에서 받은 열쇠 (Contents: Read and write)
 *   GITHUB_REPO    계정명/저장소명   예) edudoctor7-sketch/antena
 *   ADMIN_PIN      관리자 비밀번호 네 자리
 *   GITHUB_BRANCH  (선택) 기본값 main
 *
 * content.js 는 site/ 폴더(=넷리파이가 실제로 올리는 폴더) 안에 저장한다.
 * index.html 이 <script src="content.js"> 로 같은 폴더에서 바로 읽기 때문이다.
 */

const API = 'https://api.github.com';
const CONTENT_PATH = 'site/content.js';

function envOrDie(name) {
  const v = process.env[name];
  if (!v) throw new Error(`넷리파이에 ${name} 값이 없습니다. Project configuration → Environment variables 에서 넣어 주세요.`);
  return v;
}

async function gh(path, token, options = {}) {
  const r = await fetch(API + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'antena-admin',
      ...(options.headers || {}),
    },
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = { raw: text }; }
  if (!r.ok) {
    const msg = (body && body.message) || r.statusText;
    const err = new Error(`깃허브 응답 ${r.status} — ${msg}`);
    err.status = r.status;
    throw err;
  }
  return body;
}

/* content.js 는 홈페이지가 <head> 에서 바로 읽는 파일이다.
   JSON 이 아니라 스크립트로 두어야 화면이 한 번 깜빡였다가 바뀌는 일이 없다. */
function render(store) {
  return '/* 이 파일은 관리자 페이지의 「웹에 반영하기」가 자동으로 씁니다. 손으로 고치지 마세요. */\n'
    + 'window.CMS_PUBLISHED = ' + JSON.stringify(store, null, 1) + ';\n';
}

function parse(js) {
  const m = String(js || '').match(/window\.CMS_PUBLISHED\s*=\s*([\s\S]*?);\s*$/);
  if (!m) return {};
  try { return JSON.parse(m[1]); } catch (e) { return {}; }
}

const IMG_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'POST 로만 받습니다.' }) };
  }
  try {
    const token = envOrDie('GITHUB_TOKEN');
    const repo = envOrDie('GITHUB_REPO');
    const pin = envOrDie('ADMIN_PIN');
    const branch = process.env.GITHUB_BRANCH || 'main';
    const [owner, name] = repo.split('/');
    if (!owner || !name) throw new Error('GITHUB_REPO 는 「계정명/저장소명」 모양이어야 합니다.');

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) { body = {}; }

    if (String(body.pin || '') !== String(pin)) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: '비밀번호가 맞지 않습니다.' }) };
    }

    /* ── 지금 저장돼 있는 내용을 먼저 읽는다 ───────────── */
    let store = {};
    try {
      const cur = await gh(`/repos/${owner}/${name}/contents/${CONTENT_PATH}?ref=${branch}`, token);
      store = parse(Buffer.from(cur.content || '', 'base64').toString('utf8'));
    } catch (e) {
      if (e.status !== 404) throw e;     // 처음 반영할 때는 파일이 없는 게 정상
    }

    /* ── 보내온 내용을 얹는다 ──────────────────────────
       글은 통째로 갈아끼우고(지운 것도 반영되어야 하므로),
       사진은 여러 번 나눠 오므로 하나씩 얹는다. */
    const files = [];
    if (body.text && typeof body.text === 'object') {
      const kept = {};
      Object.keys(store).forEach(function (k) {
        if (k.indexOf('cms_img_') === 0) kept[k] = store[k];   // 사진은 그대로 둔다
      });
      store = Object.assign(kept, body.text);
    }

    if (body.images && typeof body.images === 'object') {
      for (const key of Object.keys(body.images)) {
        const val = String(body.images[key] || '');
        const m = val.match(/^data:([^;]+);base64,(.+)$/);
        if (!m) { store[key] = val; continue; }              // 이미 주소면 그대로
        const ext = IMG_EXT[m[1].toLowerCase()];
        if (!ext) throw new Error(`받을 수 없는 사진 형식입니다: ${m[1]}`);
        const safe = key.replace(/^cms_img_/, '').replace(/[^0-9A-Za-z._-]/g, '_');
        const path = `site/assets/img/cms/${safe}.${ext}`;
        files.push({ path, base64: m[2] });
        store[key] = path.replace(/^site\//, '');
      }
    }

    files.push({ path: CONTENT_PATH, text: render(store) });

    /* ── 한 번의 저장으로 묶어서 올린다 ────────────────
       파일마다 따로 올리면 저장 기록이 여러 개로 쪼개지고
       홈페이지도 그때마다 다시 올라간다. */
    const ref = await gh(`/repos/${owner}/${name}/git/ref/heads/${branch}`, token);
    const baseCommit = await gh(`/repos/${owner}/${name}/git/commits/${ref.object.sha}`, token);

    const tree = [];
    for (const f of files) {
      const blob = await gh(`/repos/${owner}/${name}/git/blobs`, token, {
        method: 'POST',
        body: JSON.stringify(
          f.base64 ? { content: f.base64, encoding: 'base64' }
                   : { content: f.text, encoding: 'utf-8' }),
      });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    const newTree = await gh(`/repos/${owner}/${name}/git/trees`, token, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
    });
    const commit = await gh(`/repos/${owner}/${name}/git/commits`, token, {
      method: 'POST',
      body: JSON.stringify({
        message: body.message || '관리자 페이지에서 내용 수정',
        tree: newTree.sha,
        parents: [ref.object.sha],
      }),
    });
    await gh(`/repos/${owner}/${name}/git/refs/heads/${branch}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha }),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        글: Object.keys(store).filter(function (k) { return k.indexOf('cms_img_') !== 0; }).length,
        사진: files.length - 1,
        기록: commit.sha.slice(0, 7),
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message || String(e) }) };
  }
};
