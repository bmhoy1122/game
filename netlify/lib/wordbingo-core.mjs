/* 단어 빙고 — 주제를 정하고 각자 판에 단어를 직접 써서 하는 빙고. 저장소도 네트워크도 모른다.
 *
 * 흐름: 들어오기 → 선 정하기(first-pick) → 각자 단어 쓰기 → 번갈아 부르기 → 끝
 *
 * 커플 빙고(숫자)와 다른 점
 * · 판에 1~25 대신 내가 쓴 단어가 들어간다. 주제(과일·동물…·직접 쓰기), 판 크기(3·4·5), 이길 줄 수는
 *   방 만든 사람이 고른다(options).
 * · 부를 땐 **내 판에서 아직 안 지워진 칸**을 누른다. 오타 걱정이 없고, 실제 단어 빙고도 보통 이렇게 한다.
 * · 부른 단어가 상대 판에도 있으면 거기도 지워진다. 같은 단어인지는 띄어쓰기·대소문자를 무시하고 본다(norm).
 *   '사과'와 '빨간 사과'처럼 다른 말은 다른 단어다 — 그래서 둘이 같은 단어를 많이 쓸수록 빨리 끝난다.
 * · 겹친 단어는 로그에 '둘 다 썼어요'로 보여준다. 부른 단어는 어차피 공개라 상대 판에 대해 새로 새는 건
 *   '그 단어가 있었다'뿐이다. 상대 판 전체는 끝날 때까지 응답에 넣지 않는다.
 *
 * 저장: 판과 '준비'는 각자 자기 문서(둘이 동시에 쓴다), 부른 단어는 공용 문서(차례제).
 * 차례 = (선공 + 부른 개수) % 2. 둘이 같은 수에 목표 줄을 채우면 무승부.
 * 봇은 주제 단어 목록에서 판을 채운다. 직접 쓴 주제는 목록이 없어서 여러 주제를 섞어 쓴다(겹치는 일이 드물다).
 */
import { handleRoom, shuffle } from './room-kit.mjs';
import { pickKind, firstOf, pickView, pickThrow, pickBot } from './first-pick.mjs';

export const SIZES = [3, 4, 5];
export const DEFAULT_LINES = { 3: 1, 4: 2, 5: 3 };
export const MAX_WORD = 10;            // 한 칸 글자 수
const MAX_TOPIC = 20;

/* 주제 — words 가 있으면 '빈칸 채우기'와 봇이 쓴다. 없는 주제(커플용 자유 주제)는 직접 쓴다. */
export const TOPICS = {
  fruit: { label: '과일', icon: '🍎', words: '사과 배 포도 딸기 수박 참외 복숭아 자두 귤 오렌지 한라봉 레몬 라임 바나나 파인애플 망고 키위 체리 블루베리 라즈베리 석류 무화과 감 대추 멜론 자몽 코코넛 아보카도 용과 리치 두리안 살구 매실 유자 모과 앵두 산딸기 청포도 샤인머스캣 금귤' },
  animal: { label: '동물', icon: '🐶', words: '강아지 고양이 토끼 햄스터 사자 호랑이 곰 판다 코끼리 기린 얼룩말 하마 코뿔소 원숭이 고릴라 여우 늑대 사슴 다람쥐 너구리 펭귄 돌고래 고래 상어 거북이 악어 뱀 개구리 독수리 부엉이 앵무새 참새 닭 오리 돼지 소 말 양 염소 낙타 캥거루 코알라 수달 물개' },
  food: { label: '음식', icon: '🍜', words: '김치찌개 된장찌개 부대찌개 순두부찌개 김치볶음밥 비빔밥 불고기 삼겹살 갈비 치킨 피자 햄버거 짜장면 짬뽕 탕수육 떡볶이 순대 김밥 라면 냉면 칼국수 수제비 국밥 설렁탕 삼계탕 감자탕 족발 보쌈 돈가스 초밥 우동 파스타 스테이크 마라탕 쌀국수 카레 오므라이스 샌드위치 샐러드 곱창 닭갈비 회' },
  country: { label: '나라', icon: '🌏', words: '한국 일본 중국 미국 캐나다 멕시코 브라질 아르헨티나 영국 프랑스 독일 이탈리아 스페인 포르투갈 네덜란드 스위스 오스트리아 그리스 튀르키예 러시아 인도 태국 베트남 필리핀 인도네시아 싱가포르 말레이시아 호주 뉴질랜드 이집트 몽골 대만 스웨덴 노르웨이 핀란드 덴마크 아일랜드 칠레 페루 쿠바' },
  subway: { label: '서울 지하철역', icon: '🚇', words: '서울역 시청 종각 종로3가 동대문 신당 왕십리 성수 건대입구 강변 잠실 삼성 선릉 강남 교대 서초 사당 신림 신도림 합정 홍대입구 신촌 이대 충정로 을지로3가 명동 회기 청량리 노원 수유 미아 혜화 약수 옥수 압구정 고속터미널 여의도 김포공항 이태원 한강진 망원 공덕 광화문' },
  job: { label: '직업', icon: '🧑‍🍳', words: '의사 간호사 약사 선생님 교수 경찰 소방관 군인 변호사 판사 검사 회계사 세무사 요리사 제빵사 바리스타 미용사 디자이너 개발자 기자 아나운서 가수 배우 화가 작가 사진작가 운동선수 파일럿 승무원 택배기사 버스기사 농부 어부 목수 건축가 수의사 은행원 공무원 유튜버 간호조무사' },
  sport: { label: '운동', icon: '⚽', words: '축구 야구 농구 배구 테니스 탁구 배드민턴 골프 볼링 수영 스키 스노보드 스케이트 피겨 쇼트트랙 마라톤 사이클 복싱 태권도 유도 레슬링 펜싱 양궁 사격 클라이밍 서핑 요가 필라테스 줄넘기 등산 당구 핸드볼 럭비 하키 컬링 승마 체조 역도 크로스핏 스쿼시' },
  snack: { label: '간식', icon: '🍪', words: '새우깡 포카칩 꼬깔콘 홈런볼 초코파이 빼빼로 오예스 몽쉘 칸쵸 썬칩 꿀꽈배기 고래밥 바나나킥 프링글스 허니버터칩 맛동산 에이스 쿠크다스 마가렛트 버터링 오레오 젤리 마카롱 아이스크림 붕어빵 호떡 떡꼬치 핫도그 츄러스 와플 크로플 도넛 케이크 쿠키 팝콘 솜사탕 약과 탕후루 감자칩 초콜릿' },
  trip: { label: '같이 가고 싶은 곳', icon: '✈️' },
  date: { label: '데이트 하고 싶은 것', icon: '💕' },
  custom: { label: '직접 쓰기', icon: '✏️' },
};
const wordsOf = (id) => (TOPICS[id] && TOPICS[id].words ? TOPICS[id].words.split(' ') : null);
const MIX = Object.keys(TOPICS).flatMap((k) => wordsOf(k) || []);

/* 같은 단어인지 볼 때 쓰는 열쇠 — 띄어쓰기·대소문자·유니코드 조합 차이를 무시한다 */
export const norm = (w) => String(w || '').normalize('NFC').replace(/\s+/g, '').toLowerCase();
const cleanWord = (w) => String(w || '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, MAX_WORD);

export function options(body) {
  const size = SIZES.includes(Number(body.size)) ? Number(body.size) : 5;
  const maxLines = 2 * size + 2;
  const n = Number(body.lines);
  const lines = Number.isInteger(n) && n >= 1 && n <= Math.min(maxLines, 5) ? n : DEFAULT_LINES[size];
  const id = TOPICS[body.topic] ? body.topic : 'fruit';
  let label = TOPICS[id].label;
  if (id === 'custom') label = String(body.topicText || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TOPIC) || '자유 주제';
  return { pick: pickKind(body.pick), size, lines, topic: { id, label, icon: TOPICS[id].icon } };
}
const optsOf = (room) => {
  const o = room.opts || {};
  return { size: o.size || 5, lines: o.lines || DEFAULT_LINES[o.size || 5], topic: o.topic || { id: 'fruit', label: '과일', icon: '🍎' } };
};

/* 크기별 줄 (가로 · 세로 · 대각 둘) */
export function linesFor(size) {
  const out = [];
  for (let r = 0; r < size; r++) out.push([...Array(size)].map((_, c) => r * size + c));
  for (let c = 0; c < size; c++) out.push([...Array(size)].map((_, r) => r * size + c));
  out.push([...Array(size)].map((_, i) => i * size + i));
  out.push([...Array(size)].map((_, i) => i * size + (size - 1 - i)));
  return out;
}

/* 판 검사 — 이상하면 이유(문장), 괜찮으면 null */
export function boardProblem(board, size) {
  if (!Array.isArray(board) || board.length !== size * size) return '칸 수가 맞지 않아요';
  const seen = new Map();
  for (let i = 0; i < board.length; i++) {
    if (typeof board[i] !== 'string') return '단어가 이상해요';
    const w = cleanWord(board[i]);
    if (!w) return (i + 1) + '번 칸이 비어 있어요';
    const k = norm(w);
    if (seen.has(k)) return `'${w}'를 두 번 썼어요 (${seen.get(k) + 1}번 · ${i + 1}번 칸)`;
    seen.set(k, i);
  }
  return null;
}

export function lineCount(board, calledKeys, size) {
  if (!board) return 0;
  let n = 0;
  for (const line of linesFor(size)) if (line.every((i) => calledKeys.has(norm(board[i])))) n++;
  return n;
}

function setup(room) {
  room.called = [];                       // [{ w: 부른 사람 판에 쓰인 그대로, k: norm, by }]
}

export function status(ctx) {
  const { room, docs, joined } = ctx;
  const o = optsOf(room);
  if (!joined) return { phase: 'wait', first: null, o };
  const first = firstOf(ctx);
  if (first === null) return { phase: 'pick', first, o };
  const boards = docs.map((d) => (d.ready && !boardProblem(d.board, o.size) ? d.board : null));
  if (!boards[0] || !boards[1]) return { phase: 'setup', first, o, boards };
  const keys = new Set(room.called.map((c) => c.k));
  const lines = boards.map((b) => lineCount(b, keys, o.size));
  const done = lines.map((l) => l >= o.lines);
  let winner = null;
  if (done[0] || done[1]) winner = done[0] && done[1] ? 'draw' : done[0] ? 0 : 1;
  const turn = (first + room.called.length) % 2;
  return { phase: winner === null ? 'play' : 'done', first, o, boards, lines, winner, turn, keys };
}

function view(ctx) {
  const { room, idx, me, other } = ctx;
  const s = status(ctx);
  const sets = (s.boards || [null, null]).map((b) => (b ? new Set(b.map(norm)) : null));
  return {
    phase: s.phase,
    pick: pickView(ctx),
    first: s.first,
    size: s.o.size,
    winLines: s.o.lines,
    topic: s.o.topic,
    hasWords: !!wordsOf(s.o.topic.id),
    board: me.board || null,                       // 내 판만
    ready: !!me.ready,
    opponentReady: !!other.ready,
    // both: 두 판 다 있던 단어 (부른 단어라 이미 공개된 정보)
    called: room.called.map((c) => ({ w: c.w, by: c.by, both: !!(sets[0] && sets[1] && sets[0].has(c.k) && sets[1].has(c.k)) })),
    turn: s.turn === undefined ? null : s.turn,
    yourTurn: s.phase === 'play' && s.turn === idx,
    lines: s.lines || [0, 0],
    winner: s.winner === undefined ? null : s.winner,
    opponentBoard: s.phase === 'done' ? other.board : null,   // 끝나면 서로 판 공개
    suggest: s.phase === 'setup' && !me.ready ? wordsOf(s.o.topic.id) : null,   // '빈칸 채우기'용 (주제 목록은 공개 정보)
  };
}

const actions = {
  throw: pickThrow,
  ready(ctx) {
    const s = status(ctx);
    if (s.phase === 'wait') return { error: '상대가 아직 안 들어왔어요', status: 409 };
    if (s.phase === 'pick') return { error: '먼저 누가 먼저 할지 정해요', status: 409 };
    if (s.phase !== 'setup') return { error: '이미 시작했어요', status: 409 };
    if (ctx.me.ready) return { error: '이미 준비했어요', status: 409 };
    const why = boardProblem(ctx.body.board, s.o.size);
    if (why) return { error: why, status: 400 };
    ctx.me.board = ctx.body.board.map(cleanWord);
    ctx.me.ready = true;
    ctx.touchMe = true;
    return null;
  },
  call(ctx) {
    const s = status(ctx);
    if (s.phase !== 'play') return { error: '게임 중이 아니에요', status: 409 };
    if (s.turn !== ctx.idx) return { error: '상대 차례예요', status: 409 };
    const i = ctx.body.i, board = ctx.me.board;
    if (!Number.isInteger(i) || i < 0 || i >= board.length) return { error: '내 판의 칸을 골라요', status: 400 };
    const k = norm(board[i]);
    if (s.keys.has(k)) return { error: '이미 나온 단어예요', status: 409 };
    ctx.room.called.push({ w: board[i], k, by: ctx.idx });
    ctx.touchRoom = true;
    return null;
  },
};

/* ---- 혼자 하기 봇 ----
 * 판: 주제 단어 목록에서 무작위(직접 쓴 주제면 여러 주제를 섞어서).
 * 부르기: 내 판만 보고, 그 칸이 든 줄들의 진행도가 큰 단어. 한 칸 남은 줄이 없으면 20% 는 두 번째. */
export function botMove(ctx, rnd = Math.random) {
  const s = status(ctx);
  if (s.phase === 'pick') return pickBot(ctx, rnd);
  if (s.phase === 'setup') {
    if (ctx.me.ready) return null;
    const pool = [...new Set(wordsOf(s.o.topic.id) || MIX)];
    return { act: 'ready', body: { board: shuffle(pool, rnd).slice(0, s.o.size * s.o.size) } };
  }
  if (s.phase !== 'play' || s.turn !== ctx.idx) return null;
  const board = ctx.me.board, size = s.o.size, L = linesFor(size);
  const marked = (j) => s.keys.has(norm(board[j]));
  const scored = [];
  for (let i = 0; i < board.length; i++) {
    if (marked(i)) continue;
    let sc = rnd();
    for (const line of L) {
      if (!line.includes(i)) continue;
      const hits = line.filter(marked).length;
      sc += hits === size - 1 ? 100 : hits * hits + 1;
    }
    scored.push([sc, i]);
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b[0] - a[0]);
  const pick = scored.length > 1 && scored[0][0] < 100 && rnd() < 0.2 ? scored[1] : scored[0];
  return { act: 'call', body: { i: pick[1] } };
}

export const wordbingo = {
  setup, view, actions, options, bot: botMove,
  finished: (ctx) => status(ctx).phase === 'done',
};

export const handle = (body, store, now) => handleRoom(wordbingo, body, store, now);
