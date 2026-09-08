(function(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.WaricanCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  const allowedRoundingUnits = new Set([1, 100, 500, 1000]);

  function formatNumber(number) {
    return number.toLocaleString("ja-JP");
  }

  function calculateSplit(total, people, roundingUnit) {
    if (
      !Number.isSafeInteger(total) ||
      total < 0 ||
      !Number.isSafeInteger(people) ||
      people < 1 ||
      !allowedRoundingUnits.has(roundingUnit)
    ) {
      return null;
    }

    const rawAmount = total / people;
    const perPerson = roundingUnit === 1
      ? Math.round(rawAmount)
      : Math.ceil(rawAmount / roundingUnit) * roundingUnit;
    const collected = perPerson * people;

    if (!Number.isSafeInteger(perPerson) || !Number.isSafeInteger(collected)) {
      return null;
    }

    const difference = collected - total;

    return {
      total,
      people,
      roundingUnit,
      perPerson,
      collected,
      difference,
      differenceType: difference > 0
        ? "surplus"
        : difference < 0
          ? "shortfall"
          : "exact"
    };
  }

  function formatDifference(result) {
    const collected = `集金合計 ${formatNumber(result.collected)}円`;

    if (result.differenceType === "surplus") {
      return `${collected} ／ 余り ${formatNumber(result.difference)}円`;
    }

    if (result.differenceType === "shortfall") {
      return `${collected} ／ 不足 ${formatNumber(Math.abs(result.difference))}円`;
    }

    return `${collected} ／ 差額なし`;
  }

  function buildShareText(result) {
    const differenceLine = result.differenceType === "surplus"
      ? `余り：${formatNumber(result.difference)}円`
      : result.differenceType === "shortfall"
        ? `不足：${formatNumber(Math.abs(result.difference))}円`
        : "差額：0円";

    return [
      "割り勘結果",
      `総額：${formatNumber(result.total)}円`,
      `人数：${result.people}人`,
      `1人あたり：${formatNumber(result.perPerson)}円`,
      `集金合計：${formatNumber(result.collected)}円`,
      differenceLine
    ].join("\n");
  }

  function createLatestRequestGuard() {
    let currentRequestId = 0;

    return {
      begin() {
        currentRequestId += 1;
        return currentRequestId;
      },
      cancel() {
        currentRequestId += 1;
      },
      isCurrent(requestId) {
        return requestId === currentRequestId;
      }
    };
  }

  function classifyShareError(error) {
    if (error && error.name === "AbortError") {
      return {
        cancelled: true,
        message: "共有はキャンセルされました。"
      };
    }

    return {
      cancelled: false,
      message: "共有できませんでした。時間をおいてもう一度お試しください。"
    };
  }

  return {
    calculateSplit,
    formatDifference,
    buildShareText,
    createLatestRequestGuard,
    classifyShareError
  };
});
