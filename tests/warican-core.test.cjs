const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateSplit,
  formatDifference,
  buildShareText,
  createLatestRequestGuard,
  classifyShareError
} = require("../warican-core.js");

test("10,000円を3人でそのまま分けすると1円不足と示す", () => {
  const result = calculateSplit(10000, 3, 1);

  assert.deepEqual(result, {
    total: 10000,
    people: 3,
    roundingUnit: 1,
    perPerson: 3333,
    collected: 9999,
    difference: -1,
    differenceType: "shortfall"
  });
  assert.equal(formatDifference(result), "集金合計 9,999円 ／ 不足 1円");
});

test("割り切れる金額で差額なしと示す", () => {
  const result = calculateSplit(10000, 4, 1);

  assert.equal(result.perPerson, 2500);
  assert.equal(result.collected, 10000);
  assert.equal(result.difference, 0);
  assert.equal(result.differenceType, "exact");
  assert.equal(formatDifference(result), "集金合計 10,000円 ／ 差額なし");
});

test("1円を2人で分けると1円余る", () => {
  const result = calculateSplit(1, 2, 1);

  assert.equal(result.perPerson, 1);
  assert.equal(result.collected, 2);
  assert.equal(result.difference, 1);
  assert.equal(result.differenceType, "surplus");
});

test("人数1でも指定した1000円単位の切り上げを適用する", () => {
  const result = calculateSplit(9876, 1, 1000);

  assert.equal(result.perPerson, 10000);
  assert.equal(result.collected, 10000);
  assert.equal(result.difference, 124);
});

test("既存の100円・500円・1000円単位は1人あたりを切り上げる", () => {
  const cases = [
    { unit: 100, perPerson: 3400, collected: 10200, difference: 200 },
    { unit: 500, perPerson: 3500, collected: 10500, difference: 500 },
    { unit: 1000, perPerson: 4000, collected: 12000, difference: 2000 }
  ];

  for (const expected of cases) {
    const result = calculateSplit(10000, 3, expected.unit);
    assert.equal(result.perPerson, expected.perPerson);
    assert.equal(result.collected, expected.collected);
    assert.equal(result.difference, expected.difference);
  }
});

test("安全な大きな整数でも計算契約を保つ", () => {
  const result = calculateSplit(9007199254740000, 3, 1);

  assert.equal(result.perPerson * result.people, result.collected);
  assert.equal(result.collected - result.total, result.difference);
});

test("不正入力は計算結果を返さない", () => {
  assert.equal(calculateSplit(-1, 2, 1), null);
  assert.equal(calculateSplit(100, 0, 1), null);
  assert.equal(calculateSplit(100.5, 2, 1), null);
  assert.equal(calculateSplit(Number.MAX_SAFE_INTEGER + 1, 2, 1), null);
  assert.equal(calculateSplit(100, 2, 25), null);
});

test("コピー文は画面と同じ集金合計と不足を含む", () => {
  const result = calculateSplit(10000, 3, 1);

  assert.equal(
    buildShareText(result),
    "割り勘結果\n" +
      "総額：10,000円\n" +
      "人数：3人\n" +
      "1人あたり：3,333円\n" +
      "集金合計：9,999円\n" +
      "不足：1円"
  );
});

test("新しい共有生成開始後は古いrequestをstaleと判定する", () => {
  const guard = createLatestRequestGuard();
  const first = guard.begin();
  const second = guard.begin();

  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);

  guard.cancel();
  assert.equal(guard.isCurrent(second), false);
});

test("共有キャンセルと実エラーを区別する", () => {
  assert.deepEqual(classifyShareError({ name: "AbortError" }), {
    cancelled: true,
    message: "共有はキャンセルされました。"
  });
  assert.deepEqual(classifyShareError(new Error("failed")), {
    cancelled: false,
    message: "共有できませんでした。時間をおいてもう一度お試しください。"
  });
});
