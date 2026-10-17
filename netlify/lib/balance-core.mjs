/* 이심전심 — 둘이 동시에 고르고 같이 공개하는 밸런스 게임.
 *
 * 한 판에 PER_ROUND 문제. 질문 순서는 방 코드 + 판 번호로 정한다(seeded).
 * 고른 답은 각자 자기 문서(room:<code>:p<i>)에만 쓴다. 둘이 같은 순간에 골라도
 * 한쪽이 묻히지 않는다. 상대 답은 **둘 다 고르기 전까지 응답에 넣지 않는다.**
 * '다음 질문'은 둘 중 누가 눌러도 되고, 둘이 동시에 눌러도 같은 값(qi+1)이 된다.
 */
import { handleRoom, roundRng, shuffle } from './room-kit.mjs';

export const PER_ROUND = 10;

/* [왼쪽, 오른쪽] — 짧게. 폰에서 버튼 두 개에 나란히 들어가야 한다 */
export const QUESTIONS = [
  ['짜장면', '짬뽕'], ['부먹', '찍먹'], ['바다', '산'], ['아침형 인간', '저녁형 인간'],
  ['여름', '겨울'], ['집 데이트', '밖 데이트'], ['계획 여행', '즉흥 여행'], ['영화관', '집에서 넷플릭스'],
  ['강아지', '고양이'], ['치킨', '피자'], ['카톡 길게', '전화 짧게'], ['깜짝 선물', '물어보고 선물'],
  ['커피', '차'], ['단 거', '짠 거'], ['국내 여행', '해외 여행'], ['놀이공원', '캠핑'],
  ['사진 많이 찍기', '눈으로 담기'], ['맵게', '안 맵게'], ['탕수육', '군만두'], ['비 오는 날', '맑은 날'],
  ['얼죽아', '뜨아'], ['소주', '맥주'], ['노래방', '방탈출'], ['일출 보기', '일몰 보기'],
  ['기념일 크게', '기념일 소소하게'], ['아침밥 꼭', '아침은 건너뛰기'], ['호캉스', '펜션'], ['떡볶이', '순대'],
  ['공포 영화', '로맨틱 코미디'], ['바다 수영', '수영장'], ['걷기 데이트', '드라이브 데이트'], ['메뉴 내가 고르기', '메뉴 골라주기'],
  ['집밥 해먹기', '배달 시키기'], ['연락 자주', '할 말 있을 때만'], ['롤러코스터', '회전목마'], ['초밥', '삼겹살'],
  ['늦잠 자는 주말', '일찍 나가는 주말'], ['첫눈 오는 날', '벚꽃 피는 날'], ['커플템 좋아', '커플템 부끄러워'], ['손 편지', '영상 편지'],
  ['라면에 계란 넣기', '라면엔 라면만'], ['민트초코 좋아', '민트초코 싫어'], ['파인애플 피자 OK', '파인애플 피자 NO'], ['우산 같이 쓰기', '각자 우산'],
  ['동물원', '수족관'], ['같이 게임하기', '같이 운동하기'], ['시골 한 달 살기', '도시 한 달 살기'], ['과거로 여행', '미래로 여행'],
  ['투명 인간 되기', '하늘 날기'], ['평생 한 가지 음식', '평생 같은 옷'], ['바쁘고 넉넉한 삶', '적당하고 여유로운 삶'], ['넓은 집', '좋은 동네'],
  ['생일엔 단둘이', '생일엔 다 같이'], ['싸우면 바로 풀기', '시간 갖고 풀기'], ['요리 담당', '설거지 담당'], ['붕어빵 머리부터', '붕어빵 꼬리부터'],
  ['팥붕', '슈붕'], ['비빔냉면', '물냉면'], ['김치찌개', '된장찌개'], ['빵', '밥'],
  ['콘서트', '뮤지컬'], ['등산', '자전거'], ['갔던 곳 또 가기', '새로운 곳 가기'], ['별 보러 가기', '야경 보러 가기'],
  ['손잡고 걷기', '팔짱 끼고 걷기'], ['여행은 맛집', '여행은 관광지'], ['휴가엔 푹 쉬기', '휴가엔 꽉 채워 놀기'], ['고백은 말로', '고백은 편지로'],
  ['반려식물', '반려동물'], ['주말 브런치', '주말 야식'], ['벼락치기', '미리미리'], ['말로 표현', '행동으로 표현'],
  ['서프라이즈 받기', '서프라이즈 하기'], ['비행기 창가', '비행기 통로'], ['카페 데이트', '맛집 투어'], ['바닷가 마을에서 살기', '도시에서 살기'],
  ['아이스크림', '케이크'], ['스키', '보드'], ['편의점 데이트', '백화점 데이트'], ['하루 종일 같이', '반나절씩 자주'],
];

function setup(room) {
  const order = shuffle(QUESTIONS.map((_, i) => i), roundRng(room));
  room.qs = order.slice(0, PER_ROUND);
  room.qi = 0;
}

const pickOf = (doc, qi) => {
  const v = doc.picks && doc.picks[qi];
  return v === 0 || v === 1 ? v : null;
};

function view(ctx) {
  const { room, me, other, joined } = ctx;
  const total = room.qs.length;
  const phase = !joined ? 'wait' : room.qi >= total ? 'done' : 'play';
  const out = { phase, total, qi: Math.min(room.qi, total) };

  // 지나간 문제는 둘 다 골랐으니 공개해도 된다 ('다음'은 둘 다 골라야 눌린다)
  out.history = room.qs.slice(0, out.qi).map((qid, i) => {
    const a = pickOf(me, i), b = pickOf(other, i);
    return { q: QUESTIONS[qid], mine: a, theirs: b, match: a !== null && a === b };
  });
  out.matches = out.history.filter((h) => h.match).length;

  if (phase === 'play') {
    const q = QUESTIONS[room.qs[room.qi]];
    const a = pickOf(me, room.qi), b = pickOf(other, room.qi);
    out.q = q;
    out.mine = a;
    out.theirsPicked = b !== null;
    // 상대 답은 둘 다 고른 뒤에만 실어 보낸다
    out.reveal = a !== null && b !== null ? { mine: a, theirs: b, match: a === b } : null;
  }
  return out;
}

const actions = {
  pick(ctx) {
    const { room, me, other, joined, body } = ctx;
    if (!joined) return { error: '상대가 아직 안 들어왔어요', status: 409 };
    if (room.qi >= room.qs.length) return { error: '이미 끝났어요', status: 409 };
    if (Number(body.qi) !== room.qi) return { error: '지난 질문이에요', status: 409 };
    if (body.choice !== 0 && body.choice !== 1) return { error: '둘 중 하나를 골라주세요', status: 400 };
    // 둘 다 고른 뒤(공개된 뒤)에는 못 바꾼다. 상대가 고르기 전까지는 바꿔도 된다.
    if (pickOf(me, room.qi) !== null && pickOf(other, room.qi) !== null) {
      return { error: '이미 공개됐어요', status: 409 };
    }
    me.picks = { ...(me.picks || {}), [room.qi]: body.choice };
    ctx.touchMe = true;
    return null;
  },
  next(ctx) {
    const { room, me, other, body } = ctx;
    const qi = Number(body.qi);
    if (qi < room.qi) return null;                 // 상대가 먼저 넘겼다 — 그냥 지금 상태
    if (qi !== room.qi || room.qi >= room.qs.length) return { error: '넘길 질문이 없어요', status: 409 };
    if (pickOf(me, qi) === null || pickOf(other, qi) === null) {
      return { error: '둘 다 골라야 넘어가요', status: 409 };
    }
    room.qi = qi + 1;                               // 둘이 동시에 눌러도 같은 값
    ctx.touchRoom = true;
    return null;
  },
};

export const balance = {
  setup, view, actions,
  finished: (ctx) => ctx.room.qi >= ctx.room.qs.length,
};

export const handle = (body, store, now) => handleRoom(balance, body, store, now);
