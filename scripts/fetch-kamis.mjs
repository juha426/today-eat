const API_URL = "https://www.kamis.or.kr/service/price/xml.do";
const CERT_KEY = process.env.KAMIS_CERT_KEY;
const CERT_ID = process.env.KAMIS_CERT_ID;
if (!CERT_KEY || !CERT_ID) {
  throw new Error("KAMIS 인증정보가 설정되지 않았습니다.");
}
const categories = [
  { code: "100", name: "식량작물" },
  { code: "200", name: "채소류" },
  { code: "300", name: "특용작물" },
  { code: "400", name: "과일류" },
  { code: "500", name: "축산물" },
  { code: "600", name: "수산물" }
];
// 가격 문자열을 숫자로 변환
function toPrice(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || text === "-" || text === "0") {
    return null;
  }
  const number = Number(text.replace(/,/g, ""));
  return Number.isFinite(number) && number > 0
    ? number
    : null;
}
// 가격 변동률 계산(%)
function changeRate(current, previous) {
  if (
    current == null ||
    previous == null ||
    previous === 0
  ) {
    return null;
  }
  return Math.round(
    ((current - previous) / previous) * 1000
  ) / 10;
}
// 한국 날짜 기준으로 조회일 생성
function getKoreaDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}
// KAMIS 카테고리별 가격 조회
async function fetchCategory(category) {
  const params = new URLSearchParams({
    action: "dailyPriceByCategoryList",
    p_cert_key: CERT_KEY,
    p_cert_id: CERT_ID,
    p_returntype: "json",
    p_product_cls_code: "01",
    p_item_category_code: category.code,
    p_country_code: "1101",
    p_regday: getKoreaDate(),
    p_convert_kg_yn: "N"
  });
  const response = await fetch(
    `${API_URL}?${params}`
  );
  if (!response.ok) {
    throw new Error(
      `${category.name}: KAMIS HTTP ${response.status}`
    );
  }
  const responseText = await response.text();
  let json;
  try {
    json = JSON.parse(responseText);
  } catch {
    throw new Error(
      `${category.name}: KAMIS 응답이 JSON 형식이 아닙니다.`
    );
  }
  // KAMIS 응답: data 객체 안에 error_code와 item 배열이 존재
  const result = json.data;
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result)
  ) {
    throw new Error(
      `${category.name}: KAMIS data 객체를 확인할 수 없습니다.`
    );
  }
  const errorCode = String(
    result.error_code ?? ""
  );
  if (errorCode !== "000") {
    throw new Error(
      `${category.name}: KAMIS 오류 코드 ${
        errorCode || "확인 불가"
      }`
    );
  }
  if (!Array.isArray(result.item)) {
    throw new Error(
      `${category.name}: KAMIS 상품 목록이 배열이 아닙니다.`
    );
  }
  const items = result.item
    .map(row => {
      const current = toPrice(row.dpr1);
      const previousDay = toPrice(row.dpr2);
      const weekAgo = toPrice(row.dpr3);
      const yearAgo = toPrice(row.dpr6);
      // 당일 가격이 없으면 전일 가격을 표시용으로 사용
      const displayPrice = current ?? previousDay;
      return {
        name: row.item_name ?? "",
        itemCode: row.item_code ?? "",
        variety: row.kind_name ?? "",
        varietyCode: row.kind_code ?? "",
        grade: row.rank ?? "",
        unit: row.unit ?? "",
        category: category.name,
        price: displayPrice,
        priceToday: current,
        pricePreviousDay: previousDay,
        priceWeekAgo: weekAgo,
        priceYearAgo: yearAgo,
        // 당일 가격이 없으면 일간 변동률도 표시하지 않음
        pctDay: current == null
          ? null
          : changeRate(current, previousDay),
        pctWeek: changeRate(current, weekAgo),
        pctYear: changeRate(current, yearAgo),
        asOf: row.day1 ?? null,
        previousDayLabel: row.day2 ?? null,
        weekAgoLabel: row.day3 ?? null,
        yearAgoLabel: row.day6 ?? null
      };
    })
    .filter(item => item.name && item.price != null);
  console.log(
    `${category.name}: ${items.length}개`
  );
  return items;
}
// 전체 카테고리 조회 및 JSON 생성
async function main() {
  const allItems = [];
  for (const category of categories) {
    const items = await fetchCategory(category);
    allItems.push(...items);
  }
  if (allItems.length === 0) {
    throw new Error(
      "유효한 가격 데이터가 없습니다. 기존 JSON을 유지합니다."
    );
  }
  const output = {
    success: true,
    source: "KAMIS",
    updatedAt: new Date().toISOString(),
    priceType: "retail",
    region: "서울",
    unitPolicy: "KAMIS 조사 단위 유지 (kg 환산 안 함)",
    items: allItems
  };
  const fs = await import("node:fs/promises");
  await fs.mkdir("data", {
    recursive: true
  });
  await fs.writeFile(
    "data/prices.json",
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );
  console.log(
    `총 ${allItems.length}개 가격 저장 완료`
  );
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
