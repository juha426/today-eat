

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

function toPrice(value) {
  if (value == null) return null;

  const text = String(value).trim();
  if (!text || text === "-" || text === "0") return null;

  const number = Number(text.replace(/,/g, ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function changeRate(current, previous) {
  if (current == null || previous == null || previous === 0) {
    return null;
  }

  return Math.round(((current - previous) / previous) * 1000) / 10;
}

async function fetchCategory(category) {
  const params = new URLSearchParams({
    action: "dailyPriceByCategoryList",
    p_cert_key: CERT_KEY,
    p_cert_id: CERT_ID,
    p_returntype: "json",
    p_product_cls_code: "01",
    p_item_category_code: category.code,
    p_country_code: "1101",
    p_convert_kg_yn: "Y"
  });

  const response = await fetch(`${API_URL}?${params}`);

  if (!response.ok) {
    throw new Error(
      `${category.name}: KAMIS HTTP ${response.status}`
    );
  }

  const responseText = await response.text();

console.log(
  `${category.name}: HTTP ${response.status}`
);

console.log(
  `${category.name}: Content-Type =`,
  response.headers.get("content-type")
);

let json;

try {
  json = JSON.parse(responseText);
} catch {
  console.error(
    `${category.name}: JSON 파싱 실패`
  );

  console.error(
    "응답 앞부분:",
    responseText.slice(0, 500)
  );

  throw new Error(
    `${category.name}: KAMIS 응답이 JSON 형식이 아닙니다.`
  );
}

console.log(
  `${category.name}: 응답 최상위 키`,
  Object.keys(json)
);

console.log(
  `${category.name}: condition`,
  JSON.stringify(json.condition ?? {})
);

console.log(
  `${category.name}: price 개수`,
  Array.isArray(json.price) ? json.price.length : "배열 아님"
);

console.log(
  `${category.name}: data 개수`,
  Array.isArray(json.data) ? json.data.length : "배열 아님"
);

const condition = json.condition ?? {};
const errorCode = String(condition.error_code ?? "");

  if (errorCode && errorCode !== "000") {
    if (errorCode === "001") {
      console.warn(`${category.name}: 조회 데이터 없음`);
      return [];
    }

    throw new Error(
      `${category.name}: KAMIS 오류 ${errorCode}`
    );
  }

  const rows = [
    ...(Array.isArray(json.price) ? json.price : []),
    ...(Array.isArray(json.data) ? json.data : [])
  ];

  return rows
    .map(row => {
      const current = toPrice(row.dpr1);
      const weekAgo = toPrice(row.dpr3);
      const yearAgo = toPrice(row.dpr6);

      return {
        name: row.item_name ?? "",
        variety: row.kind_name ?? "",
        grade: row.rank ?? "",
        unit: row.unit ?? "",
        category: category.name,
        price: current,
        priceWeekAgo: weekAgo,
        priceYearAgo: yearAgo,
        pctWeek: changeRate(current, weekAgo),
        pctYear: changeRate(current, yearAgo),
        asOf: row.day1 ?? null
      };
    })
    .filter(item => item.name && item.price != null);
}

async function main() {
  const allItems = [];

  for (const category of categories) {
    const items = await fetchCategory(category);
    allItems.push(...items);
    console.log(`${category.name}: ${items.length}개`);
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
    unitPolicy: "KAMIS kg 환산 요청",
    items: allItems
  };

  const fs = await import("node:fs/promises");
  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(
    "data/prices.json",
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log(`총 ${allItems.length}개 가격 저장 완료`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
